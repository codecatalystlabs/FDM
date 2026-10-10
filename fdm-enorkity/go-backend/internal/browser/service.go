package browser

import (
	"errors"
	"sync"
	"time"

	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/settings"

	"gorm.io/gorm"
)

type Service struct {
	DB       *gorm.DB
	Settings *settings.Store

	once    sync.Once
	pairing *pairing
}

// Pair registers the browser presenting token (the legacy manual-token flow). The connection
// stores that token's hash, so revoking it later locks this browser out.
func (s *Service) Pair(browserName, extensionID, token string) (*models.BrowserConnection, error) {
	if token == "" {
		return nil, errors.New("pairing token required")
	}
	sum := HashToken(token)
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

// Revoke locks a browser out. Its token hash is cleared; if it was using the legacy shared
// token, that token is retired too, since otherwise the browser could simply pair again with it.
func (s *Service) Revoke(id string) error {
	var conn models.BrowserConnection
	if err := s.DB.First(&conn, "id = ?", id).Error; err != nil {
		return err
	}
	if legacy := s.Settings.PairingTokenHash(); legacy != "" && conn.PairingTokenHash == legacy {
		if err := s.Settings.SetPairingTokenHash(""); err != nil {
			return err
		}
	}
	return s.DB.Model(&models.BrowserConnection{}).Where("id = ?", id).Updates(map[string]any{
		"status":             models.BrowserRevoked,
		"pairing_token_hash": "",
	}).Error
}
