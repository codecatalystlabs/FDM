package downloads

import (
	"testing"
	"time"

	"fdm-enorkity/internal/models"
)

func queueStatus(t *testing.T, m *Manager, id string) models.QueueItemStatus {
	t.Helper()
	var qi models.QueueItem
	if err := m.db.First(&qi, "download_id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return qi.Status
}

func countLogs(t *testing.T, m *Manager, id, message string) int64 {
	t.Helper()
	var n int64
	m.db.Model(&models.DownloadLog{}).Where("download_id = ? AND message = ?", id, message).Count(&n)
	return n
}

// A batch adds downloads while others finish. The scheduler must not start one before the caller
// has started (or night-scheduled) it, and starting it must never run it twice.
func TestNewDownloadWaitsUntilStarted(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 64<<10)
	srv, _ := fileServer(t, payload, true, 0)

	dl, err := m.AddDownload(AddDownloadInput{URL: srv.URL + "/ep5.mp4", PageTitle: "Heroes 5 by Vj Junior", Source: "browser"})
	if err != nil {
		t.Fatal(err)
	}
	m.schedule() // what a finishing download does
	time.Sleep(200 * time.Millisecond)
	if got, _ := m.GetDownload(dl.ID); got.Status != models.DownloadPending || queueStatus(t, m, dl.ID) != models.QueuePaused {
		t.Fatalf("added download picked up before it was started: status %s, queue %s", got.Status, queueStatus(t, m, dl.ID))
	}

	if err := m.StartDownload(dl.ID); err != nil {
		t.Fatal(err)
	}
	done := waitStatus(t, m, dl.ID, models.DownloadCompleted, 10*time.Second)
	assertFile(t, done.FilePath, payload)
	if err := m.StartDownload(dl.ID); err == nil {
		t.Error("StartDownload re-queued a finished download")
	}
	time.Sleep(200 * time.Millisecond)
	if got, _ := m.GetDownload(dl.ID); got.Status != models.DownloadCompleted || got.ErrorMessage != "" {
		t.Errorf("finished download changed to %s (%s)", got.Status, got.ErrorMessage)
	}
}

func TestStartWhileRunningIsNoOp(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 2<<20)
	srv, _ := fileServer(t, payload, false, 2*time.Millisecond) // single stream, slow
	id := start(t, m, srv.URL+"/slow.mp4")
	waitStatus(t, m, id, models.DownloadActive, 5*time.Second)
	for i := 0; i < 5; i++ {
		if err := m.StartDownload(id); err != nil {
			t.Fatal(err)
		}
	}
	done := waitStatus(t, m, id, models.DownloadCompleted, 30*time.Second)
	assertFile(t, done.FilePath, payload)
	time.Sleep(200 * time.Millisecond)
	if n := countLogs(t, m, id, "download failed"); n != 0 {
		t.Errorf("download ran twice: %d failures logged", n)
	}
	if got, _ := m.GetDownload(id); got.Status != models.DownloadCompleted {
		t.Errorf("status %s after a second start, want completed", got.Status)
	}
}

// Pausing an episode that is only waiting in the queue keeps it from starting when a slot frees.
func TestPausedQueuedDownloadStaysPaused(t *testing.T) {
	m, downloads := newTestManager(t)
	if err := m.settings.Patch(map[string]any{"max_concurrent_downloads": float64(1)}, downloads, 1); err != nil {
		t.Fatal(err)
	}
	slow, _ := fileServer(t, randomPayload(t, 1<<20), false, 2*time.Millisecond)
	fast, _ := fileServer(t, randomPayload(t, 32<<10), true, 0)

	a := start(t, m, slow.URL+"/a.mp4")
	waitStatus(t, m, a, models.DownloadActive, 5*time.Second)
	b := start(t, m, fast.URL+"/b.mp4")
	if got, _ := m.GetDownload(b); got.Status != models.DownloadQueued {
		t.Fatalf("second download status %s, want queued behind the first", got.Status)
	}
	if err := m.PauseDownload(b); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, m, a, models.DownloadCompleted, 30*time.Second)
	time.Sleep(300 * time.Millisecond)
	if got, _ := m.GetDownload(b); got.Status != models.DownloadPaused {
		t.Fatalf("paused download is %s after a slot freed up, want paused", got.Status)
	}
	if err := m.ResumeDownload(b); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, m, b, models.DownloadCompleted, 10*time.Second)
}
