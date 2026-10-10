package downloads

import (
	"testing"
	"time"

	"fdm-enorkity/internal/models"
)

func at(h, m int) time.Time { return time.Date(2026, 10, 10, h, m, 0, 0, time.Local) }

func TestNightWindow(t *testing.T) {
	h := time.Hour
	if !inWindow(at(3, 0), 0, 6*h) || inWindow(at(7, 0), 0, 6*h) || inWindow(at(6, 0), 0, 6*h) {
		t.Error("00:00–06:00 window wrong")
	}
	if !inWindow(at(23, 30), 23*h, 5*h) || !inWindow(at(4, 0), 23*h, 5*h) || inWindow(at(12, 0), 23*h, 5*h) {
		t.Error("23:00–05:00 (past midnight) window wrong")
	}
	if got := nextWindowStart(at(7, 0), 0, 6*h); !got.Equal(time.Date(2026, 10, 11, 0, 0, 0, 0, time.Local)) {
		t.Errorf("next start after 07:00 = %v, want tomorrow 00:00", got)
	}
	if got := nextWindowStart(at(12, 0), 23*h, 5*h); !got.Equal(at(23, 0)) {
		t.Errorf("next start after 12:00 = %v, want today 23:00", got)
	}
	if got := nextWindowStart(at(3, 0), 0, 6*h); !got.Equal(at(3, 0)) {
		t.Errorf("inside the window starts now, got %v", got)
	}
}

func TestNightDownloadWaitsRunsAndPauses(t *testing.T) {
	m, downloads := newTestManager(t)
	now := time.Now()
	// A window that opens two hours from now, so "tonight" means "wait".
	open := now.Add(2 * time.Hour)
	if err := m.settings.Patch(map[string]any{
		"night_start": open.Format("15:04"), "night_end": now.Add(3 * time.Hour).Format("15:04"),
	}, downloads, 3); err != nil {
		t.Fatal(err)
	}
	payload := randomPayload(t, 2<<20)
	srv, _ := fileServer(t, payload, true, 0)
	dl, err := m.AddDownload(AddDownloadInput{URL: srv.URL + "/movie.mp4", Source: "desktop"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := m.ScheduleNight(dl.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != models.DownloadPaused || !got.NightOnly || got.StartAfter == nil || got.StartAfter.Before(now) {
		t.Fatalf("scheduled download = status %s night %v start %v", got.Status, got.NightOnly, got.StartAfter)
	}

	// Window opens: it starts and finishes.
	m.nightTick(got.StartAfter.Add(time.Minute))
	done := waitStatus(t, m, dl.ID, models.DownloadCompleted, 10*time.Second)
	assertFile(t, done.FilePath, payload)

	// A night download still queued when the window closes waits for the next night.
	dl2, _ := m.AddDownload(AddDownloadInput{URL: srv.URL + "/two.mp4", Source: "desktop"})
	_ = m.db.Model(&models.Download{}).Where("id = ?", dl2.ID).Updates(map[string]any{"night_only": true, "status": models.DownloadQueued}).Error
	m.nightTick(now) // outside the window
	var paused models.Download
	_ = m.db.First(&paused, "id = ?", dl2.ID).Error
	if paused.Status != models.DownloadPaused || paused.StartAfter == nil {
		t.Fatalf("after window closed: status %s start %v, want paused until next night", paused.Status, paused.StartAfter)
	}

	// Start now overrides the schedule.
	if err := m.StartNow(dl2.ID); err != nil {
		t.Fatal(err)
	}
	now2 := waitStatus(t, m, dl2.ID, models.DownloadCompleted, 10*time.Second)
	if now2.NightOnly || now2.StartAfter != nil {
		t.Errorf("start now should clear the night schedule: %+v", now2)
	}
}
