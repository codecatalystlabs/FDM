package browser

// ===== ONE-CLICK PAIRING =====
// Pairing used to mean copying a 48-character token from the app into the extension popup.
// Now the extension asks to connect (RequestPair) and gets back a secret request id and a
// 4-digit code. The desktop app lists pending requests and shows "Allow / Don't Allow" with
// the same code, so the user can see both screens agree. Allowing mints a token for that one
// browser; the extension collects it once with its secret id (ClaimPair).
//
// ===== WHY PER-BROWSER TOKENS =====
// The old shared token meant "Revoke" only changed a status column while the token kept
// working. Each approved browser now has its own token hash on its BrowserConnection row, so
// revoking a browser really locks it out without unpairing the others.
//
// ===== WHY IN MEMORY =====
// A pending request is only useful for a few minutes while both screens are open. Keeping them
// in memory means a restart simply cancels them and nothing half-finished lands in the database.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strings"
	"sync"
	"time"

	"fdm-enorkity/internal/models"

	"gorm.io/gorm"
)

// PairTTL is how long a request waits for the user, and then for the extension to collect it.
const PairTTL = 5 * time.Minute

const maxPending = 20

// Pair request states reported to the extension.
const (
	PairPending  = "pending"
	PairApproved = "approved"
	PairDenied   = "denied"
	PairExpired  = "expired"
)

// PairRequest is a browser waiting to be allowed. Only the public fields reach the desktop app;
// the secret is returned once, to the extension that asked.
type PairRequest struct {
	ID          string    `json:"id"`
	BrowserName string    `json:"browser_name"`
	ExtensionID string    `json:"extension_id"`
	Code        string    `json:"code"`
	CreatedAt   time.Time `json:"created_at"`
	ExpiresAt   time.Time `json:"expires_at"`

	secret string
	status string
	token  string // plaintext, held only until the extension claims it
}

// PairTicket is what the extension receives when it asks to connect.
type PairTicket struct {
	RequestID string `json:"request_id"`
	Code      string `json:"code"`
	ExpiresIn int    `json:"expires_in"`
}

// PairResult is what the extension sees when it checks on its request.
type PairResult struct {
	Status     string                    `json:"status"`
	Token      string                    `json:"token,omitempty"`
	Connection *models.BrowserConnection `json:"connection,omitempty"`
}

type pairing struct {
	mu      sync.Mutex
	pending map[string]*PairRequest // by public id
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func randomCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

// HashToken is the SHA-256 hex stored for a token; the plaintext is never stored.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) > n {
		return s[:n]
	}
	return s
}

// prune drops expired requests. Callers hold p.mu.
func (p *pairing) prune(now time.Time) {
	for id, r := range p.pending {
		if now.After(r.ExpiresAt) {
			delete(p.pending, id)
		}
	}
}

func (s *Service) pairs() *pairing {
	s.once.Do(func() { s.pairing = &pairing{pending: map[string]*PairRequest{}} })
	return s.pairing
}

// RequestPair records a browser asking to connect. A second request from the same extension
// replaces the first, so reopening the popup never stacks up prompts.
func (s *Service) RequestPair(browserName, extensionID string) (*PairTicket, error) {
	extensionID = clip(extensionID, 128)
	if extensionID == "" {
		return nil, errors.New("extension_id required")
	}
	browserName = clip(browserName, 64)
	if browserName == "" {
		browserName = "Browser"
	}
	id, err := randomHex(12)
	if err != nil {
		return nil, err
	}
	secret, err := randomHex(32)
	if err != nil {
		return nil, err
	}
	code, err := randomCode()
	if err != nil {
		return nil, err
	}

	p := s.pairs()
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.prune(now)
	for pid, r := range p.pending {
		if r.ExtensionID == extensionID && r.status == PairPending {
			delete(p.pending, pid)
		}
	}
	if len(p.pending) >= maxPending {
		return nil, errors.New("too many pending connection requests; try again in a few minutes")
	}
	p.pending[id] = &PairRequest{
		ID: id, BrowserName: browserName, ExtensionID: extensionID, Code: code,
		CreatedAt: now, ExpiresAt: now.Add(PairTTL), secret: secret, status: PairPending,
	}
	return &PairTicket{RequestID: secret, Code: code, ExpiresIn: int(PairTTL.Seconds())}, nil
}

// PendingRequests lists requests still waiting for the user, oldest first.
func (s *Service) PendingRequests() []PairRequest {
	p := s.pairs()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	out := []PairRequest{}
	for _, r := range p.pending {
		if r.status == PairPending {
			out = append(out, PairRequest{
				ID: r.ID, BrowserName: r.BrowserName, ExtensionID: r.ExtensionID, Code: r.Code,
				CreatedAt: r.CreatedAt, ExpiresAt: r.ExpiresAt,
			})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}

// ApprovePair allows a pending request and mints this browser's token. The connection is only
// written when the extension collects the token (ClaimPair), so an approval the browser never
// picks up doesn't leave a "connected" browser that has no key.
func (s *Service) ApprovePair(id string) (*PairRequest, error) {
	p := s.pairs()
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	p.prune(now)
	r, ok := p.pending[id]
	if !ok || r.status != PairPending {
		return nil, errors.New("this connection request has expired")
	}
	token, err := randomHex(24)
	if err != nil {
		return nil, err
	}
	r.status, r.token = PairApproved, token
	r.ExpiresAt = now.Add(PairTTL) // time for the extension to collect it
	out := *r
	out.secret, out.token = "", ""
	return &out, nil
}

// DenyPair refuses a pending request.
func (s *Service) DenyPair(id string) error {
	p := s.pairs()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	r, ok := p.pending[id]
	if !ok || r.status != PairPending {
		return errors.New("this connection request has expired")
	}
	r.status = PairDenied
	return nil
}

// ClaimPair reports a request's state to the extension that made it. An approved token is
// handed over exactly once; after that the request is gone.
func (s *Service) ClaimPair(secret string) PairResult {
	p := s.pairs()
	p.mu.Lock()
	defer p.mu.Unlock()
	p.prune(time.Now())
	for id, r := range p.pending {
		if secret == "" || r.secret != secret {
			continue
		}
		switch r.status {
		case PairApproved:
			conn, err := s.upsertConnection(r.BrowserName, r.ExtensionID, HashToken(r.token))
			if err != nil {
				return PairResult{Status: PairPending} // keep the token; the extension asks again
			}
			delete(p.pending, id)
			return PairResult{Status: PairApproved, Token: r.token, Connection: conn}
		case PairDenied:
			delete(p.pending, id)
			return PairResult{Status: PairDenied}
		default:
			return PairResult{Status: PairPending}
		}
	}
	return PairResult{Status: PairExpired}
}

func (s *Service) upsertConnection(browserName, extensionID, tokenHash string) (*models.BrowserConnection, error) {
	now := time.Now()
	var conn models.BrowserConnection
	err := s.DB.Where("extension_id = ?", extensionID).First(&conn).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		conn = models.BrowserConnection{
			BrowserName:      browserName,
			ExtensionID:      extensionID,
			PairingTokenHash: tokenHash,
			Status:           models.BrowserActive,
			LastSeenAt:       &now,
		}
		if err := s.DB.Create(&conn).Error; err != nil {
			return nil, err
		}
		return &conn, nil
	}
	if err != nil {
		return nil, err
	}
	conn.BrowserName = browserName
	conn.PairingTokenHash = tokenHash
	conn.Status = models.BrowserActive
	conn.LastSeenAt = &now
	if err := s.DB.Save(&conn).Error; err != nil {
		return nil, err
	}
	return &conn, nil
}

// Authorize reports whether token may use the browser routes. A per-browser token must belong
// to an active connection. The legacy shared token (Settings → manual token) still works,
// except for a browser that was revoked.
func (s *Service) Authorize(token, extensionID string) bool {
	if token == "" {
		return false
	}
	var conn models.BrowserConnection
	err := s.DB.Where("pairing_token_hash = ? AND status = ?", HashToken(token), models.BrowserActive).First(&conn).Error
	if err == nil {
		return true
	}
	if !s.Settings.VerifyPairingToken(token) {
		return false
	}
	if extensionID == "" {
		return true
	}
	err = s.DB.Where("extension_id = ?", extensionID).First(&conn).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return true
	}
	return err == nil && conn.Status == models.BrowserActive
}

// ConnectionForToken returns the active connection a token belongs to, if any.
func (s *Service) ConnectionForToken(token, extensionID string) (*models.BrowserConnection, error) {
	var conn models.BrowserConnection
	err := s.DB.Where("pairing_token_hash = ? AND status = ?", HashToken(token), models.BrowserActive).First(&conn).Error
	if err == nil {
		return &conn, nil
	}
	if extensionID != "" {
		if err := s.DB.Where("extension_id = ? AND status = ?", extensionID, models.BrowserActive).First(&conn).Error; err == nil {
			return &conn, nil
		}
	}
	return nil, errors.New("no active connection for this token")
}
