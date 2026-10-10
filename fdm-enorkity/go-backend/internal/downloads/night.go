package downloads

// ===== NIGHT DATA =====
// In Uganda (and much of Africa) mobile data is far cheaper at night: MTN and Airtel sell night
// bundles that run from about midnight to 6 a.m. A "Download tonight" download waits, paused,
// until the night window opens, runs inside it, and if it isn't finished when the window closes
// it pauses again and carries on the next night. A ticker checks every 30 seconds; the window
// is a setting (night_start / night_end, local time) because bundles differ by network.

import (
	"context"
	"time"

	"fdm-enorkity/internal/models"
)

// inWindow reports whether t falls inside [start, end), wrapping past midnight when start > end.
func inWindow(t time.Time, start, end time.Duration) bool {
	if start == end {
		return true // a 24-hour window
	}
	tod := time.Duration(t.Hour())*time.Hour + time.Duration(t.Minute())*time.Minute + time.Duration(t.Second())*time.Second
	if start < end {
		return tod >= start && tod < end
	}
	return tod >= start || tod < end
}

// nextWindowStart is t when t is inside the window, else the next time the window opens.
func nextWindowStart(t time.Time, start, end time.Duration) time.Time {
	if inWindow(t, start, end) {
		return t
	}
	midnight := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
	next := midnight.Add(start)
	if !next.After(t) {
		next = midnight.AddDate(0, 0, 1).Add(start)
	}
	return next
}

// ScheduleNight makes id a night download: it starts now if the window is open, otherwise it
// waits (paused) until the window opens.
func (m *Manager) ScheduleNight(id string) (*models.Download, error) {
	start, end := m.settings.NightWindow()
	now := time.Now()
	if err := m.db.Model(&models.Download{}).Where("id = ?", id).Update("night_only", true).Error; err != nil {
		return nil, err
	}
	if inWindow(now, start, end) {
		_ = m.db.Model(&models.Download{}).Where("id = ?", id).Update("start_after", nil).Error
		if err := m.StartDownload(id); err != nil {
			return nil, err
		}
	} else {
		at := nextWindowStart(now, start, end)
		_ = m.PauseDownload(id)
		_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
			"status":      models.DownloadPaused,
			"start_after": at,
		}).Error
		_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", id).Update("status", models.QueuePaused).Error
		m.appendLog(id, models.LogInfo, "waiting for night data", at.Format(time.RFC3339))
	}
	return m.GetDownload(id)
}

// StartNow drops a download's night schedule and starts (or resumes) it right away.
func (m *Manager) StartNow(id string) error {
	_ = m.db.Model(&models.Download{}).Where("id = ?", id).Updates(map[string]any{
		"night_only":  false,
		"start_after": nil,
	}).Error
	dl, err := m.GetDownload(id)
	if err != nil {
		return err
	}
	if dl.Status == models.DownloadPaused || dl.Status == models.DownloadFailed {
		return m.ResumeDownload(id)
	}
	return m.StartDownload(id)
}

// RunNightScheduler starts and stops night downloads as the window opens and closes.
func (m *Manager) RunNightScheduler(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		m.nightTick(time.Now())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (m *Manager) nightTick(now time.Time) {
	start, end := m.settings.NightWindow()
	if inWindow(now, start, end) {
		var due []models.Download
		_ = m.db.Where("status = ? AND night_only = ? AND start_after IS NOT NULL AND start_after <= ?",
			models.DownloadPaused, true, now).Find(&due).Error
		for _, d := range due {
			_ = m.db.Model(&models.Download{}).Where("id = ?", d.ID).Update("start_after", nil).Error
			if err := m.ResumeDownload(d.ID); err == nil {
				m.appendLog(d.ID, models.LogInfo, "night data window open; downloading", "")
			}
		}
		return
	}
	var running []models.Download
	_ = m.db.Where("night_only = ? AND status IN ?", true,
		[]models.DownloadStatus{models.DownloadActive, models.DownloadQueued, models.DownloadPending}).Find(&running).Error
	next := nextWindowStart(now, start, end)
	for _, d := range running {
		_ = m.PauseDownload(d.ID)
		_ = m.db.Model(&models.Download{}).Where("id = ?", d.ID).Updates(map[string]any{
			"status":      models.DownloadPaused,
			"start_after": next,
		}).Error
		m.appendLog(d.ID, models.LogInfo, "night data window closed; continuing next night", next.Format(time.RFC3339))
	}
}
