package downloads

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"fdm-enorkity/internal/files"
	"fdm-enorkity/internal/media"
	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/security"
)

// InspectResult is the POST /api/v1/inspect payload (docs/media-engine.md).
type InspectResult struct {
	Kind            string         `json:"kind"` // direct | media | playlist
	URL             string         `json:"url"`
	Title           string         `json:"title"`
	Filename        string         `json:"filename"`
	Thumbnail       string         `json:"thumbnail"`
	DurationSeconds int            `json:"duration_seconds"`
	Uploader        string         `json:"uploader"`
	Site            string         `json:"site"`
	MimeType        string         `json:"mime_type"`
	SizeBytes       int64          `json:"size_bytes"`
	IsLive          bool           `json:"is_live"`
	DRM             bool           `json:"drm"`
	Options         []media.Option `json:"options"`
	Entries         []media.Entry  `json:"entries,omitempty"`
}

// mediaHosts are pages that are never direct files, so Inspect skips the HTTP probe.
var mediaHosts = []string{
	"youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "x.com", "twitter.com", "instagram.com",
	"facebook.com", "fb.watch", "dailymotion.com", "soundcloud.com", "twitch.tv", "reddit.com", "udemy.com",
}

func isMediaHost(host string) bool {
	host = strings.ToLower(strings.TrimPrefix(host, "www."))
	for _, h := range mediaHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

// Inspect decides whether rawURL is a direct file or a media page and describes the choices.
func (m *Manager) Inspect(ctx context.Context, rawURL, referrer string) (*InspectResult, error) {
	u, err := security.ValidateDownloadURL(rawURL, m.settings.AllowPrivateURLs())
	if err != nil {
		return nil, err
	}
	if !isMediaHost(u.Hostname()) {
		if res := m.probeDirect(ctx, u, referrer); res != nil {
			return res, nil
		}
	}
	info, err := m.Media.Probe(ctx, rawURL, referrer, m.settings.MediaCookiesBrowser())
	if err != nil {
		return nil, err
	}
	kind := "media"
	if info.Entries != nil {
		kind = "playlist"
	}
	media.Recommend(info.Options, m.settings.PreferredQuality())
	return &InspectResult{
		Kind: kind, URL: info.URL, Title: info.Title, Filename: info.Title, Thumbnail: info.Thumbnail,
		DurationSeconds: info.DurationSeconds, Uploader: info.Uploader, Site: info.Site, SizeBytes: -1,
		IsLive: info.IsLive, DRM: info.DRM, Options: info.Options, Entries: info.Entries,
	}, nil
}

// probeDirect returns a "direct" result when the URL serves a file, or nil for HTML pages and
// stream manifests (which the media engine handles) or when the server can't be reached.
func (m *Manager) probeDirect(ctx context.Context, u *url.URL, referrer string) *InspectResult {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := m.httpClient()
	try := func(method string) *http.Response {
		req, err := http.NewRequestWithContext(ctx, method, u.String(), nil)
		if err != nil {
			return nil
		}
		if referrer != "" {
			req.Header.Set("Referer", referrer)
		}
		if method == http.MethodGet {
			req.Header.Set("Range", "bytes=0-0")
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil
		}
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil
		}
		return resp
	}
	resp := try(http.MethodHead)
	if resp == nil {
		resp = try(http.MethodGet) // some CDNs reject HEAD
	}
	if resp == nil {
		return nil
	}
	ct := strings.ToLower(resp.Header.Get("Content-Type"))
	if strings.Contains(ct, "html") || strings.Contains(ct, "mpegurl") || strings.Contains(ct, "dash+xml") {
		return nil
	}
	size := int64(-1)
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		size = parseContentRangeTotal(cr)
	} else if resp.ContentLength > 0 {
		size = resp.ContentLength
	}
	name := FilenameFromContentDisposition(resp)
	if name == "" {
		name = FilenameFromURLString(resp.Request.URL.String())
	}
	if name == "" {
		name = "download"
	}
	if filepath.Ext(name) == "" {
		name += ExtensionFromMIME(ct)
	}
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = strings.TrimSpace(ct[:i])
	}
	return &InspectResult{
		Kind: "direct", URL: u.String(), Title: name, Filename: name, Site: strings.TrimPrefix(u.Hostname(), "www."),
		MimeType: ct, SizeBytes: size, Options: []media.Option{},
	}
}

func (m *Manager) addMediaDownload(in AddDownloadInput) (*models.Download, error) {
	if _, err := m.Media.Ytdlp(); err != nil {
		return nil, err
	}
	quality := strings.TrimSpace(in.QualityID)
	if quality == "" {
		quality = "best"
	}
	if !media.ValidQuality(quality) {
		return nil, fmt.Errorf("unknown quality %q", quality)
	}
	name := mediaBaseName(in.Filename, in.Title, in.PageTitle)
	category := strings.TrimSpace(in.Category)
	if category == "" {
		category = "video"
		if media.IsAudio(quality) {
			category = "audio"
		}
	}
	thumb := cleanThumbnail(in.Thumbnail)
	size := int64(-1)
	if in.SizeBytes > 0 {
		size = in.SizeBytes
	}

	dir := m.settings.DownloadDirectory(m.cfg.DefaultDownloadDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dl := &models.Download{
		URL:              in.URL,
		Filename:         name,
		OriginalFilename: name,
		Status:           models.DownloadPending,
		Source:           defaultSource(in.Source),
		Referrer:         in.Referrer,
		Category:         category,
		Engine:           models.EngineMedia,
		QualityID:        quality,
		QualityLabel:     media.QualityLabel(quality),
		Title:            firstNonEmpty(in.Title, name),
		Thumbnail:        thumb,
		Site:             strings.TrimSpace(in.Site),
		DurationSeconds:  in.DurationSeconds,
		FileSize:         size,
		SupportsResume:   true,
		ExecConfirmed:    true,
	}
	if err := m.db.Create(dl).Error; err != nil {
		return nil, err
	}
	dl.TempFilePath = tempPathFor(dl, dir)
	if err := m.db.Model(dl).Update("temp_file_path", dl.TempFilePath).Error; err != nil {
		return nil, err
	}
	qi := &models.QueueItem{DownloadID: dl.ID, Priority: 0, Position: m.nextQueuePosition(), Status: models.QueuePaused} // held, see AddDownload
	if err := m.db.Create(qi).Error; err != nil {
		return nil, err
	}
	m.appendLog(dl.ID, models.LogInfo, "media download created", dl.QualityLabel)
	return dl, nil
}

// mediaBaseName picks the output name (without extension) yt-dlp writes to.
func mediaBaseName(candidates ...string) string {
	name := security.SanitizeFilename(firstNonEmpty(append(candidates, "video")...))
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".mkv", ".webm", ".mp3", ".m4a", ".mov":
		name = strings.TrimSuffix(name, filepath.Ext(name))
	}
	// Leave room for the extension and yt-dlp's intermediate ".f299.mp4.part" suffixes.
	for len(name) > 180 {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		name = "video"
	}
	return name
}

// mediaAttempts is how many times one media download runs before a temporary error is final.
const mediaAttempts = 3

func (m *Manager) runMediaDownload(ctx context.Context, dl *models.Download) {
	workDir := dl.TempFilePath
	if workDir == "" {
		workDir = tempPathFor(dl, m.settings.DownloadDirectory(m.cfg.DefaultDownloadDir))
		dl.TempFilePath = workDir
		_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Update("temp_file_path", workDir).Error
	}
	m.updateMedia(dl.ID, map[string]any{"stage": "Starting", "supports_resume": true})

	var lastReport time.Time
	lastStage := "Starting"
	onProgress := func(p media.Progress) {
		// Monotonic: after a resume yt-dlp skips finished streams and doesn't report them.
		if p.Downloaded > dl.DownloadedBytes {
			dl.DownloadedBytes = p.Downloaded
		}
		if p.Total > 0 {
			dl.FileSize = max(p.Total, dl.DownloadedBytes)
		}
		if dl.FileSize > 0 {
			dl.ProgressPercent = min(99.9, float64(dl.DownloadedBytes)/float64(dl.FileSize)*100)
		}
		dl.SpeedBytesPerSecond, dl.ETASeconds = p.Speed, p.ETA
		if time.Since(lastReport) < 500*time.Millisecond && p.Stage == lastStage {
			return
		}
		lastReport, lastStage = time.Now(), p.Stage
		m.updateMedia(dl.ID, map[string]any{
			"downloaded_bytes":       dl.DownloadedBytes,
			"file_size":              dl.FileSize,
			"progress_percent":       dl.ProgressPercent,
			"speed_bytes_per_second": dl.SpeedBytesPerSecond,
			"eta_seconds":            dl.ETASeconds,
			"stage":                  p.Stage,
		})
	}

	req := media.DownloadRequest{
		URL:            dl.URL,
		Referrer:       dl.Referrer,
		CookiesBrowser: m.settings.MediaCookiesBrowser(),
		QualityID:      dl.QualityID,
		WorkDir:        workDir,
		BaseName:       dl.Filename,
		EmbedMetadata:  m.settings.MediaEmbedMetadata(),
		Subtitles:      m.settings.MediaSubtitles(),
	}
	out, err := m.Media.Download(ctx, req, onProgress)
	// Streaming sites hand out short-lived, sometimes flaky format URLs (YouTube answers 403 to
	// a few). A fresh run fetches new URLs and resumes the .part files, so retry those quietly.
	for attempt := 2; err != nil && ctx.Err() == nil && media.Transient(err) && attempt <= mediaAttempts; attempt++ {
		m.appendLog(dl.ID, models.LogWarn, "retrying after a temporary error", err.Error())
		m.updateMedia(dl.ID, map[string]any{"stage": fmt.Sprintf("Retrying (%d of %d)", attempt, mediaAttempts)})
		select {
		case <-ctx.Done():
		case <-time.After(time.Duration(attempt) * 2 * time.Second):
		}
		if ctx.Err() == nil {
			out, err = m.Media.Download(ctx, req, onProgress)
		}
	}
	if err != nil {
		m.updateMedia(dl.ID, map[string]any{"stage": "", "speed_bytes_per_second": 0, "eta_seconds": 0})
		if ctx.Err() != nil {
			m.pauseOrCancel(dl, ctx.Err())
			var cur models.Download
			if m.db.First(&cur, "id = ?", dl.ID).Error == nil && cur.Status == models.DownloadCancelled {
				removeTemp(&cur)
			}
			return
		}
		if errors.Is(err, media.ErrDRM) {
			err = media.ErrDRM
		}
		m.fail(dl, err)
		return
	}

	finalPath, err := files.UniquePath(filepath.Dir(workDir), filepath.Base(out))
	if err != nil {
		m.fail(dl, err)
		return
	}
	if err := files.MoveOrReplace(out, finalPath); err != nil {
		m.fail(dl, fmt.Errorf("finalize move: %w", err))
		return
	}
	_ = os.RemoveAll(workDir)
	size := dl.DownloadedBytes
	if st, err := os.Stat(finalPath); err == nil {
		size = st.Size()
	}
	name := filepath.Base(finalPath)
	ext := extensionFromFilename(name)
	cat := dl.Category
	if cat == "" || cat == "other" {
		cat = CategoryForExtension(ext)
	}
	now := time.Now()
	m.updateMedia(dl.ID, map[string]any{
		"file_path":              finalPath,
		"temp_file_path":         "",
		"status":                 models.DownloadCompleted,
		"completed_at":           now,
		"progress_percent":       100.0,
		"eta_seconds":            int64(0),
		"speed_bytes_per_second": int64(0),
		"error_message":          "",
		"filename":               name,
		"original_filename":      name,
		"extension":              ext,
		"category":               cat,
		"mime_type":              mime.TypeByExtension("." + ext),
		"file_size":              size,
		"downloaded_bytes":       size,
		"stage":                  "",
	})
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", dl.ID).Update("status", models.QueueCompleted).Error
	m.appendLog(dl.ID, models.LogInfo, "download completed", name)
	m.log.Info("media download completed", "id", dl.ID, "path", finalPath)
}

func (m *Manager) updateMedia(id string, fields map[string]any) {
	fields["updated_at"] = time.Now()
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(fields).Error
}

// tempPathFor is a ".part" file for HTTP downloads and a hidden work directory for media ones.
func tempPathFor(dl *models.Download, dir string) string {
	if dl.Engine == models.EngineMedia {
		return filepath.Join(dir, ".fdm-"+dl.ID)
	}
	return filepath.Join(dir, dl.ID+".part")
}

func removeTemp(dl *models.Download) {
	if dl.TempFilePath == "" {
		return
	}
	if dl.Engine == models.EngineMedia && strings.HasPrefix(filepath.Base(dl.TempFilePath), ".fdm-") {
		_ = os.RemoveAll(dl.TempFilePath)
		return
	}
	_ = os.Remove(dl.TempFilePath)
}

// cleanThumbnail keeps an http(s) image URL, or returns "".
func cleanThumbnail(raw string) string {
	if t, err := url.Parse(strings.TrimSpace(raw)); err == nil && (t.Scheme == "https" || t.Scheme == "http") && t.Host != "" {
		return t.String()
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
