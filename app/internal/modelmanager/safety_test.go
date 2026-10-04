package modelmanager

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"indexvt/internal/store"
)

// ---------- OrchestratorView 测试替身 ----------
//
// OrchestratorView（manager.go:64）共 7 个方法：
// State / CurrentModel / CurrentModelPath / EndpointPort / ActiveTasks /
// IdleSeconds / KeepAlive。替身必须全部实现，多一个少一个都编译不过。

// deadlockOrch 复现 setState 的回调形态：State() 在持「opMu」期间反向调用
// m.MarkRan()，构造 AB-BA 环路——
//
//	List     : 持 m.mu → 取 opMu（m.orch.State）
//	setState : 持 opMu → OnEvent → MarkRan → 取 m.mu
//
// 修复后 List 必须先把编排态读成快照（锁外），再持 m.mu 做纯计算。
type deadlockOrch struct {
	m    *Manager
	opMu sync.Mutex // 模拟 orchestrator.opMu
}

func (f *deadlockOrch) State() string {
	f.opMu.Lock()
	defer f.opMu.Unlock()
	f.m.MarkRan("translate") // 模拟 orchestrator.setState 持 opMu 期间回调 OnEvent
	return "idle"
}
func (f *deadlockOrch) CurrentModel() string     { return "" }
func (f *deadlockOrch) CurrentModelPath() string { return "" }
func (f *deadlockOrch) EndpointPort() int        { return 0 }
func (f *deadlockOrch) ActiveTasks() int         { return 0 }
func (f *deadlockOrch) IdleSeconds() int         { return 0 }
func (f *deadlockOrch) KeepAlive()               {}

// stubOrchView 无害版本（不制造环路），供其他安全测试复用。
type stubOrchView struct{}

func (stubOrchView) State() string             { return "idle" }
func (stubOrchView) CurrentModel() string      { return "" }
func (stubOrchView) CurrentModelPath() string  { return "" }
func (stubOrchView) EndpointPort() int         { return 0 }
func (stubOrchView) ActiveTasks() int          { return 0 }
func (stubOrchView) IdleSeconds() int          { return 0 }
func (stubOrchView) KeepAlive()                {}

func newManagerForTest(t *testing.T, orch OrchestratorView) *Manager {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, orch, nil, nil, nil, nil)
}

// TestListAndMarkRanDoNotDeadlock B13：List × MarkRan 的锁序反转。
// CGO_ENABLED=0 下 -race 不可用，故用显式超时护栏判定死锁。
func TestListAndMarkRanDoNotDeadlock(t *testing.T) {
	m := newManagerForTest(t, &deadlockOrch{})
	m.orch.(*deadlockOrch).m = m // 回填，构造 AB-BA 环路

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _ = m.List() }()
		go func() { defer wg.Done(); m.MarkRan("translate") }()
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()

	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("List × MarkRan 死锁（AB-BA：m.mu ↔ opMu）")
	}
}
