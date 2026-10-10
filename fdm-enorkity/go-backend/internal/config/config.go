package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds runtime configuration from env (and optional .env file).
type Config struct {
	AppHost                 string
	AppPort                 string
	DatabasePath            string
	StorageRoot             string
	LogDir                  string
	DefaultDownloadDir      string
	MaxConcurrentDownloads  int
	ChunkSizeBytes          int64
	AllowedExtensionOrigins []string
	LogLevel                string
	// YtdlpPath / FfmpegPath override binary discovery for the media engine (see docs/media-engine.md).
	YtdlpPath  string
	FfmpegPath string
}

// Load reads configuration from environment variables. When FDM_EMBEDDED=1 (Tauri sidecar),
// .env on disk is not loaded so the parent process fully controls config via env.
func Load(path string) (*Config, error) {
	if os.Getenv("FDM_EMBEDDED") != "1" && path != "" && path != "-" {
		_ = godotenv.Load(path)
	}

	c := &Config{
		AppHost:                 getEnv("APP_HOST", "127.0.0.1"),
		AppPort:                 getEnv("APP_PORT", "8765"),
		DatabasePath:            getEnv("DATABASE_PATH", "./storage/fdm.db"),
		StorageRoot:             getEnv("STORAGE_ROOT", "./storage"),
		LogDir:                  getEnv("LOG_DIR", "./logs"),
		DefaultDownloadDir:      getEnv("DEFAULT_DOWNLOAD_DIR", "./storage/downloads"),
		MaxConcurrentDownloads:  getEnvInt("MAX_CONCURRENT_DOWNLOADS", 3),
		ChunkSizeBytes:          int64(getEnvInt("CHUNK_SIZE_BYTES", 4*1024*1024)),
		AllowedExtensionOrigins: splitCSV(getEnv("ALLOWED_EXTENSION_ORIGINS", "")),
		LogLevel:                getEnv("LOG_LEVEL", "info"),
		YtdlpPath:               getEnv("YTDLP_PATH", ""),
		FfmpegPath:              getEnv("FFMPEG_PATH", ""),
	}
	return c, nil
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getEnvInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
