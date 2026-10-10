// Package media wraps yt-dlp (+ ffmpeg) so FDM can download from streaming-site pages,
// not just direct file URLs. See docs/media-engine.md for the API contract.
package media

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ErrDRM is returned when every playable format is DRM-protected.
var ErrDRM = errors.New("This video is DRM-protected; CatalystFDM does not download DRM content.")

// Engine locates and runs yt-dlp.
type Engine struct {
	YtdlpPath  string // explicit override (YTDLP_PATH)
	FfmpegPath string // explicit override (FFMPEG_PATH)
	StorageDir string // <STORAGE_ROOT>; <StorageDir>/bin/yt-dlp is the last fallback
}

func exeName(name string) string {
	if runtime.GOOS == "windows" {
		return name + ".exe"
	}
	return name
}

// Ytdlp returns the yt-dlp binary path or an error explaining how to install it.
func (e *Engine) Ytdlp() (string, error) {
	if e.YtdlpPath != "" {
		if _, err := os.Stat(e.YtdlpPath); err == nil {
			return e.YtdlpPath, nil
		}
		return "", fmt.Errorf("Media engine unavailable: YTDLP_PATH %q not found", e.YtdlpPath)
	}
	if p, err := exec.LookPath("yt-dlp"); err == nil {
		return p, nil
	}
	if e.StorageDir != "" {
		p := filepath.Join(e.StorageDir, "bin", exeName("yt-dlp"))
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", errors.New("Media engine unavailable: yt-dlp not found (install it or set YTDLP_PATH)")
}

// Ffmpeg returns the ffmpeg path, or "" when not found (merging/conversion then won't work).
func (e *Engine) Ffmpeg() string {
	if e.FfmpegPath != "" {
		return e.FfmpegPath
	}
	if p, err := exec.LookPath("ffmpeg"); err == nil {
		return p
	}
	return ""
}

// Status is what GET /api/v1/media/status reports.
type Status struct {
	Available      bool   `json:"available"`
	Version        string `json:"version"`
	Ffmpeg         bool   `json:"ffmpeg"`
	CookiesBrowser string `json:"cookies_browser"`
	Error          string `json:"error,omitempty"`
}

func (e *Engine) Status(ctx context.Context) Status {
	st := Status{Ffmpeg: e.Ffmpeg() != ""}
	bin, err := e.Ytdlp()
	if err != nil {
		st.Error = err.Error()
		return st
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, bin, "--version").Output()
	if err != nil {
		st.Error = "yt-dlp failed to run: " + err.Error()
		return st
	}
	st.Available = true
	st.Version = strings.TrimSpace(string(out))
	return st
}

// commonArgs are shared by probe and download.
func (e *Engine) commonArgs(referrer, cookiesBrowser string) []string {
	args := []string{"--no-playlist", "--no-warnings", "--ignore-config"}
	if referrer != "" {
		args = append(args, "--referer", referrer)
	}
	if cookiesBrowser != "" {
		args = append(args, "--cookies-from-browser", cookiesBrowser)
	}
	// YouTube needs a JS runtime for full format lists; yt-dlp only enables deno by default.
	if _, err := exec.LookPath("deno"); err != nil {
		if _, err := exec.LookPath("node"); err == nil {
			args = append(args, "--js-runtimes", "node")
		}
	}
	if ff := e.Ffmpeg(); ff != "" {
		args = append(args, "--ffmpeg-location", ff)
	}
	return args
}

// Option is one quality choice offered to the user.
type Option struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // video | audio
	Label       string `json:"label"`
	Detail      string `json:"detail"`
	Height      int    `json:"height"`
	FPS         int    `json:"fps"`
	Ext         string `json:"ext"`
	SizeBytes   int64  `json:"size_bytes"`
	Recommended bool   `json:"recommended"`
}

// Info is the probe result for a media page.
type Info struct {
	URL             string   `json:"url"`
	Title           string   `json:"title"`
	Thumbnail       string   `json:"thumbnail"`
	DurationSeconds int      `json:"duration_seconds"`
	Uploader        string   `json:"uploader"`
	Site            string   `json:"site"`
	IsLive          bool     `json:"is_live"`
	DRM             bool     `json:"drm"`
	Options         []Option `json:"options"`
	// Set when the URL is a playlist or channel; Options then holds quality presets.
	Entries []Entry `json:"entries,omitempty"`
}

// Entry is one video of a playlist or channel.
type Entry struct {
	URL             string `json:"url"`
	Title           string `json:"title"`
	Thumbnail       string `json:"thumbnail"`
	DurationSeconds int    `json:"duration_seconds"`
	Uploader        string `json:"uploader"`
}

// MaxEntries caps how much of a huge channel one inspect lists.
const MaxEntries = 500

type ytFormat struct {
	FormatID       string  `json:"format_id"`
	Ext            string  `json:"ext"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	FPS            float64 `json:"fps"`
	VCodec         string  `json:"vcodec"`
	ACodec         string  `json:"acodec"`
	ABR            float64 `json:"abr"`
	TBR            float64 `json:"tbr"`
	Filesize       int64   `json:"filesize"`
	FilesizeApprox int64   `json:"filesize_approx"`
	Protocol       string  `json:"protocol"`
	HasDRM         any     `json:"has_drm"` // bool or "maybe"
}

type ytInfo struct {
	Type         string     `json:"_type"`
	Title        string     `json:"title"`
	Thumbnail    string     `json:"thumbnail"`
	Duration     float64    `json:"duration"`
	Uploader     string     `json:"uploader"`
	Channel      string     `json:"channel"`
	ExtractorKey string     `json:"extractor_key"`
	WebpageURL   string     `json:"webpage_url"`
	IsLive       bool       `json:"is_live"`
	HasDRM       any        `json:"has_drm"`
	Formats      []ytFormat `json:"formats"`
	// Single-format extractors put the fields at the top level.
	Height int    `json:"height"`
	VCodec string `json:"vcodec"`
	ACodec string `json:"acodec"`
	// Playlists (--flat-playlist) list their videos here.
	Entries       []ytEntry `json:"entries"`
	PlaylistCount int       `json:"playlist_count"`
}

type ytThumb struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type ytEntry struct {
	Type       string    `json:"_type"`
	URL        string    `json:"url"`
	WebpageURL string    `json:"webpage_url"`
	Title      string    `json:"title"`
	Duration   float64   `json:"duration"`
	Uploader   string    `json:"uploader"`
	Channel    string    `json:"channel"`
	Thumbnail  string    `json:"thumbnail"`
	Thumbnails []ytThumb `json:"thumbnails"`
}

func isDRM(v any) bool {
	b, ok := v.(bool)
	return ok && b
}

func (f ytFormat) hasVideo() bool { return f.VCodec != "" && f.VCodec != "none" }
func (f ytFormat) hasAudio() bool { return f.ACodec != "" && f.ACodec != "none" }

// res is yt-dlp's notion of resolution: the shorter side, so vertical 1080x1920 is "1080p".
func (f ytFormat) res() int {
	if f.Width > 0 && f.Height > 0 && f.Width < f.Height {
		return f.Width
	}
	return f.Height
}

func (f ytFormat) size(duration float64) int64 {
	if f.Filesize > 0 {
		return f.Filesize
	}
	if f.FilesizeApprox > 0 {
		return f.FilesizeApprox
	}
	if f.TBR > 0 && duration > 0 {
		return int64(f.TBR * 1000 / 8 * duration)
	}
	return -1
}

// Probe runs `yt-dlp -J` and turns the result into quality options.
func (e *Engine) Probe(ctx context.Context, url, referrer, cookiesBrowser string) (*Info, error) {
	bin, err := e.Ytdlp()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	args := append([]string{"-J", "--flat-playlist", "--playlist-end", fmt.Sprint(MaxEntries)}, e.commonArgs(referrer, cookiesBrowser)...)
	args = append(args, "--", url)
	cmd := exec.CommandContext(ctx, bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		return nil, probeError(stderr.String(), err)
	}
	var raw ytInfo
	if err := json.Unmarshal(stdout.Bytes(), &raw); err != nil {
		return nil, fmt.Errorf("could not read media info: %w", err)
	}
	if raw.Type == "playlist" || raw.Type == "multi_video" {
		return buildPlaylist(url, &raw)
	}
	return buildInfo(url, &raw)
}

// ===== PLAYLISTS =====
// A playlist or channel is listed flat (one fast request, no per-video format lookups), so the
// quality choice is a preset applied to every video: yt-dlp's -S "res:N" picks the closest
// resolution each video actually has, so "1080p" never fails on a 720p-only upload.

func buildPlaylist(url string, raw *ytInfo) (*Info, error) {
	info := &Info{
		URL:      url,
		Title:    strings.TrimSpace(raw.Title),
		Uploader: firstNonEmpty(raw.Uploader, raw.Channel),
		Site:     siteName(raw.ExtractorKey),
		Entries:  []Entry{},
	}
	if raw.WebpageURL != "" {
		info.URL = raw.WebpageURL
	}
	total := 0
	for _, e := range raw.Entries {
		if e.Type == "playlist" { // a channel's tabs (Videos, Shorts, …) — skip nested lists
			continue
		}
		u := e.URL
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			u = e.WebpageURL
		}
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			continue
		}
		total += int(e.Duration)
		info.Entries = append(info.Entries, Entry{
			URL: u, Title: strings.TrimSpace(e.Title), Thumbnail: entryThumb(e),
			DurationSeconds: int(e.Duration), Uploader: firstNonEmpty(e.Uploader, e.Channel),
		})
	}
	if len(info.Entries) == 0 {
		return nil, errors.New("This playlist has no downloadable videos.")
	}
	info.Thumbnail = info.Entries[0].Thumbnail
	info.DurationSeconds = total
	info.Options = PlaylistPresets()
	return info, nil
}

// PlaylistPresets are the quality choices offered for a whole playlist.
func PlaylistPresets() []Option {
	return []Option{
		{ID: "best", Kind: "video", Label: "Best", Detail: "Highest quality each video has", Ext: "mp4", SizeBytes: -1},
		{ID: "v1080", Kind: "video", Label: "1080p", Detail: "Full HD, or the closest", Height: 1080, Ext: "mp4", SizeBytes: -1, Recommended: true},
		{ID: "v720", Kind: "video", Label: "720p", Detail: "HD · smaller files", Height: 720, Ext: "mp4", SizeBytes: -1},
		{ID: "v480", Kind: "video", Label: "480p", Detail: "Saves data", Height: 480, Ext: "mp4", SizeBytes: -1},
		{ID: "v360", Kind: "video", Label: "360p", Detail: "Smallest video", Height: 360, Ext: "mp4", SizeBytes: -1},
		{ID: "a-mp3", Kind: "audio", Label: "MP3", Detail: "Audio only · best quality", Ext: "mp3", SizeBytes: -1},
		{ID: "a-m4a", Kind: "audio", Label: "M4A", Detail: "Audio only · original", Ext: "m4a", SizeBytes: -1},
	}
}

// entryThumb picks a thumbnail around 480px wide: sharp in a list, cheap to load.
func entryThumb(e ytEntry) string {
	best, bestDiff := e.Thumbnail, 1<<30
	for _, t := range e.Thumbnails {
		if t.URL == "" {
			continue
		}
		w := t.Width
		if w == 0 {
			w = 480
		}
		d := w - 480
		if d < 0 {
			d = -d
		}
		if d < bestDiff {
			best, bestDiff = t.URL, d
		}
	}
	return best
}

// probeError turns yt-dlp's stderr into a short user-facing message.
func probeError(stderr string, runErr error) error {
	msg := ""
	for _, line := range strings.Split(stderr, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ERROR:") {
			msg = strings.TrimSpace(strings.TrimPrefix(line, "ERROR:"))
		}
	}
	low := strings.ToLower(msg)
	switch {
	case strings.Contains(low, "drm"):
		return ErrDRM
	case strings.Contains(low, "unsupported url"):
		return errors.New("Unsupported URL: no video found on this page.")
	case msg != "":
		// Drop yt-dlp's "[extractor] id:" prefix.
		if i := strings.Index(msg, "]"); strings.HasPrefix(msg, "[") && i > 0 {
			msg = strings.TrimSpace(msg[i+1:])
			if j := strings.Index(msg, ": "); j > 0 && j < 40 && !strings.Contains(msg[:j], " ") {
				msg = msg[j+2:]
			}
		}
		return errors.New(msg)
	case errors.Is(runErr, context.DeadlineExceeded):
		return errors.New("Timed out while reading the page.")
	default:
		return fmt.Errorf("yt-dlp failed: %v", runErr)
	}
}

func buildInfo(url string, raw *ytInfo) (*Info, error) {
	info := &Info{
		URL:             url,
		Title:           strings.TrimSpace(raw.Title),
		Thumbnail:       raw.Thumbnail,
		DurationSeconds: int(raw.Duration),
		Uploader:        firstNonEmpty(raw.Uploader, raw.Channel),
		Site:            siteName(raw.ExtractorKey),
		IsLive:          raw.IsLive,
	}
	if raw.WebpageURL != "" {
		info.URL = raw.WebpageURL
	}

	formats := raw.Formats
	if len(formats) == 0 {
		formats = []ytFormat{{FormatID: "0", Height: raw.Height, VCodec: raw.VCodec, ACodec: raw.ACodec, HasDRM: raw.HasDRM}}
	}
	usable := formats[:0:0]
	for _, f := range formats {
		if isDRM(f.HasDRM) {
			info.DRM = true
			continue
		}
		if f.Protocol == "mhtml" { // storyboard images
			continue
		}
		usable = append(usable, f)
	}
	if len(usable) == 0 {
		if info.DRM || isDRM(raw.HasDRM) {
			info.DRM = true
			info.Options = []Option{}
			return info, nil
		}
		return nil, errors.New("No downloadable formats found.")
	}
	info.DRM = false // some formats are DRM-free, so the page is downloadable
	info.Options = buildOptions(usable, raw.Duration)
	return info, nil
}

func buildOptions(formats []ytFormat, duration float64) []Option {
	// Best audio-only stream (prefer AAC/m4a: it merges into MP4 without re-encoding).
	var bestAudio *ytFormat
	hasAnyAudio := false
	for i := range formats {
		f := &formats[i]
		if f.hasAudio() {
			hasAnyAudio = true
		}
		if f.hasVideo() || !f.hasAudio() {
			continue
		}
		if bestAudio == nil || audioRank(f) > audioRank(bestAudio) {
			bestAudio = f
		}
	}
	audioSize := int64(0)
	if bestAudio != nil {
		if s := bestAudio.size(duration); s > 0 {
			audioSize = s
		}
	}

	// One video option per resolution, picking the format yt-dlp's sort will pick.
	byRes := map[int]*ytFormat{}
	for i := range formats {
		f := &formats[i]
		r := f.res()
		if !f.hasVideo() || r <= 0 {
			continue
		}
		if cur, ok := byRes[r]; !ok || videoRank(f) > videoRank(cur) {
			byRes[r] = f
		}
	}
	resList := make([]int, 0, len(byRes))
	for r := range byRes {
		resList = append(resList, r)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(resList)))

	var opts []Option
	for _, r := range resList {
		f := byRes[r]
		size := f.size(duration)
		if size > 0 && !f.hasAudio() {
			size += audioSize
		}
		fps := int(f.FPS + 0.5)
		detail := fmt.Sprintf("%dp", r)
		if fps > 30 {
			detail += fmt.Sprintf(" · %d fps", fps)
		}
		if c := codecName(f.VCodec); c != "" {
			detail += " · " + c
		}
		opts = append(opts, Option{
			ID: fmt.Sprintf("v%d", r), Kind: "video", Label: resLabel(r), Detail: detail,
			Height: r, FPS: fps, Ext: containerFor(f.VCodec), SizeBytes: size,
		})
	}
	if len(opts) == 0 {
		// Extractor gave no resolutions (generic players, some HLS): let yt-dlp pick.
		opts = append(opts, Option{ID: "best", Kind: "video", Label: "Best", Detail: "Best available quality", Ext: "mp4", SizeBytes: -1})
	}
	markRecommended(opts)

	if hasAnyAudio {
		mp3 := int64(-1)
		if duration > 0 {
			mp3 = int64(duration * 245000 / 8) // ~V0 VBR
		}
		m4a := int64(-1)
		detailM4A := "Original audio"
		if bestAudio != nil {
			m4a = bestAudio.size(duration)
			if bestAudio.ABR > 0 {
				detailM4A = fmt.Sprintf("%d kbps · %s", int(bestAudio.ABR+0.5), codecName(bestAudio.ACodec))
			}
		}
		opts = append(opts,
			Option{ID: "a-mp3", Kind: "audio", Label: "MP3", Detail: "Best quality · VBR", Ext: "mp3", SizeBytes: mp3},
			Option{ID: "a-m4a", Kind: "audio", Label: "M4A", Detail: detailM4A, Ext: "m4a", SizeBytes: m4a},
		)
	}
	return opts
}

// Recommend moves the recommended flag to the user's preferred quality ("" keeps the smart
// default). A preferred resolution the video lacks falls back to the best one below it.
func Recommend(opts []Option, pref string) {
	if pref == "" || len(opts) == 0 {
		return
	}
	pick := -1
	for i, o := range opts {
		if o.ID == pref {
			pick = i
		}
	}
	switch {
	case pick >= 0:
	case strings.HasPrefix(pref, "a-"):
	case pref == "best":
		for i, o := range opts {
			if o.Kind == "video" && (pick < 0 || o.Height > opts[pick].Height) {
				pick = i
			}
		}
	default:
		want, err := strconv.Atoi(strings.TrimPrefix(pref, "v"))
		if err != nil {
			return
		}
		for i, o := range opts {
			if o.Kind == "video" && o.Height <= want && (pick < 0 || o.Height > opts[pick].Height) {
				pick = i
			}
		}
	}
	if pick < 0 {
		return
	}
	for i := range opts {
		opts[i].Recommended = i == pick
	}
}

// markRecommended picks 1080p, else the best resolution below it, else the lowest available.
func markRecommended(opts []Option) {
	best := -1
	for i, o := range opts {
		if o.Kind != "video" {
			continue
		}
		if o.Height <= 1080 && (best < 0 || o.Height > opts[best].Height) {
			best = i
		}
	}
	if best < 0 {
		for i, o := range opts {
			if o.Kind == "video" && (best < 0 || o.Height < opts[best].Height) {
				best = i
			}
		}
	}
	if best >= 0 {
		opts[best].Recommended = true
	}
}

// videoRank mirrors the format yt-dlp picks for -S "res:N,fps,vcodec:h264,acodec:aac":
// highest fps, then H.264 > HEVC > VP9 > AV1 (verified against YouTube's format lists).
func videoRank(f *ytFormat) float64 {
	rank := f.FPS * 10
	switch codecName(f.VCodec) {
	case "H.264":
		rank += 5
	case "HEVC":
		rank += 4
	case "VP9":
		rank += 3
	case "AV1":
		rank += 2
	}
	if f.size(0) > 0 {
		rank += 0.5 // known size: prefer for estimates
	}
	return rank
}

// containerFor is the file type yt-dlp produces with --merge-output-format mp4/mkv.
func containerFor(vcodec string) string {
	if codecName(vcodec) == "VP9" {
		return "mkv"
	}
	return "mp4"
}

func audioRank(f *ytFormat) float64 {
	rank := f.ABR
	if strings.HasPrefix(f.ACodec, "mp4a") || f.Ext == "m4a" {
		rank += 1000
	}
	if strings.HasSuffix(f.FormatID, "-drc") {
		rank -= 1
	}
	return rank
}

func resLabel(r int) string {
	switch {
	case r >= 4320:
		return "8K"
	case r >= 2160:
		return "4K"
	default:
		return fmt.Sprintf("%dp", r)
	}
}

func codecName(c string) string {
	c = strings.ToLower(c)
	switch {
	case c == "" || c == "none":
		return ""
	case strings.HasPrefix(c, "avc1"), strings.HasPrefix(c, "h264"):
		return "H.264"
	case strings.HasPrefix(c, "hev1"), strings.HasPrefix(c, "hvc1"), strings.HasPrefix(c, "h265"):
		return "HEVC"
	case strings.HasPrefix(c, "vp09"), strings.HasPrefix(c, "vp9"):
		return "VP9"
	case strings.HasPrefix(c, "av01"):
		return "AV1"
	case strings.HasPrefix(c, "mp4a"), c == "aac":
		return "AAC"
	case strings.HasPrefix(c, "opus"):
		return "Opus"
	default:
		if i := strings.IndexAny(c, ".-"); i > 0 {
			c = c[:i]
		}
		return strings.ToUpper(c)
	}
}

var siteNames = map[string]string{
	"Youtube": "YouTube", "YoutubeTab": "YouTube", "Vimeo": "Vimeo", "Twitter": "X", "TikTok": "TikTok",
	"Facebook": "Facebook", "Instagram": "Instagram", "Dailymotion": "Dailymotion", "Soundcloud": "SoundCloud",
	"Twitch": "Twitch", "TwitchVod": "Twitch", "Reddit": "Reddit", "Udemy": "Udemy", "Generic": "Web",
}

func siteName(key string) string {
	if n, ok := siteNames[key]; ok {
		return n
	}
	return key
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// ===== KEEPING THE ENGINE CURRENT =====
// Sites change their players every few weeks and yt-dlp ships fixes just as fast, so a stale
// engine is the most common reason a video that plays fine won't download. Update runs yt-dlp's
// own updater (signed releases from GitHub); installs managed by pip or a package manager say so
// in the output instead of updating, and that message is returned as is.

// UpdateResult is what POST /api/v1/media/update reports.
type UpdateResult struct {
	Before  string `json:"before"`
	After   string `json:"after"`
	Updated bool   `json:"updated"`
	Output  string `json:"output"`
}

func (e *Engine) Update(ctx context.Context) (*UpdateResult, error) {
	bin, err := e.Ytdlp()
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	version := func() string {
		out, _ := exec.CommandContext(ctx, bin, "--version").Output()
		return strings.TrimSpace(string(out))
	}
	res := &UpdateResult{Before: version()}
	out, runErr := exec.CommandContext(ctx, bin, "--update", "--no-warnings").CombinedOutput()
	res.Output = strings.TrimSpace(string(out))
	res.After = version()
	res.Updated = res.After != "" && res.After != res.Before
	if runErr != nil && !res.Updated {
		msg := res.Output
		if i := strings.LastIndex(msg, "ERROR:"); i >= 0 {
			msg = strings.TrimSpace(msg[i+len("ERROR:"):])
		}
		if msg == "" {
			msg = runErr.Error()
		}
		return res, errors.New(msg)
	}
	return res, nil
}
