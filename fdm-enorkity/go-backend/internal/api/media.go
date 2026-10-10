package api

import (
	"strings"

	"fdm-enorkity/internal/downloads"

	"github.com/gofiber/fiber/v2"
)

// mediaFields are the optional media-engine fields accepted by both add-download routes.
type mediaFields struct {
	Engine          string `json:"engine"`
	QualityID       string `json:"quality_id"`
	Title           string `json:"title"`
	Thumbnail       string `json:"thumbnail"`
	Site            string `json:"site"`
	DurationSeconds int    `json:"duration_seconds"`
	SizeBytes       int64  `json:"size_bytes"`
	When            string `json:"when"` // "" / "now" | "night" (wait for the night data window)
	// SkipExisting: if a download with the same name is already saved or queued, return it
	// (with "skipped": true) instead of adding another.
	SkipExisting bool `json:"skip_existing"`
}

func (f mediaFields) apply(in *downloads.AddDownloadInput) {
	in.Engine = strings.TrimSpace(f.Engine)
	in.QualityID = f.QualityID
	in.Title = f.Title
	in.Thumbnail = f.Thumbnail
	in.Site = f.Site
	in.DurationSeconds = f.DurationSeconds
	in.SizeBytes = f.SizeBytes
	in.SkipExisting = f.SkipExisting
}

func inspect(c *fiber.Ctx, d Deps) error {
	var body struct {
		URL      string `json:"url"`
		Referrer string `json:"referrer"`
	}
	if err := c.BodyParser(&body); err != nil {
		return Fail(c, fiber.StatusBadRequest, "invalid body", err.Error())
	}
	res, err := d.Manager.Inspect(c.Context(), strings.TrimSpace(body.URL), strings.TrimSpace(body.Referrer))
	if err != nil {
		return Fail(c, fiber.StatusUnprocessableEntity, "inspect failed", err.Error())
	}
	return OK(c, "ok", res)
}
