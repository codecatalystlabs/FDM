package downloads

import (
	"path/filepath"
	"strings"
)

// CategoryForExtension maps extension to a coarse category label.
func CategoryForExtension(ext string) string {
	ext = strings.ToLower(strings.TrimPrefix(ext, "."))
	switch ext {
	case "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt":
		return "documents"
	case "zip", "rar", "7z", "tar", "gz", "tgz", "bz2":
		return "archives"
	case "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp":
		return "images"
	case "mp3", "wav", "ogg", "m4a", "flac":
		return "audio"
	case "mp4", "webm", "mov", "avi", "mkv":
		return "video"
	case "exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage":
		return "software"
	default:
		return "other"
	}
}

func extensionFromFilename(name string) string {
	return strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
}
