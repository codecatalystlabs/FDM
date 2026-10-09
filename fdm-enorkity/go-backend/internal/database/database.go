package database

import (
	"fmt"
	"os"
	"path/filepath"

	"fdm-enorkity/internal/models"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Connect(databasePath string, dev bool) (*gorm.DB, error) {
	dir := filepath.Dir(databasePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	cfg := &gorm.Config{}
	if dev {
		cfg.Logger = logger.Default.LogMode(logger.Info)
	}

	db, err := gorm.Open(sqlite.Open(databasePath), cfg)
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&models.Download{},
		&models.DownloadChunk{},
		&models.DownloadCategory{},
		&models.AppSetting{},
		&models.BrowserConnection{},
		&models.DownloadLog{},
		&models.QueueItem{},
	); err != nil {
		return nil, fmt.Errorf("auto migrate: %w", err)
	}
	return db, nil
}
