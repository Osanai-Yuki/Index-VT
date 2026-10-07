package subtitle

import (
	"context"
	"strings"
	"testing"
)

// 「全部翻译」整卷重翻语义（2026-10-07 用户实测缺陷）：翻译完成后换目标语言再点
// 全部翻译，此前只拾取 pending/failed → 零目标静默空转，已翻条目永远保留旧语言译文。

func newDoneDocForTest(n int) *SubtitleDoc {
	doc := newDocForTest(n)
	for i := range doc.Cues {
		doc.Cues[i].State = CueDone
		doc.Cues[i].Translated = "旧语言译文"
	}
	return doc
}

// Full:true 重跑全部 done 条目并用新语言覆写译文。
func TestTranslateQueueFullRerunRetranslatesDone(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "[" + dst + "] " + text, nil
	})
	doc := newDoneDocForTest(3)
	doc.Cues[2].State = CueSkipped
	doc.Cues[2].Original = "   " // 空行：跳过与语言无关，Full 不得重置
	e.docs["d1"] = doc

	if err := e.TranslateQueue("d1", QueueOptions{TargetLang: "en", Full: true}, nil); err != nil {
		t.Fatalf("整卷重翻: %v", err)
	}
	waitQueueDone(t, e, "d1")

	e.mu.Lock()
	defer e.mu.Unlock()
	for i := 0; i < 2; i++ {
		c := &doc.Cues[i]
		if c.State != CueDone {
			t.Fatalf("cue%d state=%v want done", c.Index, c.State)
		}
		if !strings.HasPrefix(c.Translated, "[en] ") {
			t.Fatalf("cue%d 未用新语言重翻: %q", c.Index, c.Translated)
		}
	}
	if doc.Cues[2].State != CueSkipped || doc.Cues[2].Translated != "旧语言译文" {
		t.Fatalf("skipped 条目不应被 Full 触碰: state=%v translated=%q", doc.Cues[2].State, doc.Cues[2].Translated)
	}
}

// 默认（非 Full）语义保持：全 done 时零目标、静默结束、译文不动——重试路径依赖它。
func TestTranslateQueueDefaultLeavesDoneUntouched(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		t.Error("非 Full 队列不应调用翻译")
		return "", nil
	})
	doc := newDoneDocForTest(2)
	e.docs["d1"] = doc

	if err := e.TranslateQueue("d1", QueueOptions{TargetLang: "en"}, nil); err != nil {
		t.Fatalf("空目标队列应静默结束: %v", err)
	}
	waitQueueDone(t, e, "d1")

	e.mu.Lock()
	defer e.mu.Unlock()
	for _, c := range doc.Cues {
		if c.Translated != "旧语言译文" {
			t.Fatalf("cue%d 译文被意外覆写: %q", c.Index, c.Translated)
		}
	}
}

// 重试路径防御：Full 混进重试选项也不得波及各自目标集之外的条目。
func TestRetryPathsIgnoreFull(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "新译文", nil
	})
	doc := newDoneDocForTest(3)
	doc.Cues[1].State = CueFailed
	e.docs["d1"] = doc

	if err := e.RetryFailed("d1", QueueOptions{TargetLang: "en", Full: true}, nil); err != nil {
		t.Fatalf("RetryFailed: %v", err)
	}
	waitQueueDone(t, e, "d1")

	e.mu.Lock()
	if doc.Cues[0].Translated != "旧语言译文" || doc.Cues[2].Translated != "旧语言译文" {
		t.Fatalf("RetryFailed 波及了非 failed 条目: %q / %q", doc.Cues[0].Translated, doc.Cues[2].Translated)
	}
	if doc.Cues[1].Translated != "新译文" {
		t.Fatalf("failed 条目未重译: %q", doc.Cues[1].Translated)
	}
	e.mu.Unlock()

	// 单条重试同样只动指定条目
	doc.Cues[2].State = CueFailed
	if err := e.RetryCues("d1", []int{3}, QueueOptions{TargetLang: "ja", Full: true}, nil); err != nil {
		t.Fatalf("RetryCues: %v", err)
	}
	waitQueueDone(t, e, "d1")

	e.mu.Lock()
	defer e.mu.Unlock()
	if doc.Cues[2].Translated != "新译文" || doc.Cues[2].State != CueDone {
		t.Fatalf("指定条目未重译: %q %v", doc.Cues[2].Translated, doc.Cues[2].State)
	}
	if doc.Cues[0].Translated != "旧语言译文" {
		t.Fatalf("RetryCues 波及了未指定条目: %q", doc.Cues[0].Translated)
	}
}

// GetDoc 快照的 QueueActive 反映真实队列状态：进行中 true，结束后 false。
func TestGetDocReportsQueueActive(t *testing.T) {
	block := make(chan struct{})
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		<-block // 挂住第一条，维持队列进行态
		return "ok", nil
	})
	doc := newDocForTest(1)
	e.docs["d1"] = doc

	if err := e.TranslateQueue("d1", QueueOptions{TargetLang: "en"}, nil); err != nil {
		t.Fatalf("启动队列: %v", err)
	}
	snap, err := e.GetDoc("d1")
	if err != nil {
		t.Fatal(err)
	}
	if !snap.QueueActive {
		t.Fatal("队列进行中 GetDoc 应报 queueActive=true")
	}
	close(block)
	waitQueueDone(t, e, "d1")
	snap, err = e.GetDoc("d1")
	if err != nil {
		t.Fatal(err)
	}
	if snap.QueueActive {
		t.Fatal("队列结束后 GetDoc 应报 queueActive=false")
	}
}
