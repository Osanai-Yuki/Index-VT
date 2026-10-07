//go:build windows

package envprobe

import (
	"os/exec"
	"syscall"

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

// hideConsoleWindow 阻止子进程的控制台窗口闪现。本应用是 GUI 子系统进程（无
// 自身控制台），裸 spawn 控制台程序（nvidia-smi / reg）时 Windows 会为其新建
// 一个可见控制台窗口；这些命令秒退，窗口只闪现一瞬。状态栏每 5s 轮询系统状态、
// 显存查询缓存 TTL 15s → 每约 15s 闪一次黑窗，即"间歇性后台弹窗"（B34）。
// CREATE_NO_WINDOW：控制台对象仍会分配（stdout/stderr 管道重定向不受影响），
// 只是不创建窗口。
func hideConsoleWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW
}
