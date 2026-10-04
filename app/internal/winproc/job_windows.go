//go:build windows

package winproc

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Job Object 崩溃兜底（01 文档 §5.1 / ADR-006）：
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE——主进程任何形式退出（含崩溃/强杀）
// 时内核终止组内全部子进程。

const (
	jobObjectExtendedLimitInfoClass = 9
	jobObjectLimitKillOnJobClose    = 0x2000
)

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

var (
	kernel32Job = windows.NewLazySystemDLL("kernel32.dll")
	procCreateJobObjectW      = kernel32Job.NewProc("CreateJobObjectW")
	procSetInformationJobObject = kernel32Job.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32Job.NewProc("AssignProcessToJobObject")
)

// CreateKillOnCloseJob 创建带 KILL_ON_JOB_CLOSE 的 Job Object。
func CreateKillOnCloseJob() (windows.Handle, error) {
	h, _, err := procCreateJobObjectW.Call(0, 0)
	if h == 0 {
		return 0, fmt.Errorf("CreateJobObjectW: %w", err)
	}
	info := jobObjectExtendedLimitInformation{}
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	r1, _, err := procSetInformationJobObject.Call(
		h, jobObjectExtendedLimitInfoClass,
		uintptr(unsafe.Pointer(&info)), uintptr(unsafe.Sizeof(info)))
	if r1 == 0 {
		windows.CloseHandle(windows.Handle(h))
		return 0, fmt.Errorf("SetInformationJobObject: %w", err)
	}
	return windows.Handle(h), nil
}

// AssignToJob 将进程加入 Job Object。
func AssignToJob(job, proc windows.Handle) error {
	r1, _, err := procAssignProcessToJobObject.Call(uintptr(job), uintptr(proc))
	if r1 == 0 {
		return fmt.Errorf("AssignProcessToJobObject: %w", err)
	}
	return nil
}

// CloseJob 关闭 Job 句柄（触发 KILL_ON_JOB_CLOSE）。
func CloseJob(job windows.Handle) {
	if job != 0 {
		windows.CloseHandle(job)
	}
}

// PIDOf 由进程句柄取 PID（GetProcessId）。
func PIDOf(h windows.Handle) uint32 {
	id, _ := windows.GetProcessId(h)
	return id
}
