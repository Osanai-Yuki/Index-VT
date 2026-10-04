package orchestrator

import (
	"testing"
	"time"
)

// stubSettings 实现 orchestrator.go 中 Settings 接口的全部方法
// （NGLOverride / CtxTokens / CPUThreads / IdleMinutes）。
// NGLOverride 返回非负值：resolveNGL 只有在使用"自动"(-1)时才会调 envprobe.QueryVRAM
// （起 nvidia-smi 子进程），这里固定层数让测试只测量等待逻辑本身、不依赖本机 GPU。
type stubSettings struct{}

func (stubSettings) NGLOverride() int { return 0 }
func (stubSettings) CtxTokens() int64 { return 8192 }
func (stubSettings) CPUThreads() int  { return 4 }
func (stubSettings) IdleMinutes() int { return 5 }

// state 停在 Stopping 时 EnsureRunning 必须在超时后返回，而不是永久挂起（B12）。
func TestEnsureRunningDoesNotHangWhileStopping(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	o.opMu.Unlock()

	// 模拟空闲卸载真正结束：stopProcLocked 收尾时持 opMu 把 state 置回 idle。
	// 修复前全仓库零处 Broadcast/Signal，这条状态变更唤不醒 cond.Wait 的等待者。
	unloadDone := releaseStopping(o, 200*time.Millisecond)

	done := make(chan error, 1)
	go func() {
		_, err := o.EnsureRunning(`C:\nonexistent.gguf`, "translate")
		done <- err
	}()

	select {
	case err := <-done: // 返回错误也算没挂死（假模型路径必然启动失败）
		<-unloadDone
		t.Logf("EnsureRunning 已返回，err=%v", err)
		if err == nil {
			t.Fatal("预期假模型路径返回错误，实际返回 nil")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("EnsureRunning 在 state=stopping 时永久挂起：cond.Wait 无唤醒方")
	}
}

// Stop 是第二个等待点：state 停在 Stopping 时同样必须在超时后返回（B12）。
func TestStopDoesNotHangWhileStopping(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	o.opMu.Unlock()
	releaseStopping(o, 100*time.Millisecond)

	done := make(chan error, 1)
	go func() { done <- o.Stop(2 * time.Second) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Stop 返回错误: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Stop 在 state=stopping 时永久挂起")
	}
}

// PrepareExit 是第三个等待点（B12）。
func TestPrepareExitDoesNotHangWhileStopping(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	o.opMu.Unlock()
	// 600ms：晚于 PrepareExit 内部的 500ms SSE 等待，确保真正走进等待分支。
	releaseStopping(o, 600*time.Millisecond)

	done := make(chan error, 1)
	go func() { done <- o.PrepareExit() }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("PrepareExit 返回错误: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("PrepareExit 在 state=stopping 时永久挂起")
	}
}

// 等待必须有上限：state 一直是 Stopping 时返回 false，调用方据此报错（B12）。
func TestWaitWhileStoppingLockedTimesOut(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	start := time.Now()
	ok := o.waitWhileStoppingLocked(300 * time.Millisecond)
	elapsed := time.Since(start)
	st := o.state
	o.opMu.Unlock() // 返回时必须仍持有 opMu（调用方契约）

	if ok {
		t.Fatal("state 未变化时 waitWhileStoppingLocked 不应返回 true")
	}
	if st != StateStopping {
		t.Fatalf("state 被等待方意外修改: %s", st)
	}
	if elapsed < 300*time.Millisecond {
		t.Fatalf("未到上限就返回: %v", elapsed)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("超时后迟迟未返回: %v", elapsed)
	}
}

// 等待期间必须真正放开 opMu：卸载收尾（stopProcLocked 持 opMu 置回 idle）
// 拿不到锁就永远等不到状态变化，这正是原缺陷的现场（B12）。
func TestWaitWhileStoppingLockedReleasesOpMu(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	releaseStopping(o, 100*time.Millisecond)

	ok := o.waitWhileStoppingLocked(5 * time.Second)
	o.opMu.Unlock()

	if !ok {
		t.Fatal("等待方未放开 opMu：卸载协程拿不到锁，只能走到超时分支")
	}
}

// releaseStopping 模拟卸载结束：稍后持 opMu 把 state 置回 idle，
// 与 stopProcLocked 的收尾路径一致；返回的通道在状态置回后关闭。
func releaseStopping(o *Orchestrator, after time.Duration) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		time.Sleep(after)
		o.opMu.Lock()
		o.state = StateIdle
		o.opMu.Unlock()
		close(done)
	}()
	return done
}
