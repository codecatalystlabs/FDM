package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type DownloadStatus string

const (
	EngineHTTP  = "http"
	EngineMedia = "media"
)

const (
	DownloadPending   DownloadStatus = "pending"
	DownloadQueued    DownloadStatus = "queued"
	DownloadActive    DownloadStatus = "active"
	DownloadPaused    DownloadStatus = "paused"
	DownloadCompleted DownloadStatus = "completed"
	DownloadFailed    DownloadStatus = "failed"
	DownloadCancelled DownloadStatus = "cancelled"
)

type Download struct {
	ID                   string         `gorm:"type:text;primaryKey" json:"id"`
	URL                  string         `gorm:"not null" json:"url"`
	FinalURL             string         `json:"final_url"`
	Filename             string         `json:"filename"`
	OriginalFilename     string         `json:"original_filename"`
	NamedByUser          bool           `json:"named_by_user"` // the user chose Filename; headers and URLs don't rename it
	FilePath             string         `json:"file_path"`
	TempFilePath         string         `json:"temp_file_path"`
	FileSize             int64          `json:"file_size"`
	DownloadedBytes      int64          `json:"downloaded_bytes"`
	Status               DownloadStatus `gorm:"type:text;index" json:"status"`
	Category             string         `json:"category"`
	MimeType             string         `json:"mime_type"`
	Extension            string         `json:"extension"`
	SpeedBytesPerSecond  int64          `json:"speed_bytes_per_second"`
	ETASeconds           int64          `json:"eta_seconds"`
	ProgressPercent      float64        `json:"progress_percent"`
	SupportsResume       bool           `json:"supports_resume"`
	Checksum             string         `json:"checksum"`
	ErrorMessage         string         `json:"error_message"`
	Source               string         `json:"source"`
	Referrer             string         `json:"referrer"`
	RequiresExecConfirm  bool           `json:"requires_exec_confirm"`
	ExecConfirmed        bool           `json:"exec_confirmed"`
	// Media engine (yt-dlp) fields; Engine "" or "http" is the native downloader.
	Engine               string         `json:"engine"`
	QualityID            string         `json:"quality_id"`
	QualityLabel         string         `json:"quality_label"`
	Title                string         `json:"title"`
	Thumbnail            string         `json:"thumbnail"`
	Site                 string         `json:"site"`
	DurationSeconds      int            `json:"duration_seconds"`
	Stage                string         `json:"stage"`
	// Night data: NightOnly downloads run only inside the night window; StartAfter is when a
	// waiting one may start (see downloads/night.go).
	NightOnly            bool           `json:"night_only"`
	StartAfter           *time.Time     `json:"start_after"`
	CreatedAt            time.Time      `json:"created_at"`
	UpdatedAt            time.Time      `json:"updated_at"`
	StartedAt            *time.Time     `json:"started_at"`
	CompletedAt          *time.Time     `json:"completed_at"`
	PausedAt             *time.Time     `json:"paused_at"`
	CancelledAt          *time.Time     `json:"cancelled_at"`
	// Skipped is set (never stored) when add-download with skip_existing returned this existing
	// download instead of adding a duplicate.
	Skipped              bool           `gorm:"-" json:"skipped,omitempty"`
}

func (d *Download) BeforeCreate(tx *gorm.DB) error {
	if d.ID == "" {
		d.ID = uuid.NewString()
	}
	return nil
}

type ChunkStatus string

const (
	ChunkPending    ChunkStatus = "pending"
	ChunkActive     ChunkStatus = "active"
	ChunkCompleted  ChunkStatus = "completed"
	ChunkFailed     ChunkStatus = "failed"
)

type DownloadChunk struct {
	ID               string      `gorm:"type:text;primaryKey" json:"id"`
	DownloadID       string      `gorm:"type:text;index;not null" json:"download_id"`
	ChunkIndex       int         `json:"chunk_index"`
	StartByte        int64       `json:"start_byte"`
	EndByte          int64       `json:"end_byte"`
	DownloadedBytes  int64       `json:"downloaded_bytes"`
	Status           ChunkStatus `gorm:"type:text" json:"status"`
	TempFilePath     string      `json:"temp_file_path"`
	CreatedAt        time.Time   `json:"created_at"`
	UpdatedAt        time.Time   `json:"updated_at"`
}

func (c *DownloadChunk) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	return nil
}

type DownloadCategory struct {
	ID                string    `gorm:"type:text;primaryKey" json:"id"`
	Name              string    `gorm:"uniqueIndex;not null" json:"name"`
	Extensions        string    `json:"extensions"` // JSON array as string
	DefaultDirectory  string    `json:"default_directory"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

func (dc *DownloadCategory) BeforeCreate(tx *gorm.DB) error {
	if dc.ID == "" {
		dc.ID = uuid.NewString()
	}
	return nil
}

type AppSetting struct {
	ID          string    `gorm:"type:text;primaryKey" json:"id"`
	Key         string    `gorm:"uniqueIndex;not null" json:"key"`
	Value       string    `json:"value"`
	ValueType   string    `json:"value_type"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

func (a *AppSetting) BeforeCreate(tx *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.NewString()
	}
	return nil
}

type BrowserConnectionStatus string

const (
	BrowserActive  BrowserConnectionStatus = "active"
	BrowserRevoked BrowserConnectionStatus = "revoked"
)

type BrowserConnection struct {
	ID                 string                  `gorm:"type:text;primaryKey" json:"id"`
	BrowserName        string                  `json:"browser_name"`
	ExtensionID        string                  `gorm:"uniqueIndex" json:"extension_id"`
	PairingTokenHash   string                  `json:"-"`
	Status             BrowserConnectionStatus `gorm:"type:text;index" json:"status"`
	LastSeenAt         *time.Time              `json:"last_seen_at"`
	CreatedAt          time.Time               `json:"created_at"`
	UpdatedAt          time.Time               `json:"updated_at"`
}

func (b *BrowserConnection) BeforeCreate(tx *gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.NewString()
	}
	return nil
}

type LogLevel string

const (
	LogInfo  LogLevel = "info"
	LogWarn  LogLevel = "warn"
	LogError LogLevel = "error"
)

type DownloadLog struct {
	ID         string    `gorm:"type:text;primaryKey" json:"id"`
	DownloadID string    `gorm:"type:text;index" json:"download_id"`
	Level      LogLevel  `gorm:"type:text;index" json:"level"`
	Message    string    `json:"message"`
	Details    string    `json:"details"`
	CreatedAt  time.Time `json:"created_at"`
}

func (l *DownloadLog) BeforeCreate(tx *gorm.DB) error {
	if l.ID == "" {
		l.ID = uuid.NewString()
	}
	return nil
}

type QueueItemStatus string

const (
	QueuePending    QueueItemStatus = "pending"
	QueueActive     QueueItemStatus = "active"
	QueuePaused     QueueItemStatus = "paused"
	QueueCompleted  QueueItemStatus = "completed"
	QueueFailed     QueueItemStatus = "failed"
	QueueCancelled  QueueItemStatus = "cancelled"
)

type QueueItem struct {
	ID          string          `gorm:"type:text;primaryKey" json:"id"`
	DownloadID  string          `gorm:"type:text;uniqueIndex;not null" json:"download_id"`
	Download    *Download       `gorm:"foreignKey:DownloadID" json:"download,omitempty"`
	Priority    int             `gorm:"index" json:"priority"`
	Position    int             `gorm:"index" json:"position"`
	Status      QueueItemStatus `gorm:"type:text;index" json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func (q *QueueItem) BeforeCreate(tx *gorm.DB) error {
	if q.ID == "" {
		q.ID = uuid.NewString()
	}
	return nil
}
