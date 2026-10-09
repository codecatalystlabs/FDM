package security

import (
	"path/filepath"
	"regexp"
	"strings"
)

var controlRe = regexp.MustCompile(`[\x00-\x1f\x7f]`)

// winInvalidNameRe matches characters that are invalid in Windows file names.
var winInvalidNameRe = regexp.MustCompile(`[<>:"/\\|?*]+`)

// MaxBasenameLen keeps paths within typical Windows MAX_PATH once joined with the storage directory.
const MaxBasenameLen = 120

var winReserved = map[string]struct{}{
	"CON": {}, "PRN": {}, "AUX": {}, "NUL": {},
	"COM1": {}, "COM2": {}, "COM3": {}, "COM4": {}, "COM5": {}, "COM6": {}, "COM7": {}, "COM8": {}, "COM9": {},
	"LPT1": {}, "LPT2": {}, "LPT3": {}, "LPT4": {}, "LPT5": {}, "LPT6": {}, "LPT7": {}, "LPT8": {}, "LPT9": {},
}

// SanitizeFilename removes path components, control chars, Windows-forbidden characters,
// trailing dots/spaces, reserved device names, and truncates overly long names.
func SanitizeFilename(name string) string {
	name = filepath.Base(name)
	name = strings.ReplaceAll(name, "..", "")
	name = controlRe.ReplaceAllString(name, "")
	name = winInvalidNameRe.ReplaceAllString(name, "_")
	name = strings.TrimSpace(name)
	for strings.HasSuffix(name, ".") || strings.HasSuffix(name, " ") {
		name = strings.TrimRight(name, ". ")
	}
	if name == "" || name == "." {
		return "download"
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	if stem == "" {
		stem = "download"
	}
	if _, bad := winReserved[strings.ToUpper(stem)]; bad {
		stem = "_" + stem
	}
	if len(stem)+len(ext) > MaxBasenameLen {
		maxStem := MaxBasenameLen - len(ext)
		if maxStem < 1 {
			ext = ""
			maxStem = MaxBasenameLen
		}
		if len(stem) > maxStem {
			stem = stem[:maxStem]
		}
	}
	name = stem + ext
	if name == "" || name == "." {
		return "download"
	}
	return name
}

// ExecutableExtensions that require explicit user confirmation before start.
var ExecutableExtensions = map[string]struct{}{
	"exe": {}, "msi": {}, "dmg": {}, "pkg": {}, "deb": {}, "rpm": {},
	"sh": {}, "appimage": {}, "bat": {}, "cmd": {}, "ps1": {},
}

func RequiresExecutableConfirmation(ext string) bool {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	_, ok := ExecutableExtensions[ext]
	return ok
}
