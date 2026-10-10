//go:build !windows

package media

import (
	"os/exec"
	"syscall"
)

// prepareCmd runs yt-dlp in its own process group so cancelling also stops the ffmpeg it spawns.
func prepareCmd(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
