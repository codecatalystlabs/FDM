package media

import (
	"errors"
	"strings"
	"testing"
)

func TestBuildOptions(t *testing.T) {
	formats := []ytFormat{
		{FormatID: "140", Ext: "m4a", ACodec: "mp4a.40.2", VCodec: "none", ABR: 129, Filesize: 10_000_000},
		{FormatID: "251", Ext: "webm", ACodec: "opus", VCodec: "none", ABR: 140, Filesize: 11_000_000},
		{FormatID: "315", Ext: "webm", Width: 3840, Height: 2160, FPS: 60, VCodec: "vp9", ACodec: "none", Filesize: 1_000_000_000},
		{FormatID: "299", Ext: "mp4", Width: 1920, Height: 1080, FPS: 60, VCodec: "avc1.64002A", ACodec: "none", Filesize: 250_000_000},
		{FormatID: "303", Ext: "webm", Width: 1920, Height: 1080, FPS: 60, VCodec: "vp9", ACodec: "none", Filesize: 160_000_000},
		{FormatID: "135", Ext: "mp4", Width: 854, Height: 480, FPS: 30, VCodec: "avc1.4D401E", ACodec: "none", Filesize: 28_000_000},
	}
	opts := buildOptions(formats, 600)
	ids := []string{}
	for _, o := range opts {
		ids = append(ids, o.ID)
	}
	want := []string{"v2160", "v1080", "v480", "a-mp3", "a-m4a"}
	if len(ids) != len(want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	for i := range want {
		if ids[i] != want[i] {
			t.Fatalf("ids = %v, want %v", ids, want)
		}
	}
	if opts[0].Label != "4K" || opts[0].Ext != "mkv" {
		t.Errorf("4K option = %+v, want label 4K in mkv (VP9)", opts[0])
	}
	if o := opts[1]; !o.Recommended || o.Ext != "mp4" || o.SizeBytes != 260_000_000 || o.Detail != "1080p · 60 fps · H.264" {
		t.Errorf("1080p option = %+v, want recommended H.264 mp4 sized video+m4a audio", o)
	}
	if opts[4].Detail != "129 kbps · AAC" {
		t.Errorf("m4a detail = %q, want AAC stream preferred over opus", opts[4].Detail)
	}
}

func TestVerticalVideoUsesShortSide(t *testing.T) {
	opts := buildOptions([]ytFormat{{FormatID: "1", Width: 1080, Height: 1920, VCodec: "avc1", ACodec: "mp4a"}}, 30)
	if opts[0].ID != "v1080" || opts[0].Label != "1080p" {
		t.Errorf("vertical option = %+v, want v1080", opts[0])
	}
}

func TestBuildInfoDRM(t *testing.T) {
	info, err := buildInfo("u", &ytInfo{Formats: []ytFormat{{FormatID: "1", Height: 720, VCodec: "avc1", HasDRM: true}}})
	if err != nil || !info.DRM || len(info.Options) != 0 {
		t.Fatalf("all-DRM formats: info=%+v err=%v, want drm with no options", info, err)
	}
	info, err = buildInfo("u", &ytInfo{Formats: []ytFormat{
		{FormatID: "1", Height: 720, VCodec: "avc1", HasDRM: true},
		{FormatID: "2", Height: 480, VCodec: "avc1", ACodec: "mp4a", HasDRM: false},
	}})
	if err != nil || info.DRM || len(info.Options) == 0 || info.Options[0].ID != "v480" {
		t.Fatalf("mixed formats: info=%+v err=%v, want DRM-free 480p only", info, err)
	}
}

func TestProbeError(t *testing.T) {
	if err := probeError("ERROR: [Udemy] 123: This video is DRM protected", errors.New("exit 1")); !errors.Is(err, ErrDRM) {
		t.Errorf("DRM stderr -> %v, want ErrDRM", err)
	}
	if err := probeError("ERROR: Unsupported URL: https://example.com/", errors.New("exit 1")); err.Error() != "Unsupported URL: no video found on this page." {
		t.Errorf("unsupported -> %q", err)
	}
	if err := probeError("ERROR: [youtube] abc123: Video unavailable", errors.New("exit 1")); err.Error() != "Video unavailable" {
		t.Errorf("prefix strip -> %q", err)
	}
}

func TestTrackerCombinesStreams(t *testing.T) {
	tr := newTracker("v1080")
	tr.formats("299+140|260000000")
	p, _ := tr.download("downloading|125000000|250000000|NA|5000000|25|299")
	if p.Stage != "Downloading video" || p.Downloaded != 125_000_000 || p.Total != 260_000_000 {
		t.Errorf("video progress = %+v", p)
	}
	tr.download("finished|250000000|250000000|NA|NA|NA|299")
	p, _ = tr.download("downloading|5000000|10000000|NA|2000000.5|2|140")
	if p.Stage != "Downloading audio" || p.Downloaded != 255_000_000 || p.Speed != 2_000_000 {
		t.Errorf("audio progress = %+v", p)
	}
	p, ok := tr.postprocess("started|Merger")
	if !ok || p.Stage != "Merging" {
		t.Errorf("postprocess = %+v ok=%v", p, ok)
	}
}

func TestQuality(t *testing.T) {
	for id, label := range map[string]string{"best": "Best", "v2160": "4K", "v720": "720p", "a-mp3": "MP3"} {
		if !ValidQuality(id) || QualityLabel(id) != label {
			t.Errorf("%s: valid=%v label=%q, want %q", id, ValidQuality(id), QualityLabel(id), label)
		}
	}
	for _, id := range []string{"v", "v0", "vx", "a-flac", "299+140"} {
		if ValidQuality(id) {
			t.Errorf("%q should be invalid", id)
		}
	}
}

func TestBuildPlaylist(t *testing.T) {
	info, err := buildPlaylist("https://www.youtube.com/playlist?list=PL1", &ytInfo{
		Type: "playlist", Title: "Hits", ExtractorKey: "YoutubeTab", Channel: "Muno",
		Entries: []ytEntry{
			{URL: "https://www.youtube.com/watch?v=a", Title: "One", Duration: 61,
				Thumbnails: []ytThumb{{URL: "small", Width: 168}, {URL: "medium", Width: 480}, {URL: "big", Width: 1280}}},
			{Type: "playlist", URL: "https://www.youtube.com/@muno/shorts"},
			{URL: "dQw4w9WgXcQ", WebpageURL: "https://www.youtube.com/watch?v=b", Title: "Two", Duration: 39},
			{URL: "not-a-url", Title: "skipped"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(info.Entries) != 2 || info.Entries[1].URL != "https://www.youtube.com/watch?v=b" {
		t.Fatalf("entries = %+v", info.Entries)
	}
	if info.Entries[0].Thumbnail != "medium" || info.Thumbnail != "medium" || info.DurationSeconds != 100 {
		t.Errorf("thumb/duration = %q %q %d", info.Entries[0].Thumbnail, info.Thumbnail, info.DurationSeconds)
	}
	if info.Site != "YouTube" || info.Uploader != "Muno" {
		t.Errorf("site/uploader = %q %q", info.Site, info.Uploader)
	}
	if _, err := buildPlaylist("u", &ytInfo{Type: "playlist"}); err == nil {
		t.Error("empty playlist should be an error")
	}
}

func TestRecommendPreference(t *testing.T) {
	opts := buildOptions([]ytFormat{
		{FormatID: "1", Height: 2160, VCodec: "vp9"}, {FormatID: "2", Height: 1080, VCodec: "avc1"},
		{FormatID: "3", Height: 720, VCodec: "avc1"}, {FormatID: "4", ACodec: "mp4a", VCodec: "none"},
	}, 60)
	rec := func() string {
		for _, o := range opts {
			if o.Recommended {
				return o.ID
			}
		}
		return ""
	}
	if rec() != "v1080" {
		t.Fatalf("smart default = %s", rec())
	}
	for pref, want := range map[string]string{"best": "v2160", "v1440": "v1080", "v720": "v720", "a-mp3": "a-mp3", "v360": "v1080"} {
		Recommend(opts, "")
		markRecommended(opts)
		Recommend(opts, pref)
		if rec() != want {
			t.Errorf("pref %s -> %s, want %s", pref, rec(), want)
		}
	}
	presets := PlaylistPresets()
	Recommend(presets, "best")
	if presets[0].ID != "best" || !presets[0].Recommended {
		t.Errorf("playlist best preset not chosen: %+v", presets[0])
	}
}

func TestExtraArgs(t *testing.T) {
	got := strings.Join(extraArgs(DownloadRequest{QualityID: "v1080", EmbedMetadata: true, Subtitles: true}), " ")
	if got != "--embed-metadata --embed-thumbnail --embed-chapters --embed-subs --sub-langs en.*,en" {
		t.Errorf("video args = %q", got)
	}
	got = strings.Join(extraArgs(DownloadRequest{QualityID: "a-mp3", EmbedMetadata: true, Subtitles: true}), " ")
	if got != "--embed-metadata --embed-thumbnail" {
		t.Errorf("audio args = %q", got)
	}
}

func TestTransient(t *testing.T) {
	for msg, want := range map[string]bool{
		"unable to download video data: HTTP Error 403: Forbidden": true,
		"HTTP Error 503: Service Unavailable":                      true,
		"Read timed out.":                                          true,
		"Video unavailable":                                        false,
		"Private video. Sign in if you've been granted access":     false,
	} {
		if got := Transient(errors.New(msg)); got != want {
			t.Errorf("Transient(%q) = %v, want %v", msg, got, want)
		}
	}
	if Transient(ErrDRM) {
		t.Error("DRM is never transient")
	}
}
