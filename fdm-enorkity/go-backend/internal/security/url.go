package security

import (
	"fmt"
	"net"
	"net/url"
	"strings"
)

// ValidateDownloadURL enforces http(s), optional private-network blocking.
func ValidateDownloadURL(raw string, allowPrivate bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("unsupported protocol: only http and https allowed")
	}

	host := strings.ToLower(strings.Split(u.Host, ":")[0])
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		if !allowPrivate {
			return nil, fmt.Errorf("localhost targets are disabled; enable in settings if intended")
		}
	}
	if !allowPrivate {
		if ips, err := net.LookupIP(host); err == nil {
			for _, ip := range ips {
				if isPrivateOrLoopback(ip) {
					return nil, fmt.Errorf("private network targets are disabled; enable in settings if intended")
				}
			}
		}
	}
	return u, nil
}

func isPrivateOrLoopback(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	return false
}
