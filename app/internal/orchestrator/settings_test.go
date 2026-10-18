package orchestrator

import (
	"context"
	"testing"
	"time"
)

func TestCanceledRequestStopsWaitingForEngineAndBalancesTask(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.state = StateStopping
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := o.TaskBeginContext(ctx, `C:\missing.gguf`, "translate"); done <- err }()
	deadline := time.Now().Add(time.Second)
	for o.ActiveTasks() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("task did not begin")
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case err := <-done:
		if err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel waited for engine load")
	}
	o.opMu.Lock()
	o.state = StateIdle
	o.opMu.Unlock()
	deadline = time.Now().Add(2 * time.Second)
	for o.ActiveTasks() != 0 {
		if time.Now().After(deadline) {
			t.Fatal("late engine result leaked task count")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDifferentModelCannotInterruptAnotherTask(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.state = StateRunning
	o.modelPath = "old.gguf"
	o.activeTasks = 1
	if _, err := o.TaskBegin("new.gguf", "nailong"); err == nil {
		t.Fatal("new model interrupted active task")
	}
	if o.state != StateRunning || o.modelPath != "old.gguf" || o.ActiveTasks() != 1 {
		t.Fatal("rejecting another model changed existing task")
	}
}

func TestSameModelWithChangedContextAlsoRespectsBusyTask(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.state = StateRunning
	o.modelPath = "same.gguf"
	o.loadedCtxTokens = 4096
	o.activeTasks = 1
	if _, err := o.TaskBegin("same.gguf", "translate"); err == nil {
		t.Fatal("changed context interrupted active task")
	}
	if o.ActiveTasks() != 1 {
		t.Fatal("task counter leaked")
	}
}
