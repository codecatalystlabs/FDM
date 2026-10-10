package api

import (
	"os"
	"strconv"
	"strings"

	"fdm-enorkity/internal/browser"
	"fdm-enorkity/internal/config"
	"fdm-enorkity/internal/downloads"
	"fdm-enorkity/internal/files"
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
		return OK(c, "ok", fiber.Map{"service": "catalystfdm-engine"})
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

	v1.Get("/media/status", func(c *fiber.Ctx) error {
		st := d.Manager.Media.Status(c.Context())
		st.CookiesBrowser = d.Settings.MediaCookiesBrowser()
		return OK(c, "ok", st)
	})

	v1.Post("/media/update", func(c *fiber.Ctx) error {
		res, err := d.Manager.Media.Update(c.Context())
		if err != nil {
			return Fail(c, fiber.StatusBadGateway, "update failed", err.Error())
		}
		return OK(c, "ok", res)
	})

	v1.Post("/inspect", func(c *fiber.Ctx) error {
		return inspect(c, d)
	})

	v1.Post("/downloads", func(c *fiber.Ctx) error {
		var body struct {
			URL           string `json:"url"`
			Filename      string `json:"filename"`
			Referrer      string `json:"referrer"`
			Source        string `json:"source"`
			Category      string `json:"category"`
			ExecConfirmed bool   `json:"exec_confirmed"`
			mediaFields
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		in := downloads.AddDownloadInput{
			URL: body.URL, Filename: body.Filename, Referrer: body.Referrer,
			Source: body.Source, Category: body.Category, ExecConfirmed: body.ExecConfirmed,
		}
		body.mediaFields.apply(&in)
		dl, err := d.Manager.AddDownload(in)
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "add failed", err.Error())
		}
		if dl.Skipped {
			return OK(c, "already downloaded", dl)
		}
		return OK(c, "Download added successfully", startOrSchedule(d, dl, body.When))
	})

	v1.Get("/downloads/:id", func(c *fiber.Ctx) error {
		dl, err := d.Manager.GetDownload(c.Params("id"))
		if err != nil {
			return Fail(c, fiber.StatusNotFound, "not found", err.Error())
		}
		return OK(c, "ok", dl)
	})

	// Open, Show in folder and in-app playback for finished downloads (internal/files/open.go).
	finished := func(c *fiber.Ctx) (*models.Download, error) {
		dl, err := d.Manager.GetDownload(c.Params("id"))
		if err != nil {
			return nil, Fail(c, fiber.StatusNotFound, "not found", err.Error())
		}
		if dl.Status != models.DownloadCompleted || dl.FilePath == "" {
			return nil, Fail(c, fiber.StatusConflict, "not finished", "this download hasn't finished yet")
		}
		return dl, nil
	}

	v1.Post("/downloads/:id/open", func(c *fiber.Ctx) error {
		dl, ferr := finished(c)
		if dl == nil {
			return ferr
		}
		if err := files.OpenWithDefaultApp(dl.FilePath); err != nil {
			return Fail(c, fiber.StatusBadRequest, "open failed", err.Error())
		}
		return OK(c, "opened", fiber.Map{"id": dl.ID})
	})

	v1.Post("/downloads/:id/reveal", func(c *fiber.Ctx) error {
		dl, ferr := finished(c)
		if dl == nil {
			return ferr
		}
		if err := files.Reveal(dl.FilePath); err != nil {
			return Fail(c, fiber.StatusBadRequest, "reveal failed", err.Error())
		}
		return OK(c, "revealed", fiber.Map{"id": dl.ID})
	})

	v1.Get("/downloads/:id/stream", func(c *fiber.Ctx) error {
		dl, ferr := finished(c)
		if dl == nil {
			return ferr
		}
		switch dl.Category {
		case "video", "audio", "images":
		default:
			return Fail(c, fiber.StatusUnsupportedMediaType, "not playable", "only video, audio and images can be previewed")
		}
		if _, err := os.Stat(dl.FilePath); err != nil {
			return Fail(c, fiber.StatusNotFound, "missing", "the file is no longer on disk")
		}
		c.Set(fiber.HeaderContentDisposition, "inline")
		c.Set("Cache-Control", "private, max-age=0")
		return c.SendFile(dl.FilePath)
	})

	v1.Get("/downloads/:id/poster", func(c *fiber.Ctx) error {
		dl, ferr := finished(c)
		if dl == nil {
			return ferr
		}
		if dl.Category != "video" {
			return Fail(c, fiber.StatusUnsupportedMediaType, "no poster", "posters are made for videos only")
		}
		path, dur, err := d.Manager.Media.Poster(c.Context(), dl.ID, dl.FilePath)
		if err != nil {
			return Fail(c, fiber.StatusNotFound, "no poster", err.Error())
		}
		if dur > 0 && dl.DurationSeconds == 0 {
			_ = d.DB.Model(&models.Download{}).Where("id = ?", dl.ID).Update("duration_seconds", dur).Error
		}
		c.Set("Cache-Control", "private, max-age=86400")
		return c.SendFile(path)
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

	v1.Post("/downloads/:id/start-now", func(c *fiber.Ctx) error {
		if err := d.Manager.StartNow(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "start failed", err.Error())
		}
		return OK(c, "started", fiber.Map{"id": c.Params("id")})
	})

	v1.Post("/downloads/:id/tonight", func(c *fiber.Ctx) error {
		dl, err := d.Manager.ScheduleNight(c.Params("id"))
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "schedule failed", err.Error())
		}
		return OK(c, "scheduled for night data", dl)
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
	pairGuard := PairingGuard(d.Browser)

	v1.Get("/browser/status", func(c *fiber.Ctx) error {
		return OK(c, "ok", fiber.Map{
			"pairing_configured": d.Settings.PairingTokenHash() != "",
			"one_click_pairing":  true,
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

	// One-click pairing (internal/browser/pairing.go). The extension asks, the app allows.
	v1.Post("/browser/pair/request", func(c *fiber.Ctx) error {
		var body struct {
			BrowserName string `json:"browser_name"`
			ExtensionID string `json:"extension_id"`
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		ticket, err := d.Browser.RequestPair(body.BrowserName, body.ExtensionID)
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "pair request failed", err.Error())
		}
		return OK(c, "approve this browser in CatalystFDM", ticket)
	})

	v1.Get("/browser/pair/request/:secret", func(c *fiber.Ctx) error {
		return OK(c, "ok", d.Browser.ClaimPair(c.Params("secret")))
	})

	// Approving is the app's job: an extension may not approve its own request.
	appOnly := func(c *fiber.Ctx) error {
		if isExtensionOrigin(c.Get(fiber.HeaderOrigin)) {
			return Fail(c, fiber.StatusForbidden, "Forbidden", "only the CatalystFDM app can approve browsers")
		}
		return c.Next()
	}

	v1.Get("/browser/pair/pending", func(c *fiber.Ctx) error {
		return OK(c, "ok", d.Browser.PendingRequests())
	})

	v1.Post("/browser/pair/pending/:id/approve", appOnly, func(c *fiber.Ctx) error {
		conn, err := d.Browser.ApprovePair(c.Params("id"))
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "approve failed", err.Error())
		}
		return OK(c, "connected", conn)
	})

	v1.Post("/browser/pair/pending/:id/deny", appOnly, func(c *fiber.Ctx) error {
		if err := d.Browser.DenyPair(c.Params("id")); err != nil {
			return Fail(c, fiber.StatusBadRequest, "deny failed", err.Error())
		}
		return OK(c, "denied", fiber.Map{"id": c.Params("id")})
	})

	v1.Get("/browser/me", pairGuard, func(c *fiber.Ctx) error {
		extID := c.Get("X-FDM-Extension-Id")
		if extID != "" {
			d.Browser.Touch(extID)
		}
		conn, err := d.Browser.ConnectionForToken(c.Get("X-FDM-Pairing-Token"), extID)
		if err != nil {
			return OK(c, "ok", fiber.Map{"paired": true})
		}
		return OK(c, "ok", fiber.Map{"paired": true, "connection": conn})
	})

	// Legacy manual-token flow: Settings → generate token → paste into the extension → register.
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
		conn, err := d.Browser.Pair(strings.TrimSpace(body.BrowserName), strings.TrimSpace(body.ExtensionID), c.Get("X-FDM-Pairing-Token"))
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "pair failed", err.Error())
		}
		return OK(c, "paired", conn)
	})

	v1.Post("/browser/inspect", pairGuard, func(c *fiber.Ctx) error {
		if extID := c.Get("X-FDM-Extension-Id"); extID != "" {
			d.Browser.Touch(extID)
		}
		return inspect(c, d)
	})

	v1.Post("/browser/add-download", pairGuard, func(c *fiber.Ctx) error {
		var body struct {
			URL       string `json:"url"`
			Referrer  string `json:"referrer"`
			Filename  string `json:"filename"`
			PageTitle string `json:"page_title"`
			mediaFields
		}
		if err := c.BodyParser(&body); err != nil {
			return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
		}
		extID := c.Get("X-FDM-Extension-Id")
		if extID != "" {
			d.Browser.Touch(extID)
		}
		in := downloads.AddDownloadInput{
			URL: body.URL, Filename: body.Filename, PageTitle: body.PageTitle,
			Referrer: body.Referrer, Source: "browser", ExecConfirmed: false,
		}
		body.mediaFields.apply(&in)
		dl, err := d.Manager.AddDownload(in)
		if err != nil {
			return Fail(c, fiber.StatusBadRequest, "add failed", err.Error())
		}
		if dl.Skipped {
			return OK(c, "already downloaded", dl)
		}
		return OK(c, "download added", startOrSchedule(d, dl, body.When))
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
		out["recent_speed_bps"] = recentSpeed(d.DB)
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

// recentSpeed is the average throughput of the last 20 finished downloads, so the app can say
// how long each quality will take on this connection. 0 when there's no history yet.
func recentSpeed(db *gorm.DB) int64 {
	var rows []models.Download
	if err := db.Where("status = ? AND started_at IS NOT NULL AND completed_at IS NOT NULL AND downloaded_bytes > ?",
		models.DownloadCompleted, 1<<20).Order("completed_at DESC").Limit(20).Find(&rows).Error; err != nil {
		return 0
	}
	var bytes int64
	var secs float64
	for _, r := range rows {
		d := r.CompletedAt.Sub(*r.StartedAt).Seconds()
		if d < 1 || d > 6*3600 {
			continue
		}
		bytes += r.DownloadedBytes
		secs += d
	}
	if secs == 0 {
		return 0
	}
	return int64(float64(bytes) / secs)
}

// startOrSchedule starts a new download now, or for when = "night" waits for the night data
// window. Executables wait for the user's OK either way.
func startOrSchedule(d Deps, dl *models.Download, when string) *models.Download {
	if dl.RequiresExecConfirm && !dl.ExecConfirmed {
		return dl
	}
	if strings.EqualFold(strings.TrimSpace(when), "night") {
		if got, err := d.Manager.ScheduleNight(dl.ID); err == nil {
			return got
		}
	}
	_ = d.Manager.StartDownload(dl.ID)
	return dl
}
