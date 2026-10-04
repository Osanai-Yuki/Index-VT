//go:build windows

package winproc

import (
	"os/exec"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ---------- Task 1.13 Step 1：CommandLine 缓冲区前置校验（B24） ----------
// 旧实现：len(buf) < 16 时 len(buf)-dataOff 为负 → uint16 回绕 → clamp 条件恒假 →
// &buf[16] 越界 panic（启动残留清扫路径无 recover）。

// 短于 UNICODE_STRING 头的缓冲区必须返回 error 而非 panic。
func TestParseCommandLineShortBufferErrorsNotPanics(t *testing.T) {
	for n := 0; n < 16; n++ {
		s, err := parseCommandLine(make([]byte, n))
		if err == nil {
			t.Fatalf("len(buf)=%d: 应返回错误（缓冲区不足以容纳头部），got %q", n, s)
		}
	}
}

// 恰好只有 16 字节头（无 WCHAR 数据）：合法，返回空串。
func TestParseCommandLineHeaderOnlyBuffer(t *testing.T) {
	s, err := parseCommandLine(make([]byte, 16))
	if err != nil {
		t.Fatalf("仅头部缓冲区应合法: %v", err)
	}
	if s != "" {
		t.Fatalf("无数据应返回空串, got %q", s)
	}
}

// 谎报 usLen 远大于实际缓冲区：必须 clamp，返回实际可读部分而不是越界读。
func TestParseCommandLineClampsDeclaredLengthToBuffer(t *testing.T) {
	buf := make([]byte, 16+4)
	*(*uint16)(unsafe.Pointer(&buf[0])) = 0xFFFF // 谎报长度
	writeUTF16(t, buf[16:], "ab")
	s, err := parseCommandLine(buf)
	if err != nil {
		t.Fatalf("clamp 后不应报错: %v", err)
	}
	if s != "ab" {
		t.Fatalf("应按缓冲区实际长度夹取, got %q want %q", s, "ab")
	}
}

// usLen 为奇数（半个 WCHAR）：减一后按偶数字节解析，不产生替换字符。
func TestParseCommandLineOddLengthDropped(t *testing.T) {
	buf := make([]byte, 16+4)
	*(*uint16)(unsafe.Pointer(&buf[0])) = 3 // 1.5 个 WCHAR
	writeUTF16(t, buf[16:], "a")
	s, err := parseCommandLine(buf)
	if err != nil {
		t.Fatal(err)
	}
	if s != "a" {
		t.Fatalf("奇数长度减一后应解析出 %q, got %q", "a", s)
	}
}

// 正常路径：声明的 usLen 在缓冲内，逐字返回。
func TestParseCommandLineNormal(t *testing.T) {
	msg := `C:\llama-server.exe --port 8101`
	u16, err := windows.UTF16FromString(msg) // 含结尾 NUL
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 16+len(u16)*2+8) // 尾部留余量：usLen 只覆盖字符串本身
	*(*uint16)(unsafe.Pointer(&buf[0])) = uint16(len(msg) * 2)
	for i, v := range u16 {
		*(*uint16)(unsafe.Pointer(&buf[16+i*2])) = v
	}
	s, err := parseCommandLine(buf)
	if err != nil {
		t.Fatal(err)
	}
	if s != msg {
		t.Fatalf("got %q want %q", s, msg)
	}
}

func writeUTF16(t *testing.T, dst []byte, s string) {
	t.Helper()
	src, err := windows.UTF16FromString(s)
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range src {
		if i >= len(dst)/2 {
			break
		}
		*(*uint16)(unsafe.Pointer(&dst[i*2])) = v
	}
}

// ---------- Task 1.13 Step 2：WaitForExitInfinite 必须是真 INFINITE（B24） ----------
// 旧写法把"无限"表达成 time.Duration(1<<31-1 ns) → uint32(Milliseconds()) = 2147ms，
// 看护协程每 2.1s 假醒一次。本测试用一个存活 ~3s 的子进程钉住语义：
// 若实现退化为旧值，等待会在 ~2.147s 提前返回 false，elapsed < 2.5s 即失败。
func TestWaitForExitInfiniteOutlastsOldFakeTimeout(t *testing.T) {
	cmd := exec.Command("cmd", "/c", "ping -n 4 127.0.0.1 >nul") // ~3s
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill() }()

	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(cmd.Process.Pid))
	if err != nil {
		t.Fatalf("OpenProcess: %v", err)
	}
	defer windows.CloseHandle(h)

	start := time.Now()
	ok := WaitForExitInfinite(h)
	elapsed := time.Since(start)
	_ = cmd.Wait()
	if !ok {
		t.Fatal("WaitForExitInfinite 对存活进程返回 false")
	}
	if elapsed < 2500*time.Millisecond {
		t.Fatalf("等待 %v 后提前返回：仍是 2147ms 假 INFINITE", elapsed)
	}
}
