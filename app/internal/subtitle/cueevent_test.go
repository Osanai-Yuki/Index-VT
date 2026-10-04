package subtitle

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// ============================================================================
// Task 1.17：引擎内存与并发（B29）——读取上限 / 持锁快照 / LRU 淘汰。
// ============================================================================

// 超过大小上限的文件必须在读取前被拒绝（旧实现 os.ReadFile 会整个吃进内存）。
func TestOpenRejectsOversizeFile(t *testing.T) {
	p := filepath.Join(t.TempDir(), "novel.srt")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	// Truncate 建稀疏文件：尺寸超限 1 字节，测试本身不占 32MB 内存。
	if err := f.Truncate(MaxSubtitleBytes + 1); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	e := NewEngine(nil)
	_, err = e.Open(p)
	if err == nil {
		t.Fatal("超过上限的文件未被拒绝")
	}
	msg := err.Error()
	if !strings.Contains(msg, "文件过大") ||
		!strings.Contains(msg, fmt.Sprintf("%d", int64(MaxSubtitleBytes)+1)) ||
		!strings.Contains(msg, fmt.Sprintf("%d", int64(MaxSubtitleBytes))) {
		t.Fatalf("错误信息须同时给出实际大小与上限: %q", msg)
	}
}

// GetDoc 必须返回隔离快照：调用方改写返回值不得穿透到引擎（旧实现返回活指针）。
func TestGetDocReturnsIsolatedSnapshot(t *testing.T) {
	e := NewEngine(nil)
	doc := newDocForTest(3)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	snap, err := e.GetDoc(doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	snap.Cues[0].Translated = "调用方改写"
	snap.Cues[0].State = CueDone
	snap.Cues[2].Original = "被篡改"
	snap.Styles = append(snap.Styles, StyleDef{Name: "X"})

	e.mu.Lock()
	live := e.docs[doc.ID]
	n := len(live.Cues)
	tr := live.Cues[0].Translated
	st := live.Cues[0].State
	orig := live.Cues[2].Original
	e.mu.Unlock()
	if n != 3 || tr != "" || st != CuePending || orig != "原文" {
		t.Fatalf("GetDoc 未返回隔离快照: n=%d translated=%q state=%v original=%q", n, tr, st, orig)
	}
}

// 队列进行中反复导出。注意：本测试只能捕获崩溃级竞争（无锁读与队列写同一底层
// 数组时可能读到撕裂的 slice header / 越界）——CGO_ENABLED=0 下 `go test -race`
// 不可用，故它不能证明竞争已消除，只能作为回归护栏。
func TestExportDuringQueueStaysConsistent(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		// 留出时隙，确保导出确实与队列并发（否则本测试形同虚设）。
		time.Sleep(time.Millisecond)
		return "T" + text, nil
	})
	doc := newDocForTest(500)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		if _, err := e.ExportToBytes(doc.ID, ExportOptions{Format: FormatSRT, Bilingual: BilingualTranslationOnly}); err != nil {
			t.Fatalf("第 %d 次导出失败: %v", i, err)
		}
	}
	waitQueueDone(t, e, doc.ID)

	// 队列结束后导出应含译文（确认导出读的确实是这批 cue）。
	out, err := e.ExportToBytes(doc.ID, ExportOptions{Format: FormatSRT, Bilingual: BilingualTranslationOnly})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(out), "T原文") {
		t.Fatalf("队列结束后的导出缺译文:\n%s", out)
	}
}

// 打开超过上限的文档必须淘汰最旧的（B29：否则长会话内存单调增长）。
func TestDocsMapEvicted(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) { return text, nil })
	for i := 0; i < maxRetainedDocs+5; i++ {
		d := newDocForTest(1)
		e.mu.Lock()
		d.ID = fmt.Sprintf("doc-%d", i)
		e.docs[d.ID] = d
		e.touchLocked(d.ID)
		e.mu.Unlock()
	}
	e.mu.Lock()
	n := len(e.docs)
	_, newest := e.docs[fmt.Sprintf("doc-%d", maxRetainedDocs+4)]
	_, oldest := e.docs["doc-0"]
	e.mu.Unlock()
	if n != maxRetainedDocs {
		t.Fatalf("未正确淘汰：保留 %d 篇，上限 %d", n, maxRetainedDocs)
	}
	if !newest || oldest {
		t.Fatalf("LRU 顺序错误：newest=%v oldest=%v", newest, oldest)
	}
}

// 淘汰正在跑队列的文档必须先取消队列，不得把文档从活队列 goroutine 底下静默删除。
func TestEvictionCancelsRunningQueue(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
		return "T" + text, nil
	})
	doc := newDocForTest(200) // 若未被取消，队列需 60s；waitQueueDone 10s 即判失败
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.touchLocked(doc.ID)
	e.mu.Unlock()

	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	// 再打开 maxRetainedDocs 篇，把 doc 挤成最旧并触发淘汰
	for i := 0; i < maxRetainedDocs; i++ {
		d := newDocForTest(1)
		d.ID = fmt.Sprintf("keep-%d", i)
		e.mu.Lock()
		e.docs[d.ID] = d
		e.touchLocked(d.ID)
		e.mu.Unlock()
	}
	waitQueueDone(t, e, doc.ID) // 淘汰未取消队列 → 超时 Fatal

	e.mu.Lock()
	_, still := e.docs[doc.ID]
	n := len(e.docs)
	e.mu.Unlock()
	if still {
		t.Fatalf("最旧文档未被淘汰（docs=%d）", n)
	}
}

// ============================================================================
// Task 1.9：字幕事件契约（B1 译文 / B2 计数差一 / B4 节流丢弃）。
// helper（newDocForTest / waitQueueDone）在 testhelpers_test.go，勿重复定义。
// ============================================================================

// 终态事件必须带译文，且最后一行 Done == Total（B1/B2）。
func TestQueueEmitsTranslatedAndCorrectCount(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "译文:" + text, nil
	})
	doc := newDocForTest(3)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	var events []CueProgress
	done := make(chan struct{})
	err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, func(p CueProgress) {
		events = append(events, p)
		if p.State == CueDone && p.Done == p.Total {
			select {
			case <-done:
			default:
				close(done)
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)

	var lastDone CueProgress
	for _, p := range events {
		if p.State == CueDone {
			lastDone = p
		}
		if p.State == CueDone && !strings.HasPrefix(p.Translated, "译文:") {
			t.Fatalf("终态事件缺译文: %+v", p)
		}
		if p.DocID != doc.ID {
			t.Fatalf("DocID 未填: %q", p.DocID)
		}
	}
	if lastDone.Done != lastDone.Total {
		t.Fatalf("计数差一：Done=%d Total=%d（应相等）", lastDone.Done, lastDone.Total)
	}
	if lastDone.Total != 3 {
		t.Fatalf("Total=%d，期望 3", lastDone.Total)
	}
}

// B4 回归（brief Step 6 无对应测试，此处补一条）：非终态事件不得被节流丢弃 ——
// 每条 cue 的 translating 必须先于其终态送达；队列退出（含取消）时挂起的
// translating 也要在删除 queueCancel 之前冲出。
func TestQueueCoalescesNonTerminalEvents(t *testing.T) {
	// 正常路径：快速翻译 → translating 事件被合并，但每条 cue 终态前必先见到 translating。
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "T" + text, nil
	})
	doc := newDocForTest(5)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	var events []CueProgress
	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, func(p CueProgress) {
		events = append(events, p)
	}); err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID) // 之后 events 才可安全读取（回调在队列 goroutine 内）

	for i, p := range events {
		if p.State != CueDone {
			continue
		}
		seen := false
		for j := 0; j < i; j++ {
			if events[j].State == CueTranslating && events[j].CueIndex == p.CueIndex {
				seen = true
				break
			}
		}
		if !seen {
			t.Fatalf("cue %d 的 translating 事件被节流丢弃（终态前未见）: %+v", p.CueIndex, events)
		}
	}

	// 取消路径：cue2 挂起的 translating 必须在队列退出时冲出（defer flushPending）。
	calls := 0
	e2 := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		calls++
		if calls > 1 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(10 * time.Second):
			}
		}
		return "T" + text, nil
	})
	doc2 := newDocForTest(5)
	e2.mu.Lock()
	e2.docs[doc2.ID] = doc2
	e2.mu.Unlock()

	var events2 []CueProgress
	if err := e2.TranslateQueue(doc2.ID, QueueOptions{TargetLang: "zh"}, func(p CueProgress) {
		events2 = append(events2, p)
	}); err != nil {
		t.Fatal(err)
	}
	// 持 e.mu 轮询引擎状态（不读 events2，避免测试自身竞争）：等 cue2 进入 translating
	// 即事件已（或即将）挂起，再取消。5s 超时说明队列根本没跑起来。
	deadline := time.Now().Add(5 * time.Second)
	st := CuePending
	for time.Now().Before(deadline) {
		e2.mu.Lock()
		st = e2.docs[doc2.ID].Cues[1].State
		e2.mu.Unlock()
		if st == CueTranslating {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if st != CueTranslating {
		t.Fatalf("队列未在 5s 内进入第二轮 translating（state=%v）", st)
	}
	e2.CancelQueue(doc2.ID)
	waitQueueDone(t, e2, doc2.ID)

	if len(events2) == 0 {
		t.Fatal("取消队列未收到任何事件")
	}
	last := events2[len(events2)-1]
	if last.State != CueTranslating || last.CueIndex != 2 {
		t.Fatalf("队列退出时挂起的 translating 未冲出: %+v", events2)
	}
	if last.Done != 1 || last.Total != 5 || last.DocID != doc2.ID {
		t.Fatalf("退出补发事件计数/DocID 错误: %+v", last)
	}
}

// ============================================================================
// Task 1.10：重译不清空译文（B5）。helper 在 testhelpers_test.go，勿重复定义。
// ============================================================================

// 重译失败时原有译文必须保留（B5）。旧实现先清空再重译，失败即永久丢失。
func TestRetryCuesKeepsOldTranslationOnFailure(t *testing.T) {
	var shouldFail bool
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		if shouldFail {
			return "", context.DeadlineExceeded
		}
		return "第一次", nil
	})
	doc := newDocForTest(2)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)
	if doc.Cues[0].Translated != "第一次" {
		t.Fatalf("前置条件不成立：%q", doc.Cues[0].Translated)
	}

	shouldFail = true
	if err := e.RetryCues(doc.ID, []int{1}, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)

	if doc.Cues[0].Translated != "第一次" {
		t.Fatalf("重译失败导致原译文丢失：%q（用户会永久失去这行结果）", doc.Cues[0].Translated)
	}
	if doc.Cues[0].State != CueFailed {
		t.Fatalf("状态应为 failed，实际 %v", doc.Cues[0].State)
	}
}
