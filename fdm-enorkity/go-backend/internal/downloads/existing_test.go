package downloads

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"fdm-enorkity/internal/models"
)

func TestStripExt(t *testing.T) {
	for in, want := range map[string]string{
		"Heroes 2 by Vj Junior.mp4": "Heroes 2 by Vj Junior",
		"Heroes 2 by Vj Junior":     "Heroes 2 by Vj Junior",
		"Mr. Robot 2 by Vj Ice P":   "Mr. Robot 2 by Vj Ice P",
		"Fall 2_ Deadpoint.webm":    "Fall 2_ Deadpoint",
	} {
		if got := stripExt(in); got != want {
			t.Errorf("stripExt(%q) = %q, want %q", in, got, want)
		}
	}
}

// Queuing a whole series again must not fetch the episodes the user already has.
func TestSkipExistingEpisodes(t *testing.T) {
	m, _ := newTestManager(t)
	payload := randomPayload(t, 64<<10)
	srv, _ := fileServer(t, payload, true, 0)
	ep := func(n string, skip bool) *models.Download {
		t.Helper()
		dl, err := m.AddDownload(AddDownloadInput{
			URL: srv.URL + "/port/str/eyJkcyI6" + n, PageTitle: n, Referrer: "https://munowatch.com/twolekede",
			Source: "browser", Title: n, Site: "Muno Watch", Thumbnail: "https://apposters.b-cdn.net/p.jpg",
			SkipExisting: skip,
		})
		if err != nil {
			t.Fatal(err)
		}
		return dl
	}

	first := ep("Heroes by Vj Junior", false)
	if first.Title != "Heroes by Vj Junior" || first.Site != "Muno Watch" || first.Thumbnail == "" {
		t.Errorf("episode details not kept on an http download: title %q site %q thumb %q", first.Title, first.Site, first.Thumbnail)
	}
	if err := m.StartDownload(first.ID); err != nil {
		t.Fatal(err)
	}
	done := waitStatus(t, m, first.ID, models.DownloadCompleted, 10*time.Second)
	if filepath.Base(done.FilePath) != "Heroes by Vj Junior.mp4" {
		t.Fatalf("saved as %q", filepath.Base(done.FilePath))
	}

	queued := ep("Heroes 2 by Vj Junior", false) // waiting in the queue, not started

	again := ep("Heroes by Vj Junior", true)
	if !again.Skipped || again.ID != first.ID {
		t.Errorf("finished episode re-added: skipped=%v id=%s, want the existing %s", again.Skipped, again.ID, first.ID)
	}
	if again2 := ep("Heroes 2 by Vj Junior", true); !again2.Skipped || again2.ID != queued.ID {
		t.Errorf("queued episode re-added: skipped=%v", again2.Skipped)
	}
	// "Heroes 2" must not match "Heroes 20", and a new episode is added normally.
	if ep20 := ep("Heroes 20 by Vj Junior", true); ep20.Skipped {
		t.Error("Heroes 20 was treated as a copy of an existing episode")
	}
	// Without the flag, duplicates are still allowed (the user asked for this file again).
	dup := ep("Heroes by Vj Junior", false)
	if dup.Skipped || dup.ID == first.ID {
		t.Error("skip applied without skip_existing")
	}
	if err := m.CancelDownload(dup.ID); err != nil {
		t.Fatal(err)
	}

	// A finished file the user deleted is fetched again; failed and cancelled ones are retried.
	if err := os.Remove(done.FilePath); err != nil {
		t.Fatal(err)
	}
	if re := ep("Heroes by Vj Junior", true); re.Skipped {
		t.Error("episode deleted from disk was skipped")
	}
	if err := m.CancelDownload(queued.ID); err != nil {
		t.Fatal(err)
	}
	if re := ep("Heroes 2 by Vj Junior", true); re.Skipped {
		t.Error("cancelled episode was skipped")
	}

	// Names that come from the URL are never matched.
	if got := existingName(AddDownloadInput{URL: srv.URL + "/a.mp4"}); got != "" {
		t.Errorf("existingName without a title = %q, want empty", got)
	}
}
