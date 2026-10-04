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
