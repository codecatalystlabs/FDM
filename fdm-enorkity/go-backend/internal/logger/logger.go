package logger

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// New returns a JSON-ish text logger writing to stdout and optional log file.
func New(logDir, level string) (*slog.Logger, io.Closer, error) {
	lvl := slog.LevelInfo
	switch strings.ToLower(level) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn", "warning":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	}

	opts := &slog.HandlerOptions{Level: lvl}
	hStdout := slog.NewTextHandler(os.Stdout, opts)

	if logDir == "" {
		return slog.New(hStdout), io.NopCloser(strings.NewReader("")), nil
	}
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return slog.New(hStdout), io.NopCloser(nil), err
	}
	f, err := os.OpenFile(filepath.Join(logDir, "server.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return slog.New(hStdout), io.NopCloser(strings.NewReader("")), err
	}
	mw := io.MultiWriter(os.Stdout, f)
	h := slog.NewTextHandler(mw, opts)
	return slog.New(h), f, nil
}
