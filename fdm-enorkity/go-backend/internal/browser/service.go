package browser

import (
	"errors"
	"time"

	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/settings"

	"gorm.io/gorm"
)

type Service struct {
	DB       *gorm.DB
	Settings *settings.Store
}

func (s *Service) Pair(browserName, extensionID string) (*models.BrowserConnection, error) {
	sum := s.Settings.PairingTokenHash()
	if sum == "" {
		return nil, errors.New("pairing token not configured")
	}
	now := time.Now()

	var conn models.BrowserConnection
	err := s.DB.Where("extension_id = ?", extensionID).First(&conn).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		conn = models.BrowserConnection{
			BrowserName:      browserName,
			ExtensionID:      extensionID,
			PairingTokenHash: sum,
			Status:           models.BrowserActive,
			LastSeenAt:       &now,
		}
		if err := s.DB.Create(&conn).Error; err != nil {
			return nil, err
		}
		return &conn, nil
	}
	if err != nil {
		return nil, err
	}
	conn.BrowserName = browserName
	conn.PairingTokenHash = sum
	conn.Status = models.BrowserActive
	conn.LastSeenAt = &now
	if err := s.DB.Save(&conn).Error; err != nil {
		return nil, err
	}
	return &conn, nil
}

func (s *Service) Touch(extensionID string) {
	now := time.Now()
	_ = s.DB.Model(&models.BrowserConnection{}).Where("extension_id = ?", extensionID).Updates(map[string]any{
		"last_seen_at": now,
		"status":       models.BrowserActive,
	}).Error
}

func (s *Service) ListConnections() ([]models.BrowserConnection, error) {
	var rows []models.BrowserConnection
	if err := s.DB.Order("updated_at DESC").Find(&rows).Error; err != nil {
		return nil, err
	}
	return rows, nil
}

func (s *Service) Revoke(id string) error {
	return s.DB.Model(&models.BrowserConnection{}).Where("id = ?", id).Update("status", models.BrowserRevoked).Error
}
