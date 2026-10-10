package downloads

// ===== MULTI-CONNECTION DOWNLOADS =====
// Many CDNs cap the speed of each connection, so a big file fetched over one stream crawls even
// on a fast line. When the server supports byte ranges, a large file is split into segments that
// download in parallel and are written straight into place (WriteAt on a preallocated file).
// Each segment's progress is saved in download_chunks, so pause and resume pick up every segment
// where it stopped. A server that ignores Range (answers 200) drops us back to one stream.
//
// ===== WHY STATIC SEGMENTS =====
// Segments are fixed at the start rather than re-split as fast ones finish. That keeps resume
// state trivially correct (one row per byte range, never overlapping) at the cost of a slower
// tail when one connection is much slower than the rest — retries cover the common case of a
// segment stalling outright.

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"fdm-enorkity/internal/models"
)

const (
	segmentMinFile  = 8 << 20 // below this one stream is as fast
	segmentMinSize  = 4 << 20 // never split finer than this
	segmentMax      = 16      // hard ceiling; the user setting (default 4) applies below it
	segmentAttempts = 5
)

// segmentStall: a connection silent this long is dropped and retried (a var so tests can shorten it).
var segmentStall = 30 * time.Second

// errNoRanges means the server ignored Range after all; the caller restarts with one stream.
var errNoRanges = errors.New("server does not honour byte ranges")

// segmentCount picks how many connections a file of size bytes gets, at most limit.
func segmentCount(size int64, limit int) int {
	if limit > segmentMax {
		limit = segmentMax
	}
	if size < segmentMinFile || limit < 2 {
		return 1
	}
	n := int(size / segmentMinSize)
	if n > limit {
		n = limit
	}
	if n < 2 {
		n = 2
	}
	return n
}

// segmentClient is httpClient without HTTP/2. Over HTTP/2 every "connection" would be one more
// stream on a single TCP connection, which is exactly what per-connection speed caps measure
// (and some servers treat many parallel streams as abuse). HTTP/1.1 gives real connections.
func (m *Manager) segmentClient() *http.Client {
	c := m.httpClient()
	if t, ok := c.Transport.(*http.Transport); ok {
		t.ForceAttemptHTTP2 = false
		t.TLSNextProto = map[string]func(string, *tls.Conn) http.RoundTripper{}
		t.MaxIdleConnsPerHost = segmentMax
	}
	return c
}

// planSegments splits [0,size) into n contiguous inclusive ranges.
func planSegments(size int64, n int) [][2]int64 {
	out := make([][2]int64, 0, n)
	step := size / int64(n)
	var start int64
	for i := 0; i < n; i++ {
		end := start + step - 1
		if i == n-1 {
			end = size - 1
		}
		out = append(out, [2]int64{start, end})
		start = end + 1
	}
	return out
}

type segment struct {
	row  models.DownloadChunk
	done atomic.Int64 // bytes written in this segment
}

// pacer spreads the bandwidth limit across all segments of all downloads sharing it.
type pacer struct {
	mu   sync.Mutex
	next time.Time
}

func (p *pacer) wait(ctx context.Context, n int, bps int64) {
	if bps <= 0 || n <= 0 {
		return
	}
	p.mu.Lock()
	now := time.Now()
	if p.next.Before(now) {
		p.next = now
	}
	d := p.next.Sub(now)
	p.next = p.next.Add(time.Duration(float64(n) / float64(bps) * float64(time.Second)))
	p.mu.Unlock()
	if d <= 0 {
		return
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// loadSegments returns saved segments for dl when they still match the file on disk.
func (m *Manager) loadSegments(dl *models.Download, size int64) []*segment {
	var rows []models.DownloadChunk
	if err := m.db.Where("download_id = ?", dl.ID).Order("chunk_index").Find(&rows).Error; err != nil || len(rows) == 0 {
		return nil
	}
	st, err := os.Stat(dl.TempFilePath)
	if err != nil || st.Size() != size || rows[len(rows)-1].EndByte != size-1 {
		m.clearSegments(dl.ID)
		return nil
	}
	segs := make([]*segment, len(rows))
	for i, r := range rows {
		segs[i] = &segment{row: r}
		segs[i].done.Store(min(r.DownloadedBytes, r.EndByte-r.StartByte+1))
	}
	return segs
}

func (m *Manager) clearSegments(id string) {
	_ = m.db.Where("download_id = ?", id).Delete(&models.DownloadChunk{}).Error
}

func (m *Manager) hasSegments(id string) bool {
	var n int64
	_ = m.db.Model(&models.DownloadChunk{}).Where("download_id = ?", id).Count(&n).Error
	return n > 0
}

func (m *Manager) saveSegments(segs []*segment) {
	for _, s := range segs {
		done := s.done.Load()
		status := models.ChunkActive
		if done >= s.row.EndByte-s.row.StartByte+1 {
			status = models.ChunkCompleted
		}
		_ = m.db.Model(&models.DownloadChunk{}).Where("id = ?", s.row.ID).Updates(map[string]any{
			"downloaded_bytes": done,
			"status":           status,
		}).Error
	}
}

// runSegmented downloads dl (size bytes, ranges supported) over parallel connections into its
// temp file. It returns nil when every byte is on disk, errNoRanges to fall back to one stream,
// or the context / final segment error.
func (m *Manager) runSegmented(ctx context.Context, dl *models.Download, client *http.Client, size int64) error {
	segs := m.loadSegments(dl, size)
	if segs == nil {
		f, err := os.OpenFile(dl.TempFilePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		if err := f.Truncate(size); err != nil {
			_ = f.Close()
			return fmt.Errorf("reserve disk space: %w", err)
		}
		_ = f.Close()
		for i, r := range planSegments(size, segmentCount(size, m.settings.ConnectionsPerDownload())) {
			row := models.DownloadChunk{
				DownloadID: dl.ID, ChunkIndex: i, StartByte: r[0], EndByte: r[1],
				Status: models.ChunkPending, TempFilePath: dl.TempFilePath,
			}
			if err := m.db.Create(&row).Error; err != nil {
				return err
			}
			segs = append(segs, &segment{row: row})
		}
		m.appendLog(dl.ID, models.LogInfo, "multi-connection download", fmt.Sprintf(`{"connections":%d}`, len(segs)))
	}

	f, err := os.OpenFile(dl.TempFilePath, os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()

	dl.FileSize = size
	dl.SupportsResume = true
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	for _, s := range segs {
		if s.done.Load() >= s.row.EndByte-s.row.StartByte+1 {
			continue
		}
		wg.Add(1)
		go func(s *segment) {
			defer wg.Done()
			if err := m.fetchSegment(ctx, dl, client, f, s); err != nil && ctx.Err() == nil {
				errOnce.Do(func() { firstErr = err })
				cancel() // one segment failing for good stops the rest
			}
		}(s)
	}

	finished := make(chan struct{})
	go func() {
		wg.Wait()
		close(finished)
	}()
	tick := time.NewTicker(400 * time.Millisecond)
	defer tick.Stop()
	var ema float64
	last := sumDone(segs)
	lastAt := time.Now()
	lastSave := time.Now()
	report := func() {
		now := time.Now()
		total := sumDone(segs)
		if dt := now.Sub(lastAt).Seconds(); dt > 0 {
			inst := float64(total-last) / dt
			if ema == 0 {
				ema = inst
			} else {
				ema = 0.3*inst + 0.7*ema
			}
		}
		last, lastAt = total, now
		dl.DownloadedBytes = total
		dl.SpeedBytesPerSecond = int64(ema)
		dl.ProgressPercent = float64(total) / float64(size) * 100
		dl.ETASeconds = 0
		if ema > 0 {
			dl.ETASeconds = int64(float64(size-total) / ema)
		}
		_ = m.db.Model(&models.Download{}).Where("id = ?", dl.ID).Updates(map[string]any{
			"downloaded_bytes":       dl.DownloadedBytes,
			"speed_bytes_per_second": dl.SpeedBytesPerSecond,
			"eta_seconds":            dl.ETASeconds,
			"progress_percent":       dl.ProgressPercent,
			"supports_resume":        true,
			"file_size":              size,
			"mime_type":              dl.MimeType,
			"filename":               dl.Filename,
			"original_filename":      dl.OriginalFilename,
		}).Error
		if now.Sub(lastSave) > 2*time.Second {
			lastSave = now
			m.saveSegments(segs)
		}
	}
loop:
	for {
		select {
		case <-finished:
			break loop
		case <-tick.C:
			report()
		}
	}
	m.saveSegments(segs)
	report()

	if firstErr != nil {
		return firstErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if sumDone(segs) != size {
		return fmt.Errorf("incomplete download: %d of %d bytes", sumDone(segs), size)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync temp file: %w", err)
	}
	m.clearSegments(dl.ID)
	return nil
}

func sumDone(segs []*segment) int64 {
	var n int64
	for _, s := range segs {
		n += s.done.Load()
	}
	return n
}

// fetchSegment downloads one byte range, retrying dropped connections with back-off.
func (m *Manager) fetchSegment(ctx context.Context, dl *models.Download, client *http.Client, f *os.File, s *segment) error {
	length := s.row.EndByte - s.row.StartByte + 1
	var err error
	for attempt := 1; attempt <= segmentAttempts; attempt++ {
		if s.done.Load() >= length {
			return nil
		}
		err = m.fetchRange(ctx, dl, client, f, s)
		if err == nil || ctx.Err() != nil || errors.Is(err, errNoRanges) || errors.Is(err, errFatalStatus) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt) * time.Second):
		}
	}
	return err
}

var errFatalStatus = errors.New("server refused the segment")

func (m *Manager) fetchRange(ctx context.Context, dl *models.Download, client *http.Client, f *os.File, s *segment) error {
	from := s.row.StartByte + s.done.Load()
	// Watchdog: a connection that stops delivering bytes is cut so fetchSegment can reconnect.
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var stalled atomic.Bool
	watchdog := time.AfterFunc(segmentStall, func() {
		stalled.Store(true)
		cancel()
	})
	defer watchdog.Stop()
	err := m.readRange(ctx, dl, client, f, s, from, watchdog)
	if err != nil && stalled.Load() {
		return fmt.Errorf("connection stalled for %s", segmentStall)
	}
	return err
}

func (m *Manager) readRange(ctx context.Context, dl *models.Download, client *http.Client, f *os.File, s *segment, from int64, watchdog *time.Timer) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dl.URL, nil)
	if err != nil {
		return err
	}
	if dl.Referrer != "" {
		req.Header.Set("Referer", dl.Referrer)
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", from, s.row.EndByte))
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return errNoRanges
	case resp.StatusCode == http.StatusPartialContent:
	case resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests:
		return fmt.Errorf("unexpected status: %s", resp.Status)
	default:
		return fmt.Errorf("%w: %s", errFatalStatus, resp.Status)
	}
	if cr := resp.Header.Get("Content-Range"); cr != "" && !strings.HasPrefix(strings.TrimSpace(cr), fmt.Sprintf("bytes %d-", from)) {
		return errNoRanges
	}

	limit := m.settings.BandwidthLimitBPS()
	buf := make([]byte, 256*1024)
	off := from
	end := s.row.EndByte + 1
	for off < end {
		want := int64(len(buf))
		if rest := end - off; rest < want {
			want = rest
		}
		n, rerr := resp.Body.Read(buf[:want])
		if n > 0 {
			watchdog.Reset(segmentStall)
			if _, werr := f.WriteAt(buf[:n], off); werr != nil {
				return werr
			}
			off += int64(n)
			s.done.Add(int64(n))
			m.pace.wait(ctx, n, limit)
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if off < end {
		return io.ErrUnexpectedEOF
	}
	return nil
}
