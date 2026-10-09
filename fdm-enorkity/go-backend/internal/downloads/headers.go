package downloads

import (
	"mime"
	"net/http"
	"net/url"
	"path"
	"strings"

	"fdm-enorkity/internal/security"
)

// FilenameFromContentDisposition returns a filename from Content-Disposition only, or "".
func FilenameFromContentDisposition(resp *http.Response) string {
	if resp == nil {
		return ""
	}
	cd := resp.Header.Get("Content-Disposition")
	if cd == "" {
		return ""
	}
	_, params, err := mime.ParseMediaType(cd)
	if err != nil {
		return ""
	}
	if fn := params["filename*"]; fn != "" {
		if s, ok := decodeRFC5987(fn); ok {
			s = security.SanitizeFilename(s)
			if s != "" && s != "download" {
				return s
			}
		}
	}
	if fn := params["filename"]; fn != "" {
		s := security.SanitizeFilename(fn)
		if s != "" && s != "download" {
			return s
		}
	}
	return ""
}

// FilenameFromURLString returns the last path segment of rawURL as a filename, or "".
func FilenameFromURLString(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u == nil {
		return ""
	}
	base := path.Base(u.Path)
	if base == "/" || base == "." {
		return ""
	}
	s := security.SanitizeFilename(base)
	if s == "" || s == "download" {
		return ""
	}
	return s
}

// decodeRFC5987 handles UTF-8” form only (MVP).
func decodeRFC5987(s string) (string, bool) {
	if strings.HasPrefix(strings.ToUpper(s), "UTF-8''") {
		return security.SanitizeFilename(strings.TrimPrefix(s, "UTF-8''")), true
	}
	return s, true
}

func parseAcceptRanges(h string) bool {
	return strings.Contains(strings.ToLower(h), "bytes")
}

// ExtensionFromMIME returns a single extension like ".mp4" for "video/mp4", or "".
func ExtensionFromMIME(mimeType string) string {
	mt := strings.TrimSpace(mimeType)
	if i := strings.Index(mt, ";"); i >= 0 {
		mt = strings.TrimSpace(mt[:i])
	}
	if mt == "" {
		return ""
	}
	exts, err := mime.ExtensionsByType(mt)
	if err != nil || len(exts) == 0 {
		return ""
	}
	return exts[0]
}
