package database

import (
	"encoding/json"

	"fdm-enorkity/internal/models"

	"gorm.io/gorm"
)

// SeedCategories inserts default categories if none exist.
func SeedCategories(db *gorm.DB) error {
	var n int64
	if err := db.Model(&models.DownloadCategory{}).Count(&n).Error; err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	seed := []struct {
		name, dir string
		exts      []string
	}{
		{"Documents", "", []string{"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt"}},
		{"Archives", "", []string{"zip", "rar", "7z", "tar", "gz", "tgz"}},
		{"Images", "", []string{"jpg", "jpeg", "png", "gif", "webp", "svg"}},
		{"Audio", "", []string{"mp3", "wav", "ogg", "m4a"}},
		{"Video", "", []string{"mp4", "webm", "mov", "avi"}},
		{"Software", "", []string{"exe", "msi", "dmg", "pkg", "deb", "rpm", "appimage"}},
	}
	for _, s := range seed {
		b, _ := json.Marshal(s.exts)
		dc := models.DownloadCategory{Name: s.name, Extensions: string(b), DefaultDirectory: s.dir}
		if err := db.Create(&dc).Error; err != nil {
			return err
		}
	}
	return nil
}
