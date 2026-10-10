package browser

import (
	"path/filepath"
	"testing"

	"fdm-enorkity/internal/database"
	"fdm-enorkity/internal/settings"
)

func newService(t *testing.T) *Service {
	t.Helper()
	db, err := database.Connect(filepath.Join(t.TempDir(), "fdm.db"), false)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{DB: db, Settings: &settings.Store{DB: db}}
}

func TestOneClickPairing(t *testing.T) {
	s := newService(t)
	ticket, err := s.RequestPair("Brave", "ext-1")
	if err != nil || len(ticket.Code) != 4 || ticket.RequestID == "" {
		t.Fatalf("RequestPair = %+v, %v", ticket, err)
	}
	if got := s.ClaimPair(ticket.RequestID); got.Status != PairPending {
		t.Fatalf("before approval: %+v, want pending", got)
	}
	pending := s.PendingRequests()
	if len(pending) != 1 || pending[0].Code != ticket.Code || pending[0].BrowserName != "Brave" {
		t.Fatalf("pending = %+v", pending)
	}
	if pending[0].ID == ticket.RequestID {
		t.Fatal("the app must never see the extension's secret request id")
	}
	if _, err := s.ApprovePair(pending[0].ID); err != nil {
		t.Fatal(err)
	}
	if rows, _ := s.ListConnections(); len(rows) != 0 {
		t.Fatal("no connection should exist until the extension collects its token")
	}
	got := s.ClaimPair(ticket.RequestID)
	if got.Status != PairApproved || got.Token == "" || got.Connection == nil {
		t.Fatalf("after approval: %+v", got)
	}
	if again := s.ClaimPair(ticket.RequestID); again.Token != "" || again.Status != PairExpired {
		t.Fatalf("token handed out twice: %+v", again)
	}
	if !s.Authorize(got.Token, "ext-1") {
		t.Fatal("approved token should authorize")
	}
	if s.Authorize("not-the-token", "ext-1") {
		t.Fatal("wrong token authorized")
	}
	if err := s.Revoke(got.Connection.ID); err != nil {
		t.Fatal(err)
	}
	if s.Authorize(got.Token, "ext-1") {
		t.Fatal("revoked browser still authorized")
	}
}

func TestPairDenyAndReplace(t *testing.T) {
	s := newService(t)
	first, _ := s.RequestPair("Chrome", "ext-2")
	second, _ := s.RequestPair("Chrome", "ext-2")
	if len(s.PendingRequests()) != 1 {
		t.Fatal("a second request from the same browser should replace the first")
	}
	if got := s.ClaimPair(first.RequestID); got.Status != PairExpired {
		t.Fatalf("replaced request = %+v, want expired", got)
	}
	if err := s.DenyPair(s.PendingRequests()[0].ID); err != nil {
		t.Fatal(err)
	}
	if got := s.ClaimPair(second.RequestID); got.Status != PairDenied || got.Token != "" {
		t.Fatalf("denied request = %+v", got)
	}
	if len(s.PendingRequests()) != 0 {
		t.Fatal("denied request still pending")
	}
}

func TestLegacyTokenRevoke(t *testing.T) {
	s := newService(t)
	tok, err := s.Settings.GeneratePairingToken()
	if err != nil {
		t.Fatal(err)
	}
	conn, err := s.Pair("Chromium", "ext-3", tok)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Authorize(tok, "ext-3") {
		t.Fatal("legacy token should authorize")
	}
	if err := s.Revoke(conn.ID); err != nil {
		t.Fatal(err)
	}
	if s.Authorize(tok, "ext-3") || s.Authorize(tok, "") {
		t.Fatal("revoking a legacy browser must retire the shared token")
	}
}
