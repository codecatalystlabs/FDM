package downloads

import "testing"

func TestExtensionFromMIME(t *testing.T) {
	cases := map[string]string{
		"video/mp4":                ".mp4",
		"Video/MP4; codecs=avc1":   ".mp4",
		"audio/mpeg":               ".mp3",
		"application/pdf":          ".pdf",
		"":                         "",
		"application/x-not-a-type": "",
	}
	for in, want := range cases {
		if got := ExtensionFromMIME(in); got != want {
			t.Errorf("ExtensionFromMIME(%q) = %q, want %q", in, got, want)
		}
	}
}
