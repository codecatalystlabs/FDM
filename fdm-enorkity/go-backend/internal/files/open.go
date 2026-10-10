package files

// ===== OPEN AND REVEAL =====
// "Open" and "Show in folder" hand a finished download to the operating system. The API runs
// on the user's own machine, so the same call works from the Tauri window and from the browser
// UI. Opening is refused for anything that could run code (installers, scripts, launchers):
// the OS default action for those is to execute them, and one click should never do that.

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

var runnable = map[string]bool{
	".exe": true, ".msi": true, ".msix": true, ".bat": true, ".cmd": true, ".com": true, ".scr": true,
	".ps1": true, ".vbs": true, ".js": true, ".jar": true, ".sh": true, ".bash": true, ".run": true,
	".bin": true, ".appimage": true, ".desktop": true, ".deb": true, ".rpm": true, ".apk": true,
	".dmg": true, ".pkg": true, ".app": true, ".command": true, ".lnk": true, ".py": true, ".pl": true,
}

// IsRunnable reports whether opening path with the default app could execute it.
func IsRunnable(path string) bool {
	return runnable[strings.ToLower(filepath.Ext(path))]
}

// OpenWithDefaultApp opens a file with the user's default application.
func OpenWithDefaultApp(path string) error {
	if IsRunnable(path) {
		return errors.New("this file type can run code, so CatalystFDM won't open it; use Show in folder instead")
	}
	if _, err := os.Stat(path); err != nil {
		return errors.New("the file is no longer on disk")
	}
	switch runtime.GOOS {
	case "darwin":
		return detach(exec.Command("open", path))
	case "windows":
		return detach(exec.Command("rundll32", "url.dll,FileProtocolHandler", path))
	default:
		return detach(exec.Command("xdg-open", path))
	}
}

// Reveal shows the file in the system file manager (selected, where the platform supports it).
func Reveal(path string) error {
	target := path
	if _, err := os.Stat(path); err != nil {
		target = filepath.Dir(path)
		if _, err := os.Stat(target); err != nil {
			return errors.New("the folder is no longer on disk")
		}
	}
	switch runtime.GOOS {
	case "darwin":
		return detach(exec.Command("open", "-R", target))
	case "windows":
		return detach(exec.Command("explorer", "/select,", target))
	default:
		if target == path {
			target = filepath.Dir(path)
		}
		return detach(exec.Command("xdg-open", target))
	}
}

// detach starts cmd and reaps it in the background so no zombie is left behind.
func detach(cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
