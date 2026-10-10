package media

// ===== POSTER FRAMES =====
// Direct video files (a movie from a CDN link, say) arrive without a thumbnail, so the library
// would show a plain icon. The first time the app asks, ffmpeg grabs a frame 15% into the video
// (its thumbnail filter picks the most representative of the next 50 frames, which skips black
// fades) and the JPEG is cached next to the database. ffprobe's duration comes along for free.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

var posterSlots = make(chan struct{}, 2) // a library grid asks for many at once
var posterLocks sync.Map                 // id -> *sync.Mutex, so one id is never rendered twice

func (e *Engine) ffprobe() string {
	if ff := e.Ffmpeg(); ff != "" {
		p := filepath.Join(filepath.Dir(ff), exeName("ffprobe"))
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	if p, err := exec.LookPath("ffprobe"); err == nil {
		return p
	}
	return ""
}

// PosterPath is where the cached poster for a download id lives.
func (e *Engine) PosterPath(id string) string {
	return filepath.Join(e.StorageDir, "posters", id+".jpg")
}

// Poster returns a cached poster for src, rendering it first if needed, plus the video's
// duration in seconds when it had to probe (0 when cached or unknown).
func (e *Engine) Poster(ctx context.Context, id, src string) (string, int, error) {
	dst := e.PosterPath(id)
	if _, err := os.Stat(dst); err == nil {
		return dst, 0, nil
	}
	ff := e.Ffmpeg()
	if ff == "" {
		return "", 0, errors.New("ffmpeg is not installed")
	}
	mu, _ := posterLocks.LoadOrStore(id, &sync.Mutex{})
	mu.(*sync.Mutex).Lock()
	defer mu.(*sync.Mutex).Unlock()
	if _, err := os.Stat(dst); err == nil {
		return dst, 0, nil
	}
	select {
	case posterSlots <- struct{}{}:
		defer func() { <-posterSlots }()
	case <-ctx.Done():
		return "", 0, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	dur := 0.0
	if probe := e.ffprobe(); probe != "" {
		out, err := exec.CommandContext(ctx, probe, "-v", "error", "-show_entries", "format=duration",
			"-of", "default=nw=1:nk=1", "--", src).Output()
		if err == nil {
			dur, _ = strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
		}
	}
	seek := dur * 0.15
	if seek > 600 {
		seek = 600
	}
	if seek < 1 {
		seek = 1
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return "", 0, err
	}
	tmp := dst + ".tmp.jpg"
	for _, at := range []float64{seek, 0} {
		cmd := exec.CommandContext(ctx, ff, "-hide_banner", "-loglevel", "error", "-ss", fmt.Sprintf("%.2f", at),
			"-i", src, "-frames:v", "1", "-vf", "thumbnail=50,scale=640:-2", "-q:v", "3", "-y", tmp)
		if err := cmd.Run(); err == nil {
			if st, err := os.Stat(tmp); err == nil && st.Size() > 0 {
				if err := os.Rename(tmp, dst); err != nil {
					return "", 0, err
				}
				return dst, int(dur), nil
			}
		}
	}
	_ = os.Remove(tmp)
	return "", int(dur), errors.New("could not read a frame from this video")
}
