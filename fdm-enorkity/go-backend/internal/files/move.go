package files

import (
	"fmt"
	"io"
	"os"
)

// MoveOrReplace moves src to dst. Prefer os.Rename; if that fails (e.g. cross-volume),
// copy bytes then remove src.
func MoveOrReplace(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open temp for copy: %w", err)
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create final: %w", err)
	}
	_, copyErr := io.Copy(out, in)
	if cerr := out.Close(); cerr != nil && copyErr == nil {
		copyErr = cerr
	}
	if copyErr != nil {
		_ = os.Remove(dst)
		return fmt.Errorf("copy to final: %w", copyErr)
	}
	if err := os.Remove(src); err != nil {
		_ = os.Remove(dst)
		return fmt.Errorf("remove temp after copy: %w", err)
	}
	return nil
}
