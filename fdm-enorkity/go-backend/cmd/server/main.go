package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"fdm-enorkity/internal/api"
	"fdm-enorkity/internal/browser"
	"fdm-enorkity/internal/config"
	"fdm-enorkity/internal/database"
	"fdm-enorkity/internal/downloads"
	"fdm-enorkity/internal/logger"
	"fdm-enorkity/internal/settings"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	cfgPath := ".env"
	if len(os.Args) > 1 {
		cfgPath = os.Args[1]
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		panic(err)
	}

	log, logCloser, err := logger.New(cfg.LogDir, cfg.LogLevel)
	if err != nil {
		panic(err)
	}
	if logCloser != nil {
		defer logCloser.Close()
	}

	// SQL tracing only at LOG_LEVEL=debug: the app polls every second, so it would flood stdout.
	db, err := database.Connect(cfg.DatabasePath, cfg.LogLevel == "debug")
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	if err := database.SeedCategories(db); err != nil {
		log.Error("seed categories", "err", err)
		os.Exit(1)
	}

	st := &settings.Store{DB: db}
	if err := st.EnsureDefaults(cfg.DefaultDownloadDir, cfg.MaxConcurrentDownloads); err != nil {
		log.Error("settings defaults", "err", err)
		os.Exit(1)
	}

	dm := downloads.NewManager(db, log, cfg, st)
	dm.RecoverInterrupted()
	bg, stopBackground := context.WithCancel(context.Background())
	defer stopBackground()
	go dm.RunNightScheduler(bg)
	br := &browser.Service{DB: db, Settings: st}

	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
	})
	app.Use(recover.New())

	allow := []string{}
	for _, o := range cfg.AllowedExtensionOrigins {
		allow = append(allow, strings.TrimSpace(o))
	}
	embedded := os.Getenv("FDM_EMBEDDED") == "1"
	// Safe defaults for local extension development.
	if len(allow) == 0 {
		allow = []string{
			"chrome-extension://*",
			"moz-extension://*",
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"tauri://localhost",
			"https://tauri.localhost",
			"http://tauri.localhost",
			"app://localhost",
		}
	}
	allowOrigin := func(origin string) bool {
		if embedded {
			switch {
			case strings.HasPrefix(origin, "tauri://"):
				return true
			case strings.HasPrefix(origin, "http://tauri.localhost"):
				return true
			case strings.HasPrefix(origin, "https://tauri.localhost"):
				return true
			case strings.HasPrefix(origin, "http://localhost"):
				return true
			case strings.HasPrefix(origin, "http://127.0.0.1"):
				return true
			case strings.HasPrefix(origin, "app://localhost"):
				return true
			case strings.HasPrefix(origin, "chrome-extension://"):
				return true
			case strings.HasPrefix(origin, "moz-extension://"):
				return true
			}
		}
		for _, p := range allow {
			if p == "*" {
				return true
			}
			if strings.HasSuffix(p, "/*") {
				prefix := strings.TrimSuffix(p, "*")
				if strings.HasPrefix(origin, prefix) {
					return true
				}
				continue
			}
			// e.g. chrome-extension://* or moz-extension://* (not matched by /* rule above)
			if strings.HasSuffix(p, "*") && len(p) > 1 {
				prefix := strings.TrimSuffix(p, "*")
				if prefix != "" && strings.HasPrefix(origin, prefix) {
					return true
				}
			}
			if strings.EqualFold(origin, p) {
				return true
			}
		}
		return false
	}
	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: allowOrigin,
		AllowHeaders:     "Origin, Content-Type, Accept, X-FDM-Pairing-Token, X-FDM-Extension-Id",
		AllowMethods: strings.Join([]string{
			fiber.MethodGet, fiber.MethodPost, fiber.MethodPut, fiber.MethodDelete, fiber.MethodOptions,
		}, ","),
	}))

	app.Use(api.LocalGuard(allowOrigin, cfg.AppHost))

	api.Register(app, api.Deps{
		Config:   cfg,
		Settings: st,
		Manager:  dm,
		Browser:  br,
		DB:       db,
	})

	addr := fmt.Sprintf("%s:%s", cfg.AppHost, cfg.AppPort)
	log.Info("listening", "addr", addr)

	go func() {
		if err := app.Listen(addr); err != nil {
			log.Error("fiber stopped", "err", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = app.ShutdownWithContext(ctx)
	_ = dm.Shutdown(ctx)
	log.Info("shutdown complete")
}
