//go:build windows

package winproc

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var kernel32 = windows.NewLazySystemDLL("kernel32.dll")

var (
	procAttachConsole           = kernel32.NewProc("AttachConsole")
	procFreeConsole             = kernel32.NewProc("FreeConsole")
	procSetConsoleCtrlHandler   = kernel32.NewProc("SetConsoleCtrlHandler")
	procGenerateConsoleCtrlEvt  = kernel32.NewProc("GenerateConsoleCtrlEvent")
)

const ctrlBreakEvent = 1

// ctrlBreakArmed 确保主进程对自身收到的控制台事件免疫。
// GUI 进程本无控制台，但 AttachConsole 后广播的 CTRL_BREAK 会回到本进程：
// Go runtime 将 CTRL_BREAK 映射为 SIGTERM，注册 Notify 后默认终止行为被接管。
var ctrlBreakArmed = func() bool {
	ch := make(chan os.Signal, 4)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT)
	return true
}()

// SendCtrlBreak 向目标进程的控制台广播 CTRL_BREAK_EVENT（02 文档 §6.2 首选优雅停止）。
//
// 前提：调用方为 GUI 子系统进程（无自身控制台）。流程：
// AttachConsole(pid) → GenerateConsoleCtrlEvent(CTRL_BREAK, 0)（同控制台全体）
// → FreeConsole。本进程通过预注册的 signal.Notify 免疫。
func SendCtrlBreak(pid uint32) error {
	r1, _, err := procAttachConsole.Call(uintptr(pid))
	if r1 == 0 {
		return fmt.Errorf("AttachConsole(%d): %v", pid, err)
	}
	// 恢复默认（不清空 Go runtime 的 signal 处理）：无需额外 handler。
	defer procFreeConsole.Call()
	r2, _, err := procGenerateConsoleCtrlEvt.Call(ctrlBreakEvent, 0)
	if r2 == 0 {
		return fmt.Errorf("GenerateConsoleCtrlEvent: %v", err)
	}
	return nil
}

// WaitForExit 等待进程句柄 signaled 或超时。
func WaitForExit(handle windows.Handle, timeout time.Duration) bool {
	const waitObject0 = 0
	ev, _ := windows.WaitForSingleObject(handle, uint32(timeout.Milliseconds()))
	return ev == waitObject0
}

// TerminateProcess 强制终止。
func TerminateProcess(handle windows.Handle, exitCode uint32) error {
	if handle == 0 {
		return fmt.Errorf("nil handle")
	}
	r1, _, err := procTerminateProcess.Call(uintptr(handle), uintptr(exitCode))
	if r1 == 0 {
		return err
	}
	return nil
}

var procTerminateProcess = kernel32.NewProc("TerminateProcess")

// ---------- 单实例锁（01 文档 §9：Global\IndexVT-SingleInstance） ----------

// TryCreateMutex 成功返回句柄与 true；已存在（二次启动）返回 false。
func TryCreateMutex(name string) (windows.Handle, bool, error) {
	utf16, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, false, err
	}
	h, err := windows.CreateMutex(nil, false, utf16)
	if err != nil {
		// ERROR_ALREADY_EXISTS 时 CreateMutex 仍返回句柄
		if errno, ok := err.(windows.Errno); ok && errno == 183 { // ERROR_ALREADY_EXISTS
			return h, false, nil
		}
		return 0, false, err
	}
	return h, true, nil
}

// ReleaseMutex 释放单实例锁句柄。
func ReleaseMutex(h windows.Handle) {
	if h != 0 {
		windows.CloseHandle(h)
	}
}

// ---------- 窗口激活（F-20：二次启动激活既有窗口） ----------

var user32 = windows.NewLazySystemDLL("user32.dll")

var (
	procFindWindowW        = user32.NewProc("FindWindowW")
	procShowWindow         = user32.NewProc("ShowWindow")
	procSetForegroundWindow = user32.NewProc("SetForegroundWindow")
	procIsIconic           = user32.NewProc("IsIconic")
)

// ActivateExistingWindow 按窗口标题查找并前置既有实例窗口。
func ActivateExistingWindow(title string) bool {
	tp, err := windows.UTF16PtrFromString(title)
	if err != nil {
		return false
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(tp)))
	if hwnd == 0 {
		return false
	}
	if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
		procShowWindow.Call(hwnd, 9) // SW_RESTORE
	}
	procSetForegroundWindow.Call(hwnd)
	return true
}
