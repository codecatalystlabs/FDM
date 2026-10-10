//go:build windows

package media

import "os/exec"

// prepareCmd keeps the default behaviour on Windows (exec.CommandContext kills yt-dlp).
func prepareCmd(cmd *exec.Cmd) {}
