package files

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"fdm-enorkity/internal/security"
)

// UniquePath returns a non-colliding path under dir for the given filename.
func UniquePath(dir, filename string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("ensure destination directory: %w", err)
	}

	base := security.SanitizeFilename(filename)
	if base == "" {
		base = "download"
	}
	ext := filepath.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	if stem == "" {
		stem = "download"
	}
	candidate := filepath.Join(dir, base)
	if _, err := os.Stat(candidate); os.IsNotExist(err) {
		return candidate, nil
	} else if err != nil {
		return "", fmt.Errorf("check destination path: %w", err)
	}
	for i := 1; i < 10000; i++ {
		candidate = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		} else if err != nil {
			return "", fmt.Errorf("check destination path: %w", err)
		}
	}
	// If we already have 10k siblings, do not fail the download.
	fallback := filepath.Join(dir, fmt.Sprintf("%s-%d%s", stem, time.Now().UnixNano(), ext))
	if _, err := os.Stat(fallback); os.IsNotExist(err) {
		return fallback, nil
	}
	return "", fmt.Errorf("could not allocate unique filename in %s", dir)
}
