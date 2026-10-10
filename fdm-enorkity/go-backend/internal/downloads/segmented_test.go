package downloads

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"fdm-enorkity/internal/config"
	"fdm-enorkity/internal/database"
	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/settings"
)

func TestPlanSegments(t *testing.T) {
	if n := segmentCount(5<<20, 4); n != 1 {
		t.Errorf("5 MB -> %d segments, want 1", n)
	}
	if n := segmentCount(10<<20, 4); n != 2 {
		t.Errorf("10 MB -> %d segments, want 2", n)
	}
	if n := segmentCount(2<<30, 4); n != 4 {
		t.Errorf("2 GB -> %d segments, want the setting's 4", n)
	}
	if n := segmentCount(2<<30, 1); n != 1 {
		t.Errorf("connections=1 -> %d segments, want 1", n)
	}
	if n := segmentCount(2<<30, 99); n != segmentMax {
		t.Errorf("connections=99 -> %d segments, want cap %d", n, segmentMax)
	}
	segs := planSegments(1001, 4)
	var next int64
	for _, s := range segs {
		if s[0] != next || s[1] < s[0] {
			t.Fatalf("segments not contiguous: %v", segs)
		}
		next = s[1] + 1
	}
	if next != 1001 {
		t.Fatalf("segments cover %d bytes, want 1001", next)
	}
}

func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Connect(filepath.Join(dir, "fdm.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	st := &settings.Store{DB: db}
	downloads := filepath.Join(dir, "downloads")
	if err := st.EnsureDefaults(downloads, 3); err != nil {
		t.Fatal(err)
	}
	if err := st.Patch(map[string]any{"allow_private_urls": true}, downloads, 3); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{DefaultDownloadDir: downloads, MaxConcurrentDownloads: 3, ChunkSizeBytes: 1 << 20, StorageRoot: dir}
	return NewManager(db, slog.New(slog.NewTextHandler(io.Discard, nil)), cfg, st), downloads
}

// fileServer serves payload with full range support and counts ranged GETs.
func fileServer(t *testing.T, payload []byte, honourRanges bool, delay time.Duration) (*httptest.Server, *atomic.Int64) {
	t.Helper()
	var ranged atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.Header.Get("Range") != "" {
			ranged.Add(1)
		}
		if !honourRanges && r.Method == http.MethodGet {
			r.Header.Del("Range") // advertises ranges on HEAD, ignores them on GET
		}
		w.Header().Set("Content-Type", "video/mp4")
		var body io.ReadSeeker = bytes.NewReader(payload)
		if delay > 0 {
			body = &slowReader{ReadSeeker: body, delay: delay}
		}
		http.ServeContent(w, r, "movie.mp4", time.Time{}, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &ranged
}

type slowReader struct {
	io.ReadSeeker
	delay time.Duration
}

func (s *slowReader) Read(p []byte) (int, error) {
	time.Sleep(s.delay)
	if len(p) > 64*1024 {
		p = p[:64*1024]
	}
	return s.ReadSeeker.Read(p)
}

func waitStatus(t *testing.T, m *Manager, id string, want models.DownloadStatus, within time.Duration) models.Download {
	t.Helper()
	deadline := time.Now().Add(within)
	var dl models.Download
	for time.Now().Before(deadline) {
		if err := m.db.First(&dl, "id = ?", id).Error; err == nil && dl.Status == want {
			return dl
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("download %s: status %q (%s), want %q", id, dl.Status, dl.ErrorMessage, want)
	return dl
}

func randomPayload(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return b
}

func start(t *testing.T, m *Manager, url string) string {
	t.Helper()
	dl, err := m.AddDownload(AddDownloadInput{URL: url, Source: "desktop"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.StartDownload(dl.ID); err != nil {
		t.Fatal(err)
	}
	return dl.ID
}

func assertFile(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("%s: %d bytes on disk differ from the %d served", path, len(got), len(want))
	}
}

func TestSegmentedDownload(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 20<<20+12345)
	srv, ranged := fileServer(t, payload, true, 0)

	dl := waitStatus(t, m, start(t, m, srv.URL+"/movie.mp4"), models.DownloadCompleted, 20*time.Second)
	assertFile(t, dl.FilePath, payload)
	if n := ranged.Load(); n < 2 {
		t.Errorf("%d ranged requests, want one per segment", n)
	}
	if m.hasSegments(dl.ID) {
		t.Error("segment rows should be cleared after completion")
	}
	if !strings.HasSuffix(dl.FilePath, ".mp4") || dl.Category != "video" {
		t.Errorf("path %q category %q", dl.FilePath, dl.Category)
	}
}

func TestSegmentedFallsBackWhenRangesIgnored(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 12<<20)
	srv, _ := fileServer(t, payload, false, 0)

	dl := waitStatus(t, m, start(t, m, srv.URL+"/movie.mp4"), models.DownloadCompleted, 20*time.Second)
	assertFile(t, dl.FilePath, payload)
}

func TestSegmentedPauseResume(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 16<<20)
	srv, _ := fileServer(t, payload, true, 20*time.Millisecond)

	id := start(t, m, srv.URL+"/movie.mp4")
	deadline := time.Now().Add(10 * time.Second)
	for {
		var dl models.Download
		_ = m.db.First(&dl, "id = ?", id).Error
		if dl.DownloadedBytes > 2<<20 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no progress: %+v", dl)
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := m.PauseDownload(id); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, m, id, models.DownloadPaused, 5*time.Second)
	time.Sleep(300 * time.Millisecond) // let the workers stop and save their segments
	if !m.hasSegments(id) {
		t.Fatal("paused download should keep its segment progress")
	}
	var saved []models.DownloadChunk
	_ = m.db.Where("download_id = ?", id).Find(&saved).Error
	var kept int64
	for _, c := range saved {
		kept += c.DownloadedBytes
	}
	if kept == 0 || kept >= int64(len(payload)) {
		t.Fatalf("saved progress = %d bytes, want partial", kept)
	}

	if err := m.ResumeDownload(id); err != nil {
		t.Fatal(err)
	}
	dl := waitStatus(t, m, id, models.DownloadCompleted, 60*time.Second)
	assertFile(t, dl.FilePath, payload)
}

func TestSegmentedRecoversFromStalledConnection(t *testing.T) {
	old := segmentStall
	segmentStall = 400 * time.Millisecond
	defer func() { segmentStall = old }()

	m, _ := newTestManager(t)
	payload := randomPayload(t, 12<<20)
	var stalledOnce atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The first ranged request that doesn't start at 0 sends 1 MB and then goes silent.
		if rg := r.Header.Get("Range"); r.Method == http.MethodGet && rg != "" && !strings.HasPrefix(rg, "bytes=0-") && stalledOnce.CompareAndSwap(false, true) {
			var from, to int64
			_, _ = fmt.Sscanf(rg, "bytes=%d-%d", &from, &to)
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", from, to, len(payload)))
			w.Header().Set("Content-Length", fmt.Sprint(to-from+1))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write(payload[from : from+1<<20])
			w.(http.Flusher).Flush()
			select {
			case <-r.Context().Done():
			case <-time.After(10 * time.Second):
			}
			return
		}
		http.ServeContent(w, r, "movie.mp4", time.Time{}, bytes.NewReader(payload))
	}))
	defer srv.Close()

	dl := waitStatus(t, m, start(t, m, srv.URL+"/movie.mp4"), models.DownloadCompleted, 20*time.Second)
	if !stalledOnce.Load() {
		t.Fatal("test server never stalled a connection")
	}
	assertFile(t, dl.FilePath, payload)
}

func TestRecoverInterruptedResumes(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 3<<20)
	srv, _ := fileServer(t, payload, true, 0)
	dl, err := m.AddDownload(AddDownloadInput{URL: srv.URL + "/movie.mp4", Source: "desktop"})
	if err != nil {
		t.Fatal(err)
	}
	// As if the app quit mid-download: marked active, no worker running.
	_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Update("status", models.DownloadActive).Error
	_ = m.db.Model(&models.QueueItem{}).Where("download_id = ?", dl.ID).Update("status", models.QueueActive).Error
	if n := m.RecoverInterrupted(); n != 1 {
		t.Fatalf("recovered %d downloads, want 1", n)
	}
	got := waitStatus(t, m, dl.ID, models.DownloadCompleted, 10*time.Second)
	assertFile(t, got.FilePath, payload)
}

func TestUserFilenameWins(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 64<<10)
	srv, _ := fileServer(t, payload, true, 0)
	dl, err := m.AddDownload(AddDownloadInput{URL: srv.URL + "/eyJhbGciOi.mp4", Filename: "Fall 2 Deadpoint", Source: "desktop"})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.StartDownload(dl.ID); err != nil {
		t.Fatal(err)
	}
	got := waitStatus(t, m, dl.ID, models.DownloadCompleted, 10*time.Second)
	if filepath.Base(got.FilePath) != "Fall 2 Deadpoint.mp4" {
		t.Errorf("saved as %q, want the name the user typed plus the type's extension", filepath.Base(got.FilePath))
	}
	assertFile(t, got.FilePath, payload)
}
