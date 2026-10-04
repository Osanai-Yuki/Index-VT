//go:build windows

package orchestrator

import (
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"

	"indexvt/internal/winproc"
)

// spawnProc 以 CREATE_NEW_CONSOLE|CREATE_SUSPENDED 启动子进程，stdout/stderr
// 重定向到日志文件，入 job 后才放行主线程，返回进程句柄（同步等待语义由调用方
// 在句柄上实现）。
//
// 安全：可执行文件与参数已经 validateExecutable/sanitizeArgs 白名单校验，
// 参数经 syscall.EscapeArg 逐个转义后拼成命令行，不经任何 shell。
// 注意：日志句柄必须以 bInheritHandle=TRUE 创建（Go os.OpenFile 的句柄不可继承，
// 子进程会拿到无效 std 句柄——M2 实测导致 llama-server 随机退出）。
func spawnProc(exe string, args []string, dir, logPath string, job windows.Handle) (windows.Handle, uint32, error) {
	if err := validateExecutable(exe); err != nil {
		return 0, 0, err
	}
	if err := sanitizeArgs(args); err != nil {
		return 0, 0, fmt.Errorf("启动参数非法: %w", err)
	}
	for i, a := range args { // 双保险：模型路径等外部输入不做任何扩展/拼接
		if strings.ContainsAny(a, "\r\n") {
			return 0, 0, fmt.Errorf("arg[%d] 含换行", i)
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, 0, err
	}

	// 命令行：首元素为完整 exe 路径
	quoted := make([]string, 0, len(args)+1)
	quoted = append(quoted, syscall.EscapeArg(exe))
	for _, a := range args {
		quoted = append(quoted, syscall.EscapeArg(a))
	}
	cmdline, err := windows.UTF16PtrFromString(strings.Join(quoted, " "))
	if err != nil {
		return 0, 0, err
	}
	appName, err := windows.UTF16PtrFromString(exe)
	if err != nil {
		return 0, 0, err
	}
	dirU16, err := windows.UTF16PtrFromString(dir)
	if err != nil {
		return 0, 0, err
	}
	logU16, err := windows.UTF16PtrFromString(logPath)
	if err != nil {
		return 0, 0, err
	}

	// stdout/stderr → 可继承日志句柄（append：打开后移到文件尾）
	var sa windows.SecurityAttributes
	sa.Length = uint32(unsafe.Sizeof(sa))
	sa.InheritHandle = 1
	logHandle, err := windows.CreateFile(
		logU16,
		windows.GENERIC_WRITE,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		&sa,
		windows.OPEN_ALWAYS,
		windows.FILE_ATTRIBUTE_NORMAL,
		0)
	if err != nil {
		return 0, 0, fmt.Errorf("打开 llama-server 日志失败: %w", err)
	}
	defer windows.CloseHandle(logHandle)
	windows.SetFilePointer(logHandle, 0, nil, windows.FILE_END)

	const startfUseStdHandles = 0x00000100
	const startfUseShowWindow = 0x00000001
	var si windows.StartupInfo
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = startfUseStdHandles | startfUseShowWindow
	si.StdOutput = logHandle
	si.StdErr = logHandle

	// CREATE_NEW_CONSOLE + SW_HIDE：子进程获得自己的（隐藏）控制台，
	// CTRL_BREAK 才可达——旧写法 CREATE_NO_WINDOW 让优雅停止路径永久不可达（B24）：
	// 无控制台的进程收不到 GenerateConsoleCtrlEvent，每次停止都退化为 ~3.3s 后强杀。
	// SW_HIDE 需要 STARTF_USESHOWWINDOW 才生效，否则隐藏控制台口惠而实不至。
	// CREATE_SUSPENDED：CreateProcess 成功后主线程保持挂起，加入 job 之后才
	// ResumeThread，消除"父进程在 CreateProcess 与 AssignToJob 之间崩溃 → 子进程
	// 在 job 兜底之外变孤儿"的窗口期（B24）。
	si.ShowWindow = windows.SW_HIDE
	var pi windows.ProcessInformation
	err = windows.CreateProcess(
		appName, cmdline, nil, nil, true, /*inherit handles: log file*/
		windows.CREATE_NEW_CONSOLE|windows.CREATE_SUSPENDED,
		nil, dirU16, &si, &pi)
	if err != nil {
		return 0, 0, fmt.Errorf("CreateProcess(llama-server): %w", err)
	}
	// job 兜底必须在放行主线程前生效；失败即终止仍挂起的子进程，不留半启动状态。
	if err := winproc.AssignToJob(job, pi.Process); err != nil {
		_ = windows.TerminateProcess(pi.Process, 1)
		windows.CloseHandle(pi.Thread)
		windows.CloseHandle(pi.Process)
		return 0, 0, fmt.Errorf("llama-server 加入 Job Object 失败: %w", err)
	}
	if _, err := windows.ResumeThread(pi.Thread); err != nil {
		_ = windows.TerminateProcess(pi.Process, 1)
		windows.CloseHandle(pi.Thread)
		windows.CloseHandle(pi.Process)
		return 0, 0, fmt.Errorf("ResumeThread(llama-server): %w", err)
	}
	// 主线程句柄不需要
	windows.CloseHandle(pi.Thread)
	return pi.Process, pi.ProcessId, nil
}
