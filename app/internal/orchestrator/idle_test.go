package orchestrator

import (
	"testing"
	"time"
)

type inactivitySettings struct{ stubSettings }

func (inactivitySettings) IdleMinutes() int { return 30 }

func TestInactivityWarningAndRelease(t *testing.T) {
	var events []Event
	o := New(inactivitySettings{}, Callbacks{OnEvent: func(e Event) { events = append(events, e) }}, nil)
	o.state = StateRunning
	start := time.Now()
	o.lastDoneNano.Store(start.UnixNano())
	o.idleTick(start.Add(30*time.Minute - time.Millisecond))
	if !o.warningAt.IsZero() {
		t.Fatal("warning before 30 minutes")
	}
	o.idleTick(start.Add(30 * time.Minute))
	if o.state != StateRunning || events[len(events)-1].Extra["remainingSeconds"] != 30 {
		t.Fatal("must warn for 30 seconds before release")
	}
	o.idleTick(start.Add(30*time.Minute + 29*time.Second))
	if o.state != StateRunning || events[len(events)-1].Extra["remainingSeconds"] != 1 {
		t.Fatal("released before countdown finished")
	}
	o.idleTick(start.Add(30*time.Minute + 30*time.Second))
	if o.state != StateIdle {
		t.Fatal("did not release at deadline")
	}
}

func TestActivityAndTaskCancelInactivityWarning(t *testing.T) {
	for _, mode := range []string{"pointer-or-keyboard", "active-task", "finished-task"} {
		t.Run(mode, func(t *testing.T) {
			o := New(inactivitySettings{}, Callbacks{}, nil)
			o.state = StateRunning
			now := time.Now()
			o.lastDoneNano.Store(now.Add(-31 * time.Minute).UnixNano())
			o.idleTick(now.Add(-29 * time.Second))
			switch mode {
			case "pointer-or-keyboard":
				o.KeepAlive()
			case "active-task":
				o.activeTasks = 1
			case "finished-task":
				o.activeTasks = 1
				o.TaskDone()
			}
			o.idleTick(now.Add(time.Second))
			if o.state != StateRunning || !o.warningAt.IsZero() {
				t.Fatal("activity/tasks must prevent release and cancel warning")
			}
		})
	}
}

func TestLongSuspensionStartsFreshCountdown(t *testing.T) {
	o := New(inactivitySettings{}, Callbacks{}, nil)
	o.state = StateRunning
	now := time.Now()
	o.lastDoneNano.Store(now.Add(-2 * time.Hour).UnixNano())
	o.idleTick(now)
	if o.state != StateRunning || o.idleReleaseSecondsLocked(now) != 30 {
		t.Fatal("long inactivity must still start a full warning countdown")
	}
}

func TestPreloadCannotStartAfterExit(t *testing.T) {
	o := New(inactivitySettings{}, Callbacks{}, nil)
	close(o.quit)
	if _, err := o.EnsureRunning("missing.gguf", "translate"); err == nil || o.state != StateIdle {
		t.Fatal("preload started after exit")
	}
}
