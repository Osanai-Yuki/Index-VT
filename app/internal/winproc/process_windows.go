//go:build windows

// Package winproc 封装 Windows 进程/控制台/窗口底层能力
// （02 文档 §6.4：枚举进程 + 读命令行；§6.2：CTRL_BREAK 优雅停止）。
package winproc

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ProcInfo 进程快照条目。
type ProcInfo struct {
	PID     uint32
	Name    string
	CmdLine string
}

const (
	processQueryLimitedInformation = 0x1000
	// ProcessCommandLineInformation = 93，返回命令行 UNICODE_STRING（Vista+）。
	processCommandLineInformation = 93
)

var (
	ntdll                        = windows.NewLazySystemDLL("ntdll.dll")
	ntQueryInformationProcessProc = ntdll.NewProc("NtQueryInformationProcess")
)

// List 枚举全部进程（Toolhelp 快照）并读取各自命令行。
func List() ([]ProcInfo, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, fmt.Errorf("CreateToolhelp32Snapshot: %w", err)
	}
	defer windows.CloseHandle(snap)

	var out []ProcInfo
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	err = windows.Process32First(snap, &entry)
	for ; err == nil; err = windows.Process32Next(snap, &entry) {
		name := windows.UTF16ToString(entry.ExeFile[:])
		cmd, _ := CommandLine(entry.ProcessID)
		out = append(out, ProcInfo{PID: entry.ProcessID, Name: name, CmdLine: cmd})
	}
	if err != nil && len(out) == 0 {
		return nil, fmt.Errorf("Process32First: %w", err)
	}
	return out, nil
}

// CommandLine 读取指定进程的命令行（NtQueryInformationProcess + ProcessCommandLineInformation）。
func CommandLine(pid uint32) (string, error) {
	h, err := windows.OpenProcess(processQueryLimitedInformation, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(h)

	var retLen uint32
	// 第一次调用获取所需缓冲区长度
	st, _, _ := ntQueryInformationProcessProc.Call(
		uintptr(h), uintptr(processCommandLineInformation), uintptr(unsafe.Pointer(&retLen)), uintptr(0), uintptr(unsafe.Pointer(&retLen)))
	const statusInfoLengthMismatch = 0xC0000004
	const statusSuccess = 0
	if st != uintptr(statusSuccess) && st != uintptr(statusInfoLengthMismatch) {
		return "", fmt.Errorf("NtQueryInformationProcess len: ntstatus=0x%x", st)
	}
	if retLen == 0 {
		return "", fmt.Errorf("NtQueryInformationProcess: empty length")
	}
	buf := make([]byte, retLen)
	st, _, _ = ntQueryInformationProcessProc.Call(
		uintptr(h), uintptr(processCommandLineInformation), uintptr(unsafe.Pointer(&buf[0])), uintptr(retLen), uintptr(unsafe.Pointer(&retLen)))
	if st != uintptr(statusSuccess) {
		return "", fmt.Errorf("NtQueryInformationProcess: ntstatus=0x%x", st)
	}
	return parseCommandLine(buf)
}

// parseCommandLine 解析 NtQueryInformationProcess(ProcessCommandLineInformation)
// 返回的缓冲区：
//
//	UNICODE_STRING { USHORT Length; USHORT MaximumLength; USHORT pad; ULONG pad; ULONG64 Buffer; }
//	后随 WCHAR[]。
//
// 独立成函数以便对畸形返回（缓冲区 < 头大小）做不依赖 syscall 的单测（B24）。
func parseCommandLine(buf []byte) (string, error) {
	const usLenOff = 0
	const dataOff = 16 // UNICODE_STRING 头大小（x64 对齐后）
	// 必须早于任何 &buf[dataOff]：缓冲区不足时 len(buf)-dataOff 为负，
	// uint16 回绕会让下面的 clamp 变成"无需 clamp"，然后索引越界 panic。
	if len(buf) < dataOff {
		return "", fmt.Errorf("NtQueryInformationProcess: 返回 %d 字节，不足以容纳 UNICODE_STRING 头", len(buf))
	}
	usLen := *(*uint16)(unsafe.Pointer(&buf[usLenOff]))
	if int(usLen) > len(buf)-dataOff {
		usLen = uint16(len(buf) - dataOff)
	}
	if int(usLen)%2 != 0 { // WCHAR 数组必须偶数字节
		usLen--
	}
	if usLen == 0 {
		// len(buf) == dataOff 时 &buf[dataOff] 本身就会索引越界（Go 切片不允许
		// one-past-end 下标，即便随后取长度为 0 的切片），必须先分支跳过。
		return "", nil
	}
	u16 := unsafe.Slice((*uint16)(unsafe.Pointer(&buf[dataOff])), int(usLen)/2)
	return windows.UTF16ToString(u16), nil
}

// ListenerPortsByPID 返回 监听中 TCP 端口 → PID 映射（GetExtendedTcpTable）。
func ListenerPortsByPID() (map[uint32]uint16, error) {
	out := make(map[uint32]uint16)
	// 先探测所需缓冲区大小
	size := uint32(0)
	ret, _, _ := procGetExtendedTcpTable.Call(
		0, uintptr(unsafe.Pointer(&size)), 0, uintptr(windows.AF_INET),
		uintptr(tcpTableOwnerPIDListener), 0)
	if ret != uintptr(insufficientBuffer) && ret != 0 {
		return nil, fmt.Errorf("GetExtendedTcpTable(size): ret=0x%x", ret)
	}
	if size == 0 {
		return out, nil
	}
	buf := make([]byte, size)
	ret, _, _ = procGetExtendedTcpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)), 0,
		uintptr(windows.AF_INET), uintptr(tcpTableOwnerPIDListener), 0)
	if ret != 0 {
		return nil, fmt.Errorf("GetExtendedTcpTable: ret=0x%x", ret)
	}
	parseTcpOwnerListenerTable(buf, out)
	return out, nil
}

// 结构（x64）：DWORD numEntries; MIB_TCPTABLE_OWNER_PID{ DWORD state; DWORD localAddr; DWORD localPort (network order high byte*256+low); ... }[]
// MIB_TCPROW_OWNER_PID = {dwState, dwLocalAddr, dwLocalPort, dwRemoteAddr, dwRemotePort, dwOwningPid} — 6×4 字节。
// 字段偏移：dwState@0、dwLocalAddr@4、dwLocalPort@8、dwRemoteAddr@12、dwRemotePort@16、dwOwningPid@20。
func parseTcpOwnerListenerTable(buf []byte, out map[uint32]uint16) {
	// 同类前置校验（B24）：下面立即读取 4 字节条目数，缓冲区不足以容纳时直接放弃，
	// 与 CommandLine 一样不允许越界读。
	if len(buf) < 4 {
		return
	}
	n := *(*uint32)(unsafe.Pointer(&buf[0]))
	parseTcpOwnerPIDRows(buf[4:], n, out)
}

// parseTcpOwnerPIDRows 纯行解析循环：rows 为 MIB_TCPROW_OWNER_PID 数组原始字节。
// 独立成函数以便用内存构造的表做不依赖真实套接字的单测（B25 清扫指纹）。
func parseTcpOwnerPIDRows(rows []byte, n uint32, out map[uint32]uint16) {
	const rowSize = 24
	const mibTcpStateListen = 2
	for i := uint32(0); i < n; i++ {
		off := int(i) * rowSize
		if off+rowSize > len(rows) {
			break
		}
		state := *(*uint32)(unsafe.Pointer(&rows[off]))
		if state != mibTcpStateListen {
			continue
		}
		// dwLocalPort@8：低 16 位网络序（高字节在前）。旧实现误读 off+6/off+7
		//（dwLocalAddr 的第 2、3 字节），使端口指纹永不匹配、残留清扫静默失效。
		localPort := uint16(rows[off+8])<<8 | uint16(rows[off+9])
		pid := *(*uint32)(unsafe.Pointer(&rows[off+20]))
		out[pid] = localPort
	}
}

var (
	iphlpapi                  = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetExtendedTcpTable   = iphlpapi.NewProc("GetExtendedTcpTable")
	tcpTableOwnerPIDListener  = 23 // TCP_TABLE_OWNER_PID_LISTENER
	insufficientBuffer        = 0x7A // ERROR_INSUFFICIENT_BUFFER
)
