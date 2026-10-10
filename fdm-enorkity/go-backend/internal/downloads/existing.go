package downloads

import (
	"os"
	"path/filepath"
	"strings"

	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/security"
)

// Skip-existing: a batch (every episode of a series) may include files the user already has or
// has queued. AddDownloadInput.SkipExisting returns that download instead of fetching it again.

// existingName is the name, without extension, a new download would be saved under; "" when the
// name would come from the URL, which says nothing about what the file is.
func existingName(in AddDownloadInput) string {
	raw := firstNonEmpty(in.Filename, in.PageTitle)
	if in.Engine == models.EngineMedia {
		raw = firstNonEmpty(in.Filename, in.Title, in.PageTitle)
	}
	if raw == "" {
		return ""
	}
	return stripExt(security.SanitizeFilename(raw))
}

// stripExt drops a file extension, but not the tail of a title with a dot in it ("Mr. Robot 2").
func stripExt(name string) string {
	ext := filepath.Ext(name)
	if len(ext) < 2 || len(ext) > 6 || strings.ContainsAny(ext, " _-()") {
		return strings.TrimSpace(name)
	}
	return strings.TrimSpace(strings.TrimSuffix(name, ext))
}

// findExisting returns a download saved, or about to be saved, under name: queued, running or
// paused, or finished with its file still on disk. Failed and cancelled ones don't count.
func (m *Manager) findExisting(name string) *models.Download {
	if name == "" {
		return nil
	}
	var rows []models.Download
	err := m.db.Where("filename LIKE ? ESCAPE '\\' AND status NOT IN ?", escapeLike(name)+"%",
		[]models.DownloadStatus{models.DownloadFailed, models.DownloadCancelled}).
		Order("created_at ASC").Find(&rows).Error
	if err != nil {
		return nil
	}
	for i := range rows {
		d := &rows[i]
		if !strings.EqualFold(stripExt(d.Filename), name) {
			continue
		}
		if d.Status == models.DownloadCompleted {
			if d.FilePath == "" {
				continue
			}
			if _, err := os.Stat(d.FilePath); err != nil {
				continue // deleted from disk: fetch it again
			}
		}
		return d
	}
	return nil
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
