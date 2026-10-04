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
// GUI 进程本无控制台，但 SendCtrlBreak 的 AttachConsole(pid) 会让本进程临时加入
// 子进程的控制台，随后 GenerateConsoleCtrlEvent(CTRL_BREAK, 0) 的广播也会命中
// 本进程：Go runtime 将 CTRL_BREAK 映射为 SIGTERM，不接管则默认行为是进程直接
// 退出——停止流程会把自身杀掉。
//
// 决策（B24 Step 3）：保留"全局注册"而非改为按调用 Notify/Reset，这是故意的：
//   - AttachConsole 受进程级"单控制台"约束，两次并发 SendCtrlBreak 时后者 attach
//     失败，但其 defer Reset 若执行会撤掉前者窗口内仍需的免疫 → 广播自杀；
//   - signal.Reset 是进程级的，会一并清掉其他组件注册的 handler。
//
// 代价（明确接受）：整个生命周期内 SIGINT/SIGTERM 不再终止本进程。GUI 生命周期由
// 窗口关闭/PrepareExit 管理，taskkill /F 不受影响。channel 有缓冲且无人读取，
// 信号在此被有目的地吞掉，不是遗漏。
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

// infiniteWait 是 WaitForSingleObject 的 INFINITE（B24）。
// 旧写法把"无限"表达成 time.Duration（1<<31-1 ns）再经 uint32(Milliseconds())
// 截断 → 2147ms，看护协程每 2.1s 空转一次。
const infiniteWait = uint32(0xFFFFFFFF)

// WaitForExit 等待进程句柄 signaled 或超时。
func WaitForExit(handle windows.Handle, timeout time.Duration) bool {
	return waitHandleMs(handle, uint32(timeout.Milliseconds()))
}

// WaitForExitInfinite 真 INFINITE：阻塞到句柄 signaled 或句柄失效（WAIT_FAILED）。
// 调用方必须保证句柄生命周期不短于本次等待——见 orchestrator 的
// watcherDone/pendingHandle 同步（B24）。
func WaitForExitInfinite(handle windows.Handle) bool {
	return waitHandleMs(handle, infiniteWait)
}

func waitHandleMs(handle windows.Handle, ms uint32) bool {
	const waitObject0 = 0
	ev, _ := windows.WaitForSingleObject(handle, ms)
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

var procCreateMutexW = kernel32.NewProc("CreateMutexW")

// TryCreateMutex 创建单实例锁。成功返回句柄与 true；锁已存在（二次启动）
// 返回句柄与 false、err == nil；err != nil 表示锁状态未知（创建失败），
// 调用方应 fail-open 照常启动，而不是当作已有实例。
func TryCreateMutex(name string) (windows.Handle, bool, error) {
	nameP, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, false, err
	}
	// GetLastError 必须紧邻 CreateMutexW 读取，中间不得插入其他 syscall。
	// 直接调用而非用 windows.CreateMutex 包装器：后者对 ERROR_ALREADY_EXISTS
	// 的处理随 x/sys 版本变化，不能依赖其区分「已存在」与「创建失败」。
	r, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(nameP)))
	if r == 0 {
		// 真正的创建失败：不能当成"已有实例在跑"，调用方应照常启动
		return 0, false, fmt.Errorf("CreateMutex: %w", lastErr)
	}
	alreadyRunning := lastErr == windows.ERROR_ALREADY_EXISTS
	return windows.Handle(r), !alreadyRunning, nil
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
