package subtitle

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDocumentUndoRedoAndFailedEdit(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	e.docs["test"].ID = "test"
	before, _ := e.GetDoc("test")
	if _, err := e.DeleteCues("test", []int{1}); err != nil {
		t.Fatal(err)
	}
	if doc, _ := e.GetDoc("test"); !doc.CanUndo || len(doc.Cues) != len(before.Cues)-1 {
		t.Fatal("delete was not recorded")
	}
	if _, err := e.UpdateCue("test", 99999, CuePatch{}); err == nil {
		t.Fatal("expected invalid edit")
	}
	restored, err := e.Undo("test", false)
	if err != nil || len(restored.Cues) != len(before.Cues) || restored.CanUndo || !restored.CanRedo {
		t.Fatalf("undo wrong: %+v %v", restored, err)
	}
	redone, err := e.Undo("test", true)
	if err != nil || len(redone.Cues) != len(before.Cues)-1 {
		t.Fatal("redo did not restore deletion")
	}
	_, _ = e.Undo("test", false)
	if _, err := e.ShiftCue("test", 1, "endMs", 100); err != nil {
		t.Fatal(err)
	}
	if doc, _ := e.GetDoc("test"); doc.CanRedo {
		t.Fatal("new edit did not clear redo")
	}
}

func TestConcurrentTimeStepsDoNotLoseIncrements(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	e.docs["test"].ID = "test"
	start := e.docs["test"].Cues[0].EndMs
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.ShiftCue("test", 1, "endMs", 100); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	doc, _ := e.GetDoc("test")
	if doc.Cues[0].EndMs != start+2000 {
		t.Fatal("increments lost")
	}
}

func TestManualCorrectionIsNotOverwrittenByFailedRetry(t *testing.T) {
	e := NewEngine(func(context.Context, string, string, string) (string, error) {
		t.Error("manual result was retransmitted")
		return "overwritten", nil
	})
	doc := makeTestDoc()
	doc.ID = "test"
	e.docs["test"] = doc
	for i := range doc.Cues {
		doc.Cues[i].State = CueDone
	}
	doc.Cues[0].State = CueFailed
	manual := "Manual correction"
	if _, err := e.UpdateCue("test", 1, CuePatch{Translated: &manual}); err != nil {
		t.Fatal(err)
	}
	if err := e.RetryFailed("test", QueueOptions{}, nil); err == nil {
		t.Fatal("manual correction remained failed")
	}
	if doc.Cues[0].Translated != manual || doc.Cues[0].State != CueDone {
		t.Fatal("manual result changed")
	}
	e.queueCancel["test"] = &queueCtl{cancel: func() {}}
	if err := e.RetryCues("test", []int{1}, QueueOptions{}, nil); err == nil {
		t.Fatal("retry accepted during queue")
	}
	if doc.Cues[0].State != CueDone {
		t.Fatal("rejected retry still mutated cue state")
	}
}

func TestCancelReturnsTranslatingCueToPendingAndResumeWorks(t *testing.T) {
	started := make(chan struct{})
	completed := make(chan struct{}, 1)
	var calls atomic.Int32
	e := NewEngine(func(ctx context.Context, text, source, target string) (string, error) {
		if calls.Add(1) == 1 {
			close(started)
			<-ctx.Done()
			return "", ctx.Err()
		}
		return "resumed", nil
	})
	doc := makeTestDoc()
	doc.ID = "test"
	for i := range doc.Cues {
		doc.Cues[i].State = CueDone
	}
	doc.Cues[0].State = CuePending
	e.docs["test"] = doc
	if err := e.TranslateQueue("test", QueueOptions{}, nil); err != nil {
		t.Fatal(err)
	}
	<-started
	e.CancelQueue("test")
	deadline := time.Now().Add(2 * time.Second)
	for e.HasActiveQueue() {
		if time.Now().After(deadline) {
			t.Fatal("cancel did not finish")
		}
		time.Sleep(time.Millisecond)
	}
	snap, _ := e.GetDoc("test")
	if snap.Cues[0].State != CuePending {
		t.Fatal("canceled cue stuck translating")
	}
	revision := snap.Revision
	if err := e.TranslateQueue("test", QueueOptions{}, func(p CueProgress) {
		if p.State == CueDone {
			completed <- struct{}{}
		}
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-completed:
	case <-time.After(2 * time.Second):
		t.Fatal("resume did not complete")
	}
	snap, _ = e.GetDoc("test")
	if snap.Cues[0].Translated != "resumed" || snap.Revision <= revision {
		t.Fatal("resume/revision did not advance")
	}
}

func TestGlossaryIsFrozenInQueueContext(t *testing.T) {
	done := make(chan CueProgress, 10)
	e := NewEngine(func(ctx context.Context, text, source, target string) (string, error) {
		terms := GlossaryFromContext(ctx)
		if len(terms) != 1 || terms[0].Translation != "Queen" {
			return "", fmt.Errorf("missing frozen glossary")
		}
		return "Queen", nil
	})
	e.docs["test"] = makeTestDoc()
	e.docs["test"].ID = "test"
	opt := QueueOptions{Full: true, Terms: []GlossaryTerm{{Term: "王妃", Translation: "Queen"}}}
	if err := e.TranslateQueue("test", opt, func(p CueProgress) { done <- p }); err != nil {
		t.Fatal(err)
	}
	opt.Terms[0].Translation = "changed"
	defer e.CancelQueue("test")
	for {
		select {
		case p := <-done:
			if p.State == CueFailed {
				t.Fatal("queue did not freeze terms")
			}
			if p.State == CueDone {
				return
			}
		case <-time.After(5 * time.Second):
			t.Fatal("queue produced no completed cue")
		}
	}
}
