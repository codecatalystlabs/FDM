package media

import (
	"bufio"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DownloadRequest describes one media download.
type DownloadRequest struct {
	URL            string
	Referrer       string
	CookiesBrowser string
	QualityID      string
	WorkDir        string // isolated directory for this download's .part files
	BaseName       string // output file name without extension
	EmbedMetadata  bool   // title, artist, cover art (and chapters for video) inside the file
	Subtitles      bool   // embed English subtitles when the video has them
}

// Progress is reported while yt-dlp runs.
type Progress struct {
	Downloaded int64
	Total      int64 // -1 when unknown
	Speed      int64 // bytes/sec
	ETA        int64 // seconds
	Stage      string
}

// IsAudio reports whether a quality id produces an audio-only file.
func IsAudio(qualityID string) bool { return strings.HasPrefix(qualityID, "a-") }

// QualityLabel is the short label stored on the download for a quality id.
func QualityLabel(qualityID string) string {
	switch {
	case qualityID == "" || qualityID == "best":
		return "Best"
	case qualityID == "a-mp3":
		return "MP3"
	case qualityID == "a-m4a":
		return "M4A"
	case strings.HasPrefix(qualityID, "v"):
		if r, err := strconv.Atoi(qualityID[1:]); err == nil {
			return resLabel(r)
		}
	}
	return qualityID
}

// ValidQuality reports whether id is one Probe can produce.
func ValidQuality(id string) bool {
	switch id {
	case "", "best", "a-mp3", "a-m4a":
		return true
	}
	if strings.HasPrefix(id, "v") {
		r, err := strconv.Atoi(id[1:])
		return err == nil && r > 0 && r <= 8640
	}
	return false
}

// formatArgs maps a quality id to yt-dlp format selection. Sorting prefers H.264/AAC so the
// result merges into a widely playable MP4; resolutions only offered as VP9 merge into MKV.
func formatArgs(qualityID string) []string {
	switch qualityID {
	case "a-mp3":
		return []string{"-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0"}
	case "a-m4a":
		return []string{"-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a"}
	}
	sortSpec := "res,fps,vcodec:h264,acodec:aac"
	if strings.HasPrefix(qualityID, "v") {
		sortSpec = "res:" + qualityID[1:] + ",fps,vcodec:h264,acodec:aac"
	}
	return []string{"-f", "bv*+ba/b", "-S", sortSpec, "--merge-output-format", "mp4/mkv"}
}

// extraArgs adds the finishing touches: embedded metadata and cover art make files look right
// in music players and TV apps; subtitles are embedded rather than left as loose .vtt files.
func extraArgs(req DownloadRequest) []string {
	var args []string
	audio := IsAudio(req.QualityID)
	if req.EmbedMetadata {
		args = append(args, "--embed-metadata", "--embed-thumbnail")
		if !audio {
			args = append(args, "--embed-chapters")
		}
	}
	if req.Subtitles && !audio {
		args = append(args, "--embed-subs", "--sub-langs", "en.*,en")
	}
	return args
}

const (
	tagDL   = "[fdm-dl] "
	tagPP   = "[fdm-pp] "
	tagFmt  = "[fdm-fmt] "
	tagFile = "[fdm-file] "
)

// Download runs yt-dlp until the file is complete and returns its path inside WorkDir.
// Cancelling ctx kills yt-dlp (and its ffmpeg children); .part files stay for a later resume.
func (e *Engine) Download(ctx context.Context, req DownloadRequest, onProgress func(Progress)) (string, error) {
	bin, err := e.Ytdlp()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(req.WorkDir, 0o755); err != nil {
		return "", err
	}
	base := strings.ReplaceAll(req.BaseName, "%", "%%") // literal name, not a yt-dlp template
	args := []string{
		"--newline", "--quiet", "--progress", "--no-simulate", "--continue", "--no-mtime",
		// HLS/DASH streams (TikTok, Vimeo, most players) arrive as fragments; fetch 4 at a time.
		"--concurrent-fragments", "4",
		"--progress-template", "download:" + tagDL + "%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
		"--progress-template", "postprocess:" + tagPP + "%(progress.status)s|%(progress.postprocessor)s",
		"--print", "before_dl:" + tagFmt + "%(format_id)s|%(filesize,filesize_approx)s",
		"--print", "after_move:" + tagFile + "%(filepath)s",
		"-o", filepath.Join(req.WorkDir, base+".%(ext)s"),
	}
	args = append(args, e.commonArgs(req.Referrer, req.CookiesBrowser)...)
	args = append(args, formatArgs(req.QualityID)...)
	args = append(args, extraArgs(req)...)
	args = append(args, "--", req.URL)

	cmd := exec.CommandContext(ctx, bin, args...)
	prepareCmd(cmd)
	cmd.WaitDelay = 5 * time.Second
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err := cmd.Start(); err != nil {
		return "", err
	}

	var errTail tail
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		errTail.consume(stderr)
	}()

	t := newTracker(req.QualityID)
	finalPath := ""
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, tagFile):
			finalPath = strings.TrimSpace(strings.TrimPrefix(line, tagFile))
		case strings.HasPrefix(line, tagFmt):
			t.formats(strings.TrimPrefix(line, tagFmt))
		case strings.HasPrefix(line, tagDL):
			if p, ok := t.download(strings.TrimPrefix(line, tagDL)); ok && onProgress != nil {
				onProgress(p)
			}
		case strings.HasPrefix(line, tagPP):
			if p, ok := t.postprocess(strings.TrimPrefix(line, tagPP)); ok && onProgress != nil {
				onProgress(p)
			}
		}
	}
	wg.Wait()
	waitErr := cmd.Wait()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if waitErr != nil {
		return "", probeError(errTail.String(), waitErr)
	}
	if finalPath == "" {
		finalPath = findOutput(req.WorkDir)
	}
	if finalPath == "" {
		return "", errors.New("yt-dlp finished but produced no file")
	}
	return finalPath, nil
}

// Transient reports whether a download error is worth an automatic retry: expired or refused
// stream URLs, server hiccups and dropped connections, but not DRM, removed or private videos.
func Transient(err error) bool {
	if err == nil || errors.Is(err, ErrDRM) {
		return false
	}
	low := strings.ToLower(err.Error())
	for _, s := range []string{
		"http error 403", "http error 429", "http error 5", "timed out", "timeout", "connection reset",
		"connection refused", "broken pipe", "eof", "temporary failure", "unable to download video data",
		"fragment", "incomplete", "remote end closed",
	} {
		if strings.Contains(low, s) {
			return true
		}
	}
	return false
}

// findOutput returns the largest finished (non-.part) file in dir.
func findOutput(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	best, bestSize := "", int64(-1)
	for _, en := range entries {
		name := en.Name()
		if en.IsDir() || strings.HasSuffix(name, ".part") || strings.HasSuffix(name, ".ytdl") {
			continue
		}
		if info, err := en.Info(); err == nil && info.Size() > bestSize {
			best, bestSize = filepath.Join(dir, name), info.Size()
		}
	}
	return best
}

// tracker folds per-stream yt-dlp progress (video, then audio) into one overall figure.
type tracker struct {
	qualityID string
	parts     []string // requested format ids, video first
	estimate  int64
	got       map[string][2]int64 // format id -> downloaded, total
	last      Progress
}

func newTracker(qualityID string) *tracker {
	return &tracker{qualityID: qualityID, estimate: -1, got: map[string][2]int64{}, last: Progress{Total: -1, Stage: "Starting"}}
}

func (t *tracker) formats(s string) {
	f := strings.Split(s, "|")
	if len(f) < 2 {
		return
	}
	t.parts = strings.Split(f[0], "+")
	t.estimate = num(f[1])
}

func (t *tracker) download(s string) (Progress, bool) {
	f := strings.Split(s, "|")
	if len(f) < 7 {
		return Progress{}, false
	}
	status, done, total, totalEst, speed, eta, fid := f[0], num(f[1]), num(f[2]), num(f[3]), num(f[4]), num(f[5]), f[6]
	if total <= 0 {
		total = totalEst
	}
	if status == "finished" && total > 0 {
		done = total
	}
	t.got[fid] = [2]int64{max(done, 0), total}

	var sumDone, sumTotal int64
	for _, v := range t.got {
		sumDone += v[0]
		if v[1] > 0 {
			sumTotal += v[1]
		}
	}
	overall := t.estimate
	if sumTotal > overall {
		overall = sumTotal
	}
	stage := "Downloading video"
	switch {
	case IsAudio(t.qualityID):
		stage = "Downloading audio"
	case len(t.parts) > 1 && fid == t.parts[len(t.parts)-1]:
		stage = "Downloading audio"
	case len(t.parts) <= 1:
		stage = "Downloading"
	}
	t.last = Progress{Downloaded: sumDone, Total: overall, Speed: max(speed, 0), ETA: max(eta, 0), Stage: stage}
	return t.last, true
}

func (t *tracker) postprocess(s string) (Progress, bool) {
	f := strings.Split(s, "|")
	if len(f) < 2 || f[0] != "started" {
		return Progress{}, false
	}
	switch f[1] {
	case "Merger":
		t.last.Stage = "Merging"
	case "ExtractAudio":
		t.last.Stage = "Converting audio"
	default:
		t.last.Stage = "Finalizing"
	}
	t.last.Speed, t.last.ETA = 0, 0
	return t.last, true
}

// num parses yt-dlp template numbers ("NA" or floats like "123.45") as int64, -1 when absent.
func num(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" || s == "NA" || s == "None" {
		return -1
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return -1
	}
	return int64(v)
}

// tail keeps the last few stderr lines for error reporting.
type tail struct {
	mu    sync.Mutex
	lines []string
}

func (t *tail) consume(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		t.mu.Lock()
		t.lines = append(t.lines, sc.Text())
		if len(t.lines) > 40 {
			t.lines = t.lines[len(t.lines)-40:]
		}
		t.mu.Unlock()
	}
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.Join(t.lines, "\n")
}
