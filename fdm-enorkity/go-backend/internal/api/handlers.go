package api

import (
	"strconv"
	"strings"

	"fdm-enorkity/internal/browser"
	"fdm-enorkity/internal/config"
	"fdm-enorkity/internal/downloads"
	"fdm-enorkity/internal/models"
	"fdm-enorkity/internal/settings"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

type Deps struct {
	Config   *config.Config
	Settings *settings.Store
	Manager  *downloads.Manager
	Browser  *browser.Service
	DB       *gorm.DB
}

func Register(app *fiber.App, d Deps) {
	v1 := app.Group("/api/v1")

	v1.Get("/health", func(c *fiber.Ctx) error {
		return OK(c, "ok", fiber.Map{"service": "fdm-enorkity-backend"})
	})

	v1.Get("/downloads", func(c *fiber.Ctx) error {
		status := c.Query("status")
		search := c.Query("search")
		limit, _ := strconv.Atoi(c.Query("limit", "100"))
		offset, _ := strconv.Atoi(c.Query("offset", "0"))
		items, total, err := d.Manager.ListDownloads(status, search, limit, offset)
		if err != nil {
			return Fail(c, fiber.StatusInternalServerError, "list failed", err.Error())
		}
		return OK(c, "ok", fiber.Map{"items": items, "total": total})
	})

	v1.Post("/downloads", func(c *fiber.Ctx) error {
		var body struct {
			URL           string `json:"url"`
			Filename      string `json:"filename"`
			Referrer      string `json:"referrer"`
			Source        string `json:"source"`
			Category      string `json:"category"`
			ExecConfirmed bool   `json:"exec_confirmed"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		dl, err := d.Manager.AddDownload(downloads.AddDownloadInput{
			URL: body.URL, Filename: body.Filename, Referrer: body.Referrer,
			Source: body.Source, Category: body.Category, ExecConfirmed: body.ExecConfirmed,
		})
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "add failed", err.Error())
		}
		if !(dl.RequiresExecConfirm && !dl.ExecConfirmed) {
			_ = d.Manager.StartDownload(dl.ID)
		}
		return OK(c, "Download added successfully", dl)
	})

	v1.Get("/downloads/:id", func(c *fiber.Ctx) error {
		dl, err := d.Manager.GetDownload(c.Params("id"))
		if err != nil {
			return Fail(c, fiber.StatusNotFound, "not found", err.Error())
		}
		return OK(c, "ok", dl)
	})

	v1.Post("/downloads/:id/confirm-executable", func(c *fiber.Ctx) error {
		if err := d.Manager.ConfirmExecutable(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "confirm failed", err.Error())
		}
		_ = d.Manager.StartDownload(c.Params("id"))
		return OK(c, "confirmed", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/start", func(c *fiber.Ctx) error {
		if err := d.Manager.StartDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "start failed", err.Error())
		}
		return OK(c, "started", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/pause", func(c *fiber.Ctx) error {
		if err := d.Manager.PauseDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "pause failed", err.Error())
		}
		return OK(c, "paused", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/resume", func(c *fiber.Ctx) error {
		if err := d.Manager.ResumeDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "resume failed", err.Error())
		}
		return OK(c, "resumed", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/cancel", func(c *fiber.Ctx) error {
		if err := d.Manager.CancelDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "cancel failed", err.Error())
		}
		return OK(c, "cancelled", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/retry", func(c *fiber.Ctx) error {
		if err := d.Manager.RetryDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "retry failed", err.Error())
		}
		return OK(c, "retry scheduled", fiber.Map{"id": c.Params("id")})
	})

	v1.Delete("/downloads/:id", func(c *fiber.Ctx) error {
		if err := d.Manager.DeleteDownload(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "delete failed", err.Error())
		}
		return OK(c, "deleted", fiber.Map{"id": c.Params("id")})
	})

	v1.Delete("/downloads/:id/file", func(c *fiber.Ctx) error {
		if err := d.Manager.DeleteDownloadFile(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "delete file failed", err.Error())
		}
		return OK(c, "deleted", fiber.Map{"id": c.Params("id")})
	})

	v1.Get("/queue", func(c *fiber.Ctx) error {
		items, err := d.Manager.ListQueue()
		if err != nil {
			return Fail(c, fiber.StatusInternalServerError, "queue failed", err.Error())
		}
		return OK(c, "ok", items)
	})

	v1.Post("/queue/start-all", func(c *fiber.Ctx) error {
		_ = d.Manager.StartAll()
		return OK(c, "start-all issued", nil)
	})

	v1.Post("/queue/pause-all", func(c *fiber.Ctx) error {
		_ = d.Manager.PauseAll()
		return OK(c, "pause-all issued", nil)
	})

	v1.Post("/queue/retry-failed", func(c *fiber.Ctx) error {
		_ = d.Manager.RetryFailed()
		return OK(c, "retry-failed issued", nil)
	})

	v1.Post("/queue/clear-completed", func(c *fiber.Ctx) error {
		if err := d.Manager.ClearCompleted(); err != nil {
			return Fail(c, fiber.StatusInternalServerError, "clear failed", err.Error())
		}
		return OK(c, "cleared", nil)
	})

	v1.Post("/queue/:id/move-up", func(c *fiber.Ctx) error {
		if err := d.Manager.MoveQueueUp(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "move failed", err.Error())
		}
		return OK(c, "moved", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/queue/:id/move-down", func(c *fiber.Ctx) error {
		if err := d.Manager.MoveQueueDown(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "move failed", err.Error())
		}
		return OK(c, "moved", fiber.Map{"id": c.Params("id")})
	})

	v1.Get("/settings", func(c *fiber.Ctx) error {
		pub, err := d.Settings.Public(d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads)
		if err != nil {
			return Fail(c, fiber.StatusInternalServerError, "settings failed", err.Error())
		}
		return OK(c, "ok", pub)
	})

	v1.Put("/settings", func(c *fiber.Ctx) error {
		var body map[string]any
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		if err := d.Settings.Patch(body, d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads); err != nil {
			return Fail(c, fiber.StatusBadRequest, "patch failed", err.Error())
		}
		pub, _ := d.Settings.Public(d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads)
		return OK(c, "updated", pub)
	})

	v1.Post("/settings/generate-pairing-token", func(c *fiber.Ctx) error {
		plain, err := d.Settings.GeneratePairingToken()
		if err != nil {
			return Fail(c, fiber.StatusInternalServerError, "token failed", err.Error())
		}
		return OK(c, "store this token in your browser extension", fiber.Map{"token": plain})
	})

	v1.Put("/settings/download-directory", func(c *fiber.Ctx) error {
		var body struct {
			Path string `json:"path"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		if err := d.Settings.Patch(map[string]any{"download_directory": body.Path}, d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads); err != nil {
			return Fail(c, fiber.StatusBadRequest, "update failed", err.Error())
		}
		return OK(c, "updated", fiber.Map{"download_directory": body.Path})
	})

	v1.Get("/settings/download-directory", func(c *fiber.Ctx) error {
		p := d.Settings.DownloadDirectory(d.Config.DefaultDownloadDir)
		return OK(c, "ok", fiber.Map{"path": p})
	})

	v1.Put("/settings/concurrency", func(c *fiber.Ctx) error {
		var body struct {
			MaxConcurrentDownloads float64 `json:"max_concurrent_downloads"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		if err := d.Settings.Patch(map[string]any{"max_concurrent_downloads": body.MaxConcurrentDownloads}, d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads); err != nil {
			return Fail(c, fiber.StatusBadRequest, "update failed", err.Error())
		}
		return OK(c, "updated", fiber.Map{"max_concurrent_downloads": int(body.MaxConcurrentDownloads)})
	})

	v1.Put("/settings/bandwidth-limit", func(c *fiber.Ctx) error {
		var body struct {
			BytesPerSecond float64 `json:"bytes_per_second"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		if err := d.Settings.Patch(map[string]any{"bandwidth_limit_bps": body.BytesPerSecond}, d.Config.DefaultDownloadDir, d.Config.MaxConcurrentDownloads); err != nil {
			return Fail(c, fiber.StatusBadRequest, "update failed", err.Error())
		}
		return OK(c, "updated", fiber.Map{"bytes_per_second": int64(body.BytesPerSecond)})
	})

	// Do not use v1.Group("/browser", PairingGuard): Fiber can apply group middleware to other
	// /browser/* routes (e.g. GET /browser/status), causing 401 for the extension popup.
	pairGuard := PairingGuard(d.Settings)

	v1.Get("/browser/status", func(c *fiber.Ctx) error {
		return OK(c, "ok", fiber.Map{
			"pairing_configured": d.Settings.PairingTokenHash() != "",
		})
	})

	v1.Get("/browser/connections", func(c *fiber.Ctx) error {
		rows, err := d.Browser.ListConnections()
		if err != nil {
			return Fail(c, fiber.StatusInternalServerError, "list failed", err.Error())
		}
		return OK(c, "ok", rows)
	})

	v1.Delete("/browser/connections/:id", func(c *fiber.Ctx) error {
		if err := d.Browser.Revoke(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "revoke failed", err.Error())
		}
		return OK(c, "revoked", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/browser/pair", pairGuard, func(c *fiber.Ctx) error {
		var body struct {
			BrowserName string `json:"browser_name"`
			ExtensionID string `json:"extension_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		if strings.TrimSpace(body.ExtensionID) == "" {
			return Fail(c, fiber.StatusBadRequest, "invalid body", "extension_id required")
		}
		conn, err := d.Browser.Pair(strings.TrimSpace(body.BrowserName), strings.TrimSpace(body.ExtensionID))
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "pair failed", err.Error())
		}
		return OK(c, "paired", conn)
	})

	v1.Post("/browser/add-download", pairGuard, func(c *fiber.Ctx) error {
		var body struct {
			URL       string `json:"url"`
			Referrer  string `json:"referrer"`
			Filename  string `json:"filename"`
			PageTitle string `json:"page_title"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		extID := c.Get("X-FDM-Extension-Id")
		if extID != "" {
			d.Browser.Touch(extID)
		}
		dl, err := d.Manager.AddDownload(downloads.AddDownloadInput{
			URL: body.URL, Filename: body.Filename, PageTitle: body.PageTitle,
			Referrer: body.Referrer, Source: "browser", ExecConfirmed: false,
		})
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "add failed", err.Error())
		}
		if !(dl.RequiresExecConfirm && !dl.ExecConfirmed) {
			_ = d.Manager.StartDownload(dl.ID)
		}
		return OK(c, "download added", dl)
	})

	v1.Get("/logs", func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit", "200"))
		q := d.DB.Model(&models.DownloadLog{}).Order("created_at DESC").Limit(limit)
		if lvl := c.Query("level"); lvl != "" {
			q = q.Where("level = ?", lvl)
		}
		if did := c.Query("download_id"); did != "" {
			q = q.Where("download_id = ?", did)
		}
		var rows []models.DownloadLog
		if err := q.Find(&rows).Error; err != nil {
			return Fail(c, fiber.StatusInternalServerError, "logs failed", err.Error())
		}
		return OK(c, "ok", rows)
	})

	v1.Get("/logs/:download_id", func(c *fiber.Ctx) error {
		var rows []models.DownloadLog
		if err := d.DB.Where("download_id = ?", c.Params("download_id")).Order("created_at ASC").Find(&rows).Error; err != nil {
			return Fail(c, fiber.StatusInternalServerError, "logs failed", err.Error())
		}
		return OK(c, "ok", rows)
	})

	v1.Get("/stats/summary", func(c *fiber.Ctx) error {
		var rows []struct {
			Status string `gorm:"column:status"`
			Cnt    int64  `gorm:"column:cnt"`
		}
		_ = d.DB.Model(&models.Download{}).
			Select("status, count(*) as cnt").
			Group("status").
			Scan(&rows).Error
		out := fiber.Map{}
		for _, r := range rows {
			out[r.Status] = r.Cnt
		}
		var totalBytes int64
		row := d.DB.Model(&models.Download{}).
			Where("status = ?", models.DownloadCompleted).
			Select("COALESCE(SUM(downloaded_bytes),0)").
			Row()
		_ = row.Scan(&totalBytes)
		out["total_bytes_completed"] = totalBytes
		return OK(c, "ok", out)
	})

	v1.Get("/stats/download-speeds", func(c *fiber.Ctx) error {
		var items []models.Download
		_ = d.DB.Where("status = ?", models.DownloadActive).Find(&items).Error
		return OK(c, "ok", items)
	})

	v1.Get("/stats/categories", func(c *fiber.Ctx) error {
		var rows []struct {
			Category string `gorm:"column:category"`
			Cnt      int64  `gorm:"column:cnt"`
		}
		_ = d.DB.Model(&models.Download{}).
			Select("category, count(*) as cnt").
			Group("category").
			Scan(&rows).Error
		return OK(c, "ok", rows)
	})
}
