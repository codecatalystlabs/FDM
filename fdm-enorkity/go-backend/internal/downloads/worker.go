package downloads

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"fdm-enorkity/internal/files"
	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/security"
)

func (m *Manager) runDownload(ctx context.Context, dl *models.Download) {
	m.log.Info("download started", "id", dl.ID, "url", dl.URL, "engine", dl.Engine)
	if dl.Engine == models.EngineMedia {
		m.runMediaDownload(ctx, dl)
		return
	}

	if strings.TrimSpace(dl.TempFilePath) == "" {
		m.fail(dl, fmt.Errorf("temp file path not configured"))
		return
	}

	if err := os.MkdirAll(filepath.Dir(dl.TempFilePath), 0o755); err != nil {
		m.fail(dl, fmt.Errorf("create temp dir: %w", err))
		return
	}

	client := m.httpClient()
	allowPrivate := m.settings.AllowPrivateURLs()
	if _, err := security.ValidateDownloadURL(dl.URL, allowPrivate); err != nil {
		m.fail(dl, err)
		return
	}

	// HEAD for hints (optional). Send the same Referer as the GET: CDNs with hotlink protection
	// answer a bare HEAD with an HTML error page, whose headers must not be taken as the file's.
	supportsRange := false
	var headLen int64 = -1
	if headReq, err := http.NewRequestWithContext(ctx, http.MethodHead, dl.URL, nil); err == nil {
		if dl.Referrer != "" {
			headReq.Header.Set("Referer", dl.Referrer)
		}
		if headResp, err := client.Do(headReq); err == nil {
			_ = headResp.Body.Close()
			if headResp.StatusCode >= 200 && headResp.StatusCode < 300 {
				supportsRange = parseAcceptRanges(headResp.Header.Get("Accept-Ranges"))
				if cl := headResp.Header.Get("Content-Length"); cl != "" {
					if n, err := strconv.ParseInt(cl, 10, 64); err == nil {
						headLen = n
					}
				}
				applySuggestedFilename(dl, headResp)
				if mt := headResp.Header.Get("Content-Type"); mt != "" {
					dl.MimeType = mt
				}
			}
		}
	}

	existing := int64(0)
	if st, err := os.Stat(dl.TempFilePath); err == nil {
		existing = st.Size()
	}

	// Large files on servers that honour ranges download over several connections
	// (segmented.go). A single-stream partial file from before keeps resuming as one stream.
	if supportsRange && headLen > 0 && (m.hasSegments(dl.ID) || (existing == 0 && segmentCount(headLen, m.settings.ConnectionsPerDownload()) > 1)) {
		err := m.runSegmented(ctx, dl, m.segmentClient(), headLen)
		switch {
		case err == nil:
			m.finishHTTP(dl)
			return
		case ctx.Err() != nil:
			m.pauseOrCancel(dl, ctx.Err())
			return
		case errors.Is(err, errNoRanges):
			m.clearSegments(dl.ID)
			_ = os.Truncate(dl.TempFilePath, 0)
			existing = 0
			m.appendLog(dl.ID, models.LogInfo, "server ignored ranges; using one connection", "")
		default:
			m.fail(dl, err)
			return
		}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dl.URL, nil)
	if err != nil {
		m.fail(dl, err)
		return
	}
	if dl.Referrer != "" {
		req.Header.Set("Referer", dl.Referrer)
	}
	if supportsRange && existing > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", existing))
	}

	resp, err := client.Do(req)
	if err != nil {
		m.fail(dl, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		m.fail(dl, fmt.Errorf("unexpected status: %s", resp.Status))
		return
	}

	if resp.StatusCode == http.StatusPartialContent {
		dl.SupportsResume = true
	} else if supportsRange {
		dl.SupportsResume = true
	}

	applySuggestedFilename(dl, resp)
	if mt := resp.Header.Get("Content-Type"); mt != "" {
		dl.MimeType = mt
	}
	dl.FinalURL = resp.Request.URL.String()

	var total int64 = -1
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		if n, err := strconv.ParseInt(cl, 10, 64); err == nil {
			if resp.StatusCode == http.StatusPartialContent {
				// Content-Length on 206 is fragment size; total from Content-Range if present.
				if cr := resp.Header.Get("Content-Range"); cr != "" {
					if t := parseContentRangeTotal(cr); t > 0 {
						total = t
					} else {
						total = existing + n
					}
				} else {
					total = existing + n
				}
			} else {
				total = n
			}
		}
	}
	if total < 0 && headLen >= 0 {
		total = headLen
	}
	if total >= 0 {
		dl.FileSize = total
	}

	if resp.StatusCode == http.StatusOK && existing > 0 {
		// Server ignored Range; restart from scratch.
		existing = 0
		_ = os.Truncate(dl.TempFilePath, 0)
		dl.DownloadedBytes = 0
	}

	flags := os.O_CREATE | os.O_WRONLY
	if existing > 0 && resp.StatusCode == http.StatusPartialContent {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
		existing = 0
		dl.DownloadedBytes = 0
	}

	f, err := os.OpenFile(dl.TempFilePath, flags, 0o644)
	if err != nil {
		m.fail(dl, err)
		return
	}
	defer func() {
		if f != nil {
			_ = f.Close()
		}
	}()

	if existing == 0 && resp.StatusCode == http.StatusOK {
		dl.DownloadedBytes = 0
	} else {
		dl.DownloadedBytes = existing
	}

	limitBPS := m.settings.BandwidthLimitBPS()
	pr, pw := io.Pipe()
	go func() {
		_, copyErr := io.Copy(pw, resp.Body)
		_ = pw.CloseWithError(copyErr)
	}()
	defer pr.Close()

	readBuf := int(m.cfg.ChunkSizeBytes)
	if readBuf < 64*1024 {
		readBuf = 64 * 1024
	}
	if readBuf > 2*1024*1024 {
		readBuf = 2 * 1024 * 1024
	}
	buf := make([]byte, readBuf)
	start := time.Now()
	var lastReport time.Time
	var ema float64

	for {
		select {
		case <-ctx.Done():
			m.pauseOrCancel(dl, ctx.Err())
			return
		default:
		}
		n, rerr := pr.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				m.fail(dl, werr)
				return
			}
			dl.DownloadedBytes += int64(n)
			if limitBPS > 0 {
				// Pace to approximate limit across concurrent downloads (MVP: per-download throttle).
				delay := time.Duration(float64(n) / float64(limitBPS) * float64(time.Second))
				if delay > 0 {
					time.Sleep(delay)
				}
			}
			elapsed := time.Since(start).Seconds()
			if elapsed > 0.5 {
				inst := float64(dl.DownloadedBytes) / elapsed
				if ema == 0 {
					ema = inst
				} else {
					ema = 0.3*inst + 0.7*ema
				}
			}
			dl.SpeedBytesPerSecond = int64(ema)
			if dl.FileSize > 0 && ema > 0 {
				remain := float64(dl.FileSize - dl.DownloadedBytes)
				if remain < 0 {
					remain = 0
				}
				dl.ETASeconds = int64(remain / ema)
				dl.ProgressPercent = float64(dl.DownloadedBytes) / float64(dl.FileSize) * 100
			}
			if time.Since(lastReport) > 400*time.Millisecond {
				lastReport = time.Now()
				_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
					"downloaded_bytes":       dl.DownloadedBytes,
					"speed_bytes_per_second": dl.SpeedBytesPerSecond,
					"eta_seconds":            dl.ETASeconds,
					"progress_percent":       dl.ProgressPercent,
					"final_url":              dl.FinalURL,
					"mime_type":              dl.MimeType,
					"supports_resume":        dl.SupportsResume,
					"file_size":              dl.FileSize,
					"filename":               dl.Filename,
					"original_filename":      dl.OriginalFilename,
				}).Error
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			// A pause/cancel aborts the in-flight body read; that is a stop, not a failure.
			if ctx.Err() != nil {
				m.pauseOrCancel(dl, ctx.Err())
				return
			}
			m.fail(dl, rerr)
			return
		}
	}

	if dl.FileSize > 0 && dl.DownloadedBytes != dl.FileSize {
		m.appendLog(dl.ID, models.LogWarn, "size mismatch after download", fmt.Sprintf(`{"expected":%d,"got":%d}`, dl.FileSize, dl.DownloadedBytes))
	}

	if err := f.Sync(); err != nil {
		m.fail(dl, fmt.Errorf("sync temp file: %w", err))
		return
	}
	if err := f.Close(); err != nil {
		m.fail(dl, fmt.Errorf("close temp file: %w", err))
		return
	}
	f = nil
	m.finishHTTP(dl)
}

// finishHTTP names, categorises and moves a fully downloaded temp file into place.
func (m *Manager) finishHTTP(dl *models.Download) {
	if strings.TrimSpace(filepath.Ext(dl.Filename)) == "" {
		if ext := ExtensionFromMIME(dl.MimeType); ext != "" {
			base := strings.TrimSpace(dl.Filename)
			if base == "" {
				base = "download"
			}
			dl.Filename = base + ext
			if strings.TrimSpace(dl.OriginalFilename) == "" {
				dl.OriginalFilename = dl.Filename
			}
			dl.Extension = extensionFromFilename(dl.Filename)
		}
	}
	// The category was guessed at enqueue time, before headers revealed the real extension.
	if dl.Category == "" || dl.Category == "other" {
		dl.Category = CategoryForExtension(dl.Extension)
	}

	finalPath, err := files.UniquePath(filepath.Dir(dl.TempFilePath), dl.Filename)
	if err != nil {
		m.fail(dl, err)
		return
	}
	if err := files.MoveOrReplace(dl.TempFilePath, finalPath); err != nil {
		m.fail(dl, fmt.Errorf("finalize move: %w", err))
		return
	}

	dl.FilePath = finalPath
	dl.TempFilePath = ""
	dl.Status = models.DownloadCompleted
	dl.ProgressPercent = 100
	dl.ETASeconds = 0
	dl.SpeedBytesPerSecond = 0
	dl.ErrorMessage = ""

	now := time.Now()
	dl.CompletedAt = &now
	dl.UpdatedAt = now
	_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
		"file_path":         finalPath,
		"temp_file_path":    "",
		"status":            models.DownloadCompleted,
		"completed_at":      now,
		"progress_percent":  100.0,
		"eta_seconds":       int64(0),
		"speed_bytes_per_second": int64(0),
		"error_message":     "",
		"filename":          dl.Filename,
		"original_filename": dl.OriginalFilename,
		"extension":         dl.Extension,
		"category":          dl.Category,
		"final_url":         dl.FinalURL,
		"mime_type":         dl.MimeType,
		"file_size":         dl.FileSize,
		"downloaded_bytes":  dl.DownloadedBytes,
		"updated_at":        now,
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", dl.ID).Update("status", models.QueueCompleted).Error
	m.appendLog(dl.ID, models.LogInfo, "download completed", "")
	m.log.Info("download completed", "id", dl.ID, "path", finalPath)
}

func parseContentRangeTotal(cr string) int64 {
	// e.g. bytes 0-1023/2048
	parts := strings.Split(cr, "/")
	if len(parts) != 2 {
		return -1
	}
	t, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil {
		return -1
	}
	return t
}

func (m *Manager) fail(dl *models.Download, err error) {
	m.log.Error("download failed", "id", dl.ID, "err", err)
	msg := err.Error()
	now := time.Now()
	_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
		"status":        models.DownloadFailed,
		"error_message": msg,
		"updated_at":    now,
	}).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", dl.ID).Update("status", models.QueueFailed).Error
	m.appendLog(dl.ID, models.LogError, "download failed", msg)
}

func (m *Manager) pauseOrCancel(dl *models.Download, reason error) {
	if !errors.Is(reason, context.Canceled) {
		now := time.Now()
		_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
			"status":        models.DownloadFailed,
			"error_message": reason.Error(),
			"updated_at":    now,
		}).Error
		_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", dl.ID).Update("status", models.QueueFailed).Error
		return
	}
	var cur models.Download
	if err := m.db.First(&cur, "id = ?", dl.ID).Error; err != nil {
		return
	}
	if cur.Status == models.DownloadCancelled {
		m.appendLog(dl.ID, models.LogInfo, "download cancelled", "worker stopped")
		return
	}
	// Pause path: PauseDownload already marked rows as paused before canceling context.
	m.appendLog(dl.ID, models.LogInfo, "download worker stopped", "context canceled")
}

func applySuggestedFilename(dl *models.Download, resp *http.Response) {
	if resp == nil || dl.NamedByUser {
		return
	}
	fromCD := FilenameFromContentDisposition(resp)
	if fromCD != "" {
		dl.OriginalFilename = fromCD
		dl.Filename = fromCD
		dl.Extension = extensionFromFilename(fromCD)
		return
	}
	if dl.Source == "browser" {
		if fn := strings.TrimSpace(dl.Filename); fn != "" && fn != "download" {
			return
		}
	}
	raw := dl.URL
	if resp.Request != nil && resp.Request.URL != nil {
		raw = resp.Request.URL.String()
	}
	if fn := FilenameFromURLString(raw); fn != "" {
		dl.OriginalFilename = fn
		dl.Filename = fn
		dl.Extension = extensionFromFilename(fn)
	}
}
