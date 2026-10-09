package settings

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"

	"fdm-enorkity/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	KeyDownloadDirectory    = "download_directory"
	KeyMaxConcurrent        = "max_concurrent_downloads"
	KeyBandwidthLimitBPS    = "bandwidth_limit_bps"
	KeyChunkSizeBytes       = "chunk_size_bytes"
	KeyAllowPrivateURLs     = "allow_private_urls"
	KeyPairingTokenHash     = "pairing_token_hash"
	KeyTheme                = "theme"
	KeyNotificationsEnabled = "notifications_enabled"
	KeyStartupBehavior      = "startup_behavior"
	KeyExecutableConfirm    = "executable_confirm_enabled"
)

type Store struct {
	DB *gorm.DB
}

func (s *Store) get(key string) (models.AppSetting, error) {
	var a models.AppSetting
	err := s.DB.Where("key = ?", key).First(&a).Error
	return a, err
}

func (s *Store) set(key, value, valueType, description string) error {
	a := models.AppSetting{
		Key:         key,
		Value:       value,
		ValueType:   valueType,
		Description: description,
	}
	return s.DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "value_type", "description", "updated_at"}),
	}).Create(&a).Error
}

func (s *Store) GetString(key, def string) string {
	a, err := s.get(key)
	if err != nil {
		return def
	}
	return a.Value
}

func (s *Store) GetInt64(key string, def int64) int64 {
	a, err := s.get(key)
	if err != nil {
		return def
	}
	n, err := strconv.ParseInt(strings.TrimSpace(a.Value), 10, 64)
	if err != nil {
		return def
	}
	return n
}

func (s *Store) GetBool(key string, def bool) bool {
	a, err := s.get(key)
	if err != nil {
		return def
	}
	v := strings.ToLower(strings.TrimSpace(a.Value))
	return v == "1" || v == "true" || v == "yes"
}

func (s *Store) DownloadDirectory(fallback string) string {
	v := strings.TrimSpace(s.GetString(KeyDownloadDirectory, ""))
	if v == "" {
		return fallback
	}
	return v
}

func (s *Store) MaxConcurrent(fallback int) int {
	v := int(s.GetInt64(KeyMaxConcurrent, int64(fallback)))
	if v < 1 {
		return fallback
	}
	return v
}

func (s *Store) BandwidthLimitBPS() int64 {
	return s.GetInt64(KeyBandwidthLimitBPS, 0)
}

func (s *Store) AllowPrivateURLs() bool {
	return s.GetBool(KeyAllowPrivateURLs, false)
}

func (s *Store) PairingTokenHash() string {
	return strings.TrimSpace(s.GetString(KeyPairingTokenHash, ""))
}

func (s *Store) SetPairingTokenHash(hexHash string) error {
	return s.set(KeyPairingTokenHash, hexHash, "string", "SHA-256 hex of pairing token")
}

// GeneratePairingToken creates a new random token, stores SHA-256 hex, returns plaintext once.
func (s *Store) GeneratePairingToken() (plain string, err error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	plain = hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(plain))
	if err := s.SetPairingTokenHash(hex.EncodeToString(sum[:])); err != nil {
		return "", err
	}
	return plain, nil
}

func (s *Store) VerifyPairingToken(plain string) bool {
	want := s.PairingTokenHash()
	if want == "" || plain == "" {
		return false
	}
	sum := sha256.Sum256([]byte(plain))
	got := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// PublicSettings is safe to expose to UI.
type PublicSettings struct {
	DownloadDirectory        string `json:"download_directory"`
	MaxConcurrentDownloads   int    `json:"max_concurrent_downloads"`
	BandwidthLimitBPS        int64  `json:"bandwidth_limit_bps"`
	AllowPrivateURLs         bool   `json:"allow_private_urls"`
	Theme                    string `json:"theme"`
	NotificationsEnabled     bool   `json:"notifications_enabled"`
	StartupBehavior          string `json:"startup_behavior"`
	ExecutableConfirmEnabled bool   `json:"executable_confirm_enabled"`
	PairingConfigured        bool   `json:"pairing_configured"`
}

func (s *Store) Public(fallbackDownloadDir string, fallbackMax int) (*PublicSettings, error) {
	_ = s.EnsureDefaults(fallbackDownloadDir, fallbackMax)
	return &PublicSettings{
		DownloadDirectory:        s.DownloadDirectory(fallbackDownloadDir),
		MaxConcurrentDownloads:   s.MaxConcurrent(fallbackMax),
		BandwidthLimitBPS:        s.BandwidthLimitBPS(),
		AllowPrivateURLs:         s.AllowPrivateURLs(),
		Theme:                    s.GetString(KeyTheme, "system"),
		NotificationsEnabled:     s.GetBool(KeyNotificationsEnabled, true),
		StartupBehavior:          s.GetString(KeyStartupBehavior, "open_window"),
		ExecutableConfirmEnabled: s.GetBool(KeyExecutableConfirm, true),
		PairingConfigured:        s.PairingTokenHash() != "",
	}, nil
}

func (s *Store) EnsureDefaults(downloadDir string, maxConc int) error {
	defaults := []struct {
		key, val, typ, desc string
	}{
		{KeyDownloadDirectory, downloadDir, "string", "Default download folder"},
		{KeyMaxConcurrent, strconv.Itoa(maxConc), "int", "Max parallel downloads"},
		{KeyBandwidthLimitBPS, "0", "int", "0 = unlimited bytes/sec"},
		{KeyChunkSizeBytes, strconv.FormatInt(4*1024*1024, 10), "int", "Chunk size"},
		{KeyAllowPrivateURLs, "false", "bool", "Allow RFC1918/localhost targets"},
		{KeyTheme, "system", "string", "ui theme"},
		{KeyNotificationsEnabled, "true", "bool", "desktop notifications"},
		{KeyStartupBehavior, "open_window", "string", "startup"},
		{KeyExecutableConfirm, "true", "bool", "confirm before executables"},
	}
	for _, d := range defaults {
		if _, err := s.get(d.key); err == gorm.ErrRecordNotFound {
			if err := s.set(d.key, d.val, d.typ, d.desc); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
	}
	return nil
}

// Patch applies partial updates from a generic JSON map (string values).
func (s *Store) Patch(body map[string]any, fallbackDownloadDir string, fallbackMax int) error {
	if err := s.EnsureDefaults(fallbackDownloadDir, fallbackMax); err != nil {
		return err
	}
	if v, ok := body["download_directory"].(string); ok {
		if err := s.set(KeyDownloadDirectory, v, "string", "Default download folder"); err != nil {
			return err
		}
	}
	if v, ok := body["max_concurrent_downloads"].(float64); ok {
		if err := s.set(KeyMaxConcurrent, strconv.Itoa(int(v)), "int", "Max parallel downloads"); err != nil {
			return err
		}
	}
	if v, ok := body["bandwidth_limit_bps"].(float64); ok {
		if err := s.set(KeyBandwidthLimitBPS, strconv.FormatInt(int64(v), 10), "int", "bandwidth"); err != nil {
			return err
		}
	}
	if v, ok := body["allow_private_urls"].(bool); ok {
		if err := s.set(KeyAllowPrivateURLs, strconv.FormatBool(v), "bool", "private urls"); err != nil {
			return err
		}
	}
	if v, ok := body["theme"].(string); ok {
		if err := s.set(KeyTheme, v, "string", "theme"); err != nil {
			return err
		}
	}
	if v, ok := body["notifications_enabled"].(bool); ok {
		if err := s.set(KeyNotificationsEnabled, strconv.FormatBool(v), "bool", "notifications"); err != nil {
			return err
		}
	}
	if v, ok := body["startup_behavior"].(string); ok {
		if err := s.set(KeyStartupBehavior, v, "string", "startup"); err != nil {
			return err
		}
	}
	if v, ok := body["executable_confirm_enabled"].(bool); ok {
		if err := s.set(KeyExecutableConfirm, strconv.FormatBool(v), "bool", "exec confirm"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ToJSONMap() (map[string]any, error) {
	pub, err := s.Public("", 3)
	if err != nil {
		return nil, err
	}
	b, err := json.Marshal(pub)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return m, nil
}
