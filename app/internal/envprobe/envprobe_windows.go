//go:build windows

package envprobe

import (
	"golang.org/x/sys/windows"
)

func windowsOpenProcess(pid uint32) (windows.Handle, error) {
	return windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
}

func windowsCloseHandle(h windows.Handle) {
	if h != 0 {
		windows.CloseHandle(h)
	}
}
