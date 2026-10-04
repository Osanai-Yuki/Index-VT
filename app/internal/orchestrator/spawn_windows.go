//go:build windows

package orchestrator

import (
	"fmt"
	"os"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// spawnProc 以 CREATE_NO_WINDOW 启动子进程，stdout/stderr 重定向到日志文件，
// 返回进程句柄（同步等待语义由调用方在句柄上实现）。
// 安全：可执行文件与参数已经 validateExecutable/sanitizeArgs 白名单校验，
// 参数经 syscall.EscapeArg 逐个转义后拼成命令行，不经任何 shell。
// 注意：日志句柄必须以 bInheritHandle=TRUE 创建（Go os.OpenFile 的句柄不可继承，
// 子进程会拿到无效 std 句柄——M2 实测导致 llama-server 随机退出）。
func spawnProc(exe string, args []string, dir, logPath string) (windows.Handle, uint32, error) {
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
	var si windows.StartupInfo
	si.Cb = uint32(unsafe.Sizeof(si))
	si.Flags = startfUseStdHandles
	si.StdOutput = logHandle
	si.StdErr = logHandle

	const createNoWindow = 0x08000000
	var pi windows.ProcessInformation
	err = windows.CreateProcess(
		appName, cmdline, nil, nil, true /*inherit handles: log file*/, createNoWindow,
		nil, dirU16, &si, &pi)
	if err != nil {
		return 0, 0, fmt.Errorf("CreateProcess(llama-server): %w", err)
	}
	// 主线程句柄不需要
	windows.CloseHandle(pi.Thread)
	return pi.Process, pi.ProcessId, nil
}
