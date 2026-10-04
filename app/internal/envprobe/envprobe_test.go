package envprobe

import (
	"strings"
	"testing"
	"time"
)

// Task 1.15：runWithTimeout 的极短超时必须快速失败返回错误，
// 而不是让挂起的子进程永久阻塞调用方（Wails 绑定）。
func TestRunWithTimeoutFailsFast(t *testing.T) {
	// 1ns 超时：无论命令是什么都必须返回错误（LookPath 失败也是错误）
	start := time.Now()
	if _, err := runWithTimeout(1*time.Nanosecond, "cmd", "/c", "ping -n 6 127.0.0.1 >nul"); err == nil {
		t.Fatal("极短超时下应返回错误")
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("超时未生效：耗时 %v", elapsed)
	}
}

// runWithTimeout 经 LookPath 解析绝对路径；找不到的可执行文件必须返回错误。
func TestRunWithTimeoutMissingBinary(t *testing.T) {
	_, err := runWithTimeout(2*time.Second, "definitely-not-a-real-binary-indexvt-xyz")
	if err == nil {
		t.Fatal("不存在的可执行文件应返回错误")
	}
	if !strings.Contains(err.Error(), "找不到可执行文件") {
		t.Fatalf("错误信息应指明 LookPath 失败, got %v", err)
	}
}

// 控制器裁定 R5：原简报用两次 QueryVRAMCached 比较 TotalMB 作为"缓存生效"证据——
// 有 GPU 的机器上两次值恒等，断言不了任何东西。改为计数探针：
// TTL 内第二次调用不得再触发 probe（计数保持 1），TTL 过期后必须重新探测。
func TestQueryVRAMCachedSuppressesSecondProbeWithinTTL(t *testing.T) {
	// 清掉前序测试可能留下的缓存状态（不得整体赋值，否则会连带替换正在持有的 mu）
	vramCacheState.mu.Lock()
	vramCacheState.at, vramCacheState.val, vramCacheState.hasValue = time.Time{}, GPU{}, false
	vramCacheState.mu.Unlock()

	calls := 0
	orig := queryVRAMProbe
	queryVRAMProbe = func() (GPU, error) {
		calls++
		return GPU{Present: true, Name: "test-gpu", TotalMB: 24576, UsedMB: 1024, FreeMB: 23552, DriverOK: true}, nil
	}
	t.Cleanup(func() {
		queryVRAMProbe = orig
		vramCacheState.mu.Lock()
		vramCacheState.at, vramCacheState.val, vramCacheState.hasValue = time.Time{}, GPU{}, false
		vramCacheState.mu.Unlock()
	})

	g1, err := QueryVRAMCached(time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	g2, err := QueryVRAMCached(time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("TTL 内第二次调用未命中缓存：probe 次数 = %d, want 1", calls)
	}
	if g1 != g2 {
		t.Fatalf("第二次调用应返回同一条缓存值: %+v vs %+v", g1, g2)
	}

	// TTL 过期 → 必须重新探测
	time.Sleep(5 * time.Millisecond)
	if _, err := QueryVRAMCached(time.Nanosecond); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("TTL 过期后应重新探测：probe 次数 = %d, want 2", calls)
	}
}
