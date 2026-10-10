package downloads

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fdm-enorkity/internal/config"
	"fdm-enorkity/internal/media"
	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/security"
	"fdm-enorkity/internal/settings"

	"gorm.io/gorm"
)

type Manager struct {
	db       *gorm.DB
	log      *slog.Logger
	cfg      *config.Config
	settings *settings.Store
	Media    *media.Engine

	mu      sync.Mutex
	cancel  map[string]context.CancelFunc
	workers sync.WaitGroup
	pace    pacer // shared bandwidth limit for multi-connection downloads
}

func NewManager(db *gorm.DB, log *slog.Logger, cfg *config.Config, st *settings.Store) *Manager {
	return &Manager{
		db:       db,
		log:      log,
		cfg:      cfg,
		settings: st,
		Media:    &media.Engine{YtdlpPath: cfg.YtdlpPath, FfmpegPath: cfg.FfmpegPath, StorageDir: cfg.StorageRoot},
		cancel:   make(map[string]context.CancelFunc),
	}
}

func (m *Manager) httpClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   45 * time.Second,
				KeepAlive: 60 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          64,
			MaxIdleConnsPerHost:   8,
			MaxConnsPerHost:       0, // unlimited per host (single GET per download; avoids artificial cap)
			IdleConnTimeout:       120 * time.Second,
			TLSHandshakeTimeout:   20 * time.Second,
			ResponseHeaderTimeout: 120 * time.Second,
			ExpectContinueTimeout: 2 * time.Second,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			allowPrivate := m.settings.AllowPrivateURLs()
			if _, err := security.ValidateDownloadURL(req.URL.String(), allowPrivate); err != nil {
				return err
			}
			return nil
		},
	}
}

type AddDownloadInput struct {
	URL           string
	Filename      string
	PageTitle     string
	Referrer      string
	Source        string
	Category      string
	ExecConfirmed bool

	// Media engine (see docs/media-engine.md).
	Engine          string
	QualityID       string
	Title           string
	Thumbnail       string
	Site            string
	DurationSeconds int
	SizeBytes       int64

	// SkipExisting returns a download already saved or queued under the same name (marked
	// Skipped) instead of adding a duplicate; see existing.go.
	SkipExisting bool
}

func (m *Manager) AddDownload(in AddDownloadInput) (*models.Download, error) {
	allowPrivate := m.settings.AllowPrivateURLs()
	u, err := security.ValidateDownloadURL(in.URL, allowPrivate)
	if err != nil {
		return nil, err
	}
	if in.SkipExisting {
		if dl := m.findExisting(existingName(in)); dl != nil {
			dl.Skipped = true
			return dl, nil
		}
	}
	switch in.Engine {
	case "", models.EngineHTTP:
	case models.EngineMedia:
		return m.addMediaDownload(in)
	default:
		return nil, fmt.Errorf("unknown engine %q", in.Engine)
	}

	name := strings.TrimSpace(in.Filename)
	// A name typed in the app is final; the extension's names stay overridable (see applySuggestedFilename).
	namedByUser := name != "" && defaultSource(in.Source) == "desktop"
	if name == "" {
		name = strings.TrimSpace(in.PageTitle)
	}
	if name == "" {
		name = path.Base(u.Path)
	}
	if name == "" || name == "." || name == "/" {
		name = "download"
	}
	name = security.SanitizeFilename(name)
	if name == "" || name == "." {
		name = "download"
	}
	ext := extensionFromFilename(name)
	reqExec := security.RequiresExecutableConfirmation(ext)
	if reqExec && !in.ExecConfirmed && m.settings.GetBool(settings.KeyExecutableConfirm, true) {
		dl := &models.Download{
			URL:                 in.URL,
			Filename:            name,
			OriginalFilename:    name,
			NamedByUser:         namedByUser,
			Status:              models.DownloadPending,
			Source:              defaultSource(in.Source),
			Referrer:            in.Referrer,
			Category:            pickCategory(in.Category, ext),
			Extension:           ext,
			RequiresExecConfirm: true,
			ExecConfirmed:       false,
			FileSize:            -1,
		}
		// Persist as pending blocked until UI confirms.
		if err := m.db.Create(dl).Error; err != nil {
			return nil, err
		}
		qi := &models.QueueItem{DownloadID: dl.ID, Priority: 0, Position: m.nextQueuePosition(), Status: models.QueuePaused}
		if err := m.db.Create(qi).Error; err != nil {
			return nil, err
		}
		m.appendLog(dl.ID, models.LogWarn, "executable confirmation required", ext)
		return dl, nil
	}

	dir := m.settings.DownloadDirectory(m.cfg.DefaultDownloadDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dl := &models.Download{
		URL:                 in.URL,
		Filename:            name,
		OriginalFilename:    name,
		NamedByUser:         namedByUser,
		Status:              models.DownloadPending,
		Source:              defaultSource(in.Source),
		Referrer:            in.Referrer,
		Category:            pickCategory(in.Category, ext),
		Extension:           ext,
		RequiresExecConfirm: reqExec,
		ExecConfirmed:       in.ExecConfirmed || !m.settings.GetBool(settings.KeyExecutableConfirm, true),
		FileSize:            -1,
		TempFilePath:        "", // set after ID
		// Optional details from the browser (a series episode's title and poster) for the library.
		Title:           strings.TrimSpace(in.Title),
		Thumbnail:       cleanThumbnail(in.Thumbnail),
		Site:            strings.TrimSpace(in.Site),
		DurationSeconds: in.DurationSeconds,
	}
	if err := m.db.Create(dl).Error; err != nil {
		return nil, err
	}
	partPath := filepath.Join(dir, dl.ID+".part")
	dl.TempFilePath = partPath
	if err := m.db.Model(dl).Update("temp_file_path", partPath).Error; err != nil {
		return nil, err
	}
	// Held until StartDownload (or ScheduleNight) releases it: the scheduler must not pick a
	// download up while the caller is still deciding when it should run.
	qi := &models.QueueItem{DownloadID: dl.ID, Priority: 0, Position: m.nextQueuePosition(), Status: models.QueuePaused}
	if err := m.db.Create(qi).Error; err != nil {
		return nil, err
	}
	m.appendLog(dl.ID, models.LogInfo, "download created", "")
	return dl, nil
}

func defaultSource(s string) string {
	if strings.TrimSpace(s) == "" {
		return "api"
	}
	return s
}

func pickCategory(cat, ext string) string {
	if cat != "" {
		return cat
	}
	return CategoryForExtension(ext)
}

func (m *Manager) nextQueuePosition() int {
	var max int
	row := m.db.Model(&models.QueueItem{}).Select("COALESCE(MAX(position),0)").Row()
	_ = row.Scan(&max)
	return max + 1
}

func (m *Manager) ConfirmExecutable(id string) error {
	var dl models.Download
	if err := m.db.First(&dl, "id = ?", id).Error; err != nil {
		return err
	}
	if !dl.RequiresExecConfirm {
		return fmt.Errorf("confirmation not required")
	}
	dir := m.settings.DownloadDirectory(m.cfg.DefaultDownloadDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	partPath := filepath.Join(dir, dl.ID+".part")
	return m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"exec_confirmed":        true,
		"requires_exec_confirm": false,
		"temp_file_path":        partPath,
	}).Error
}

func (m *Manager) StartDownload(id string) error {
	// Checked and queued under the scheduler's lock, so a download the scheduler is running (or
	// has just finished) is never queued a second time.
	m.mu.Lock()
	err := m.queueForStart(id)
	m.mu.Unlock()
	if err != nil {
		return err
	}
	m.schedule()
	return nil
}

// queueForStart marks a download queued and its queue item pending. Caller holds m.mu.
func (m *Manager) queueForStart(id string) error {
	if _, running := m.cancel[id]; running {
		return nil
	}
	var dl models.Download
	if err := m.db.First(&dl, "id = ?", id).Error; err != nil {
		return err
	}
	if dl.RequiresExecConfirm && !dl.ExecConfirmed {
		return fmt.Errorf("executable confirmation required")
	}
	switch dl.Status {
	case models.DownloadActive:
		return nil
	case models.DownloadCompleted, models.DownloadCancelled:
		return fmt.Errorf("cannot start download in status %s", dl.Status)
	case models.DownloadFailed:
		return fmt.Errorf("use retry endpoint for failed downloads")
	}
	now := time.Now()
	if dl.StartedAt == nil {
		_ = m.db.Model(&dl).Updates(map[string]any{"started_at": now}).Error
	}
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"status": models.DownloadQueued,
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Updates(map[string]any{
		"status": models.QueuePending,
	}).Error
	return nil
}

func (m *Manager) PauseDownload(id string) error {
	m.mu.Lock()
	cancelFn, ok := m.cancel[id]
	if ok {
		delete(m.cancel, id)
	} else if err := m.holdWaiting(id); err != nil { // under the lock: the scheduler can't pick it meanwhile
		m.mu.Unlock()
		return err
	}
	m.mu.Unlock()
	if !ok {
		return nil
	}

	now := time.Now()
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"status":     models.DownloadPaused,
		"paused_at":  now,
		"updated_at": now,
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Update("status", models.QueuePaused).Error
	cancelFn()
	return nil
}

// holdWaiting pauses a download that is only waiting in the queue, queue item included, so the
// scheduler doesn't start it when a slot frees up. Caller holds m.mu.
func (m *Manager) holdWaiting(id string) error {
	res := m.db.Model(&models.Download{}).Where("id = ? AND status IN ?", id, []models.DownloadStatus{
		models.DownloadPending,
		models.DownloadQueued,
	}).Updates(map[string]any{
		"status": models.DownloadPaused,
	})
	if res.Error != nil || res.RowsAffected == 0 {
		return res.Error
	}
	return m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Update("status", models.QueuePaused).Error
}

func (m *Manager) ResumeDownload(id string) error {
	var dl models.Download
	if err := m.db.First(&dl, "id = ?", id).Error; err != nil {
		return err
	}
	if dl.RequiresExecConfirm && !dl.ExecConfirmed {
		return fmt.Errorf("executable confirmation required")
	}
	if dl.Status != models.DownloadPaused && dl.Status != models.DownloadFailed {
		return fmt.Errorf("cannot resume from status %s", dl.Status)
	}
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"status":        models.DownloadQueued,
		"error_message": "",
		"paused_at":     nil,
		"cancelled_at":  nil,
		"updated_at":    time.Now(),
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Updates(map[string]any{
		"status": models.QueuePending,
	}).Error
	m.schedule()
	return nil
}

func (m *Manager) CancelDownload(id string) error {
	m.mu.Lock()
	cancelFn, ok := m.cancel[id]
	if ok {
		delete(m.cancel, id)
	}
	m.mu.Unlock()
	if ok {
		cancelFn()
	}
	now := time.Now()
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"status":        models.DownloadCancelled,
		"cancelled_at":  now,
		"updated_at":    now,
		"error_message": "cancelled",
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Update("status", models.QueueCancelled).Error
	return nil
}

func (m *Manager) RetryDownload(id string) error {
	var dl models.Download
	if err := m.db.First(&dl, "id = ?", id).Error; err != nil {
		return err
	}
	if dl.RequiresExecConfirm && !dl.ExecConfirmed {
		return fmt.Errorf("executable confirmation required")
	}
	removeTemp(&dl)
	m.clearSegments(id)
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"status":                 models.DownloadQueued,
		"error_message":          "",
		"downloaded_bytes":       0,
		"progress_percent":       0,
		"speed_bytes_per_second": 0,
		"eta_seconds":            0,
		"completed_at":           nil,
		"updated_at":             time.Now(),
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Updates(map[string]any{
		"status": models.QueuePending,
	}).Error
	// Fresh temp file on retry from failed.
	if dl.TempFilePath == "" {
		dir := m.settings.DownloadDirectory(m.cfg.DefaultDownloadDir)
		_ = m.db.Model(&models.Download{}).Where("id = ?", id).Update("temp_file_path", tempPathFor(&dl, dir)).Error
	}
	m.schedule()
	return nil
}

func (m *Manager) DeleteDownload(id string) error {
	m.CancelDownload(id)
	_ = os.Remove(m.Media.PosterPath(id))
	return m.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("download_id = ?", id).Delete(&models.QueueItem{}).Error; err != nil {
			return err
		}
		if err := tx.Where("download_id = ?", id).Delete(&models.DownloadLog{}).Error; err != nil {
			return err
		}
		if err := tx.Where("download_id = ?", id).Delete(&models.DownloadChunk{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.Download{}, "id = ?", id).Error
	})
}

func (m *Manager) DeleteDownloadFile(id string) error {
	var dl models.Download
	if err := m.db.First(&dl, "id = ?", id).Error; err != nil {
		return err
	}
	if dl.FilePath != "" {
		_ = os.Remove(dl.FilePath)
	}
	removeTemp(&dl)
	return m.DeleteDownload(id)
}

// RecoverInterrupted runs once at startup. Downloads that were running when the app last quit
// have no worker any more (and would sit at "active" forever); queue them again so they resume
// where they stopped, along with anything that was already waiting.
func (m *Manager) RecoverInterrupted() int64 {
	res := m.db.Model(&models.Download{}).Where("status = ?", models.DownloadActive).Updates(map[string]any{
		"status":                 models.DownloadQueued,
		"speed_bytes_per_second": 0,
		"eta_seconds":            0,
	})
	_ = m.db.Model(&models.QueueItem{}).Where("status = ?", models.QueueActive).Update("status", models.QueuePending).Error
	if res.RowsAffected > 0 {
		m.log.Info("resuming interrupted downloads", "count", res.RowsAffected)
	}
	m.schedule()
	return res.RowsAffected
}

func (m *Manager) schedule() {
	m.mu.Lock()
	defer m.mu.Unlock()
	max := m.settings.MaxConcurrent(m.cfg.MaxConcurrentDownloads)
	active := len(m.cancel)
	if active >= max {
		return
	}
	slots := max - active
	for i := 0; i < slots; i++ {
		var qi models.QueueItem
		err := m.db.Where("status = ?", models.QueuePending).
			Order("priority DESC, position ASC").First(&qi).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return
		}
		if err != nil {
			m.log.Error("queue pick failed", "err", err)
			return
		}
		var dl models.Download
		if err := m.db.First(&dl, "id = ?", qi.DownloadID).Error; err != nil {
			continue
		}
		if dl.Status == models.DownloadCancelled {
			continue
		}
		if dl.RequiresExecConfirm && !dl.ExecConfirmed {
			continue
		}
		ctx, cancel := context.WithCancel(context.Background())
		m.cancel[dl.ID] = cancel
		now := time.Now()
		_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
			"status":     models.DownloadActive,
			"updated_at": now,
		}).Error
		_ = m.db.Model(&models.QueueItem{}).Where("id = ?", qi.ID).Updates(map[string]any{
			"status": models.QueueActive,
		}).Error
		if dl.StartedAt == nil {
			_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Update("started_at", now).Error
		}
		m.workers.Add(1)
		go func(id string) {
			defer m.workers.Done()
			var d models.Download
			if err := m.db.First(&d, "id = ?", id).Error; err != nil {
				m.mu.Lock()
				delete(m.cancel, id)
				m.mu.Unlock()
				m.schedule()
				return
			}
			m.runDownload(ctx, &d)
			m.mu.Lock()
			delete(m.cancel, id)
			m.mu.Unlock()
			m.schedule()
		}(dl.ID)
	}
}

// QueueItemDTO avoids circular JSON with Download preload if needed.
func (m *Manager) ListQueue() ([]models.QueueItem, error) {
	var items []models.QueueItem
	if err := m.db.Preload("Download").Order("priority DESC, position ASC").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (m *Manager) appendLog(downloadID string, level models.LogLevel, message, details string) {
	l := models.DownloadLog{DownloadID: downloadID, Level: level, Message: message, Details: details}
	_ = m.db.Create(&l).Error
}

func (m *Manager) Shutdown(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		m.workers.Wait()
		close(done)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-done:
		return nil
	}
}

func (m *Manager) ListDownloads(status, search string, limit, offset int) ([]models.Download, int64, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	q := m.db.Model(&models.Download{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("filename LIKE ? OR url LIKE ?", like, like)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var out []models.Download
	if err := q.Order("created_at DESC").Limit(limit).Offset(offset).Find(&out).Error; err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (m *Manager) GetDownload(id string) (*models.Download, error) {
	var d models.Download
	if err := m.db.First(&d, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &d, nil
}

func (m *Manager) StartAll() error {
	var ids []string
	if err := m.db.Model(&models.Download{}).
		Where("status IN ?", []models.DownloadStatus{models.DownloadPending, models.DownloadPaused}).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		var d models.Download
		if err := m.db.First(&d, "id = ?", id).Error; err != nil {
			continue
		}
		if d.RequiresExecConfirm && !d.ExecConfirmed {
			continue
		}
		if d.Status == models.DownloadPaused {
			_ = m.ResumeDownload(id)
			continue
		}
		_ = m.StartDownload(id)
	}
	return nil
}

func (m *Manager) PauseAll() error {
	var ids []string
	if err := m.db.Model(&models.Download{}).
		Where("status IN ?", []models.DownloadStatus{models.DownloadActive, models.DownloadQueued, models.DownloadPending}).
		Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		_ = m.PauseDownload(id)
	}
	return nil
}

func (m *Manager) RetryFailed() error {
	var ids []string
	if err := m.db.Model(&models.Download{}).Where("status = ?", models.DownloadFailed).Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, id := range ids {
		_ = m.RetryDownload(id)
	}
	return nil
}

func (m *Manager) ClearCompleted() error {
	var items []models.Download
	if err := m.db.Where("status = ?", models.DownloadCompleted).Find(&items).Error; err != nil {
		return err
	}
	for _, d := range items {
		_ = m.db.Where("download_id = ?", d.ID).Delete(&models.QueueItem{}).Error
		_ = m.db.Where("download_id = ?", d.ID).Delete(&models.DownloadLog{}).Error
		_ = m.db.Delete(&models.Download{}, "id = ?", d.ID).Error
	}
	return nil
}

func (m *Manager) MoveQueueUp(queueItemID string) error {
	var cur models.QueueItem
	if err := m.db.First(&cur, "id = ?", queueItemID).Error; err != nil {
		return err
	}
	var prev models.QueueItem
	err := m.db.Where("position < ?", cur.Position).Order("position DESC").First(&prev).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return m.db.Transaction(func(tx *gorm.DB) error {
		p1, p2 := cur.Position, prev.Position
		if err := tx.Model(&models.QueueItem{}).Where("id = ?", cur.ID).Update("position", p2).Error; err != nil {
			return err
		}
		return tx.Model(&models.QueueItem{}).Where("id = ?", prev.ID).Update("position", p1).Error
	})
}

func (m *Manager) MoveQueueDown(queueItemID string) error {
	var cur models.QueueItem
	if err := m.db.First(&cur, "id = ?", queueItemID).Error; err != nil {
		return err
	}
	var next models.QueueItem
	err := m.db.Where("position > ?", cur.Position).Order("position ASC").First(&next).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return m.db.Transaction(func(tx *gorm.DB) error {
		p1, p2 := cur.Position, next.Position
		if err := tx.Model(&models.QueueItem{}).Where("id = ?", cur.ID).Update("position", p2).Error; err != nil {
			return err
		}
		return tx.Model(&models.QueueItem{}).Where("id = ?", next.ID).Update("position", p1).Error
	})
}
