package docpipeline

import (
	"context"
	"strings"
	"testing"
	"time"

	"indexvt/internal/translator"
)

// 管线主体测试（M5 步 3）：块状态机、取消续跑、覆盖率、prompt 组装、导出。

func dir(s string) translator.NailongDirection { return translator.NailongDirection(s) }

// waitDocDone 轮询 cancel 表直到 docID 的队列结束；10s 超时 Fatal。
func waitDocDone(t *testing.T, e *Engine, docID string) {
	t.Helper()
	for i := 0; i < 400; i++ {
		e.mu.Lock()
		_, busy := e.cancel[docID]
		e.mu.Unlock()
		if !busy {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("队列 10s 内未结束")
}

// 全跑：多块全部 done，进度单调，完成事件无错，导出可用。
func TestPipelineFullRun(t *testing.T) {
	var progress []DocProgress
	e := NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) {
		return "译:" + prompt, nil
	})
	para := strings.Repeat("王妃去了青岩关。", 60) // 480 字/段
	text := strings.Repeat(para+"\n\n", 4)
	id, err := e.Open("novel.txt", text, dir("zh-en"), nil, 2048, 0)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan DocDone, 1)
	if err := e.Run(id, func(p DocProgress) { progress = append(progress, p) },
		func(r DocDone) { done <- r }); err != nil {
		t.Fatal(err)
	}
	waitDocDone(t, e, id)
	r := <-done

	snap, _ := e.Get(id)
	if len(snap.Chunks) < 2 {
		t.Fatalf("应切成多块，got %d", len(snap.Chunks))
	}
	for i, c := range snap.Chunks {
		if c.State != "done" || !strings.HasPrefix(c.Translated, "译:") {
			t.Fatalf("块 %d 状态/译文异常: %s %q", i+1, c.State, c.Translated)
		}
	}
	if r.Error != "" || r.Canceled {
		t.Fatalf("完成事件异常: %+v", r)
	}
	if len(progress) == 0 || progress[len(progress)-1].CharsDone != snap.CharsTotal {
		t.Fatalf("进度终值 %v ≠ 总字符 %d", progress[len(progress)-1].CharsDone, snap.CharsTotal)
	}
	for i := 1; i < len(progress); i++ {
		if progress[i].CharsDone < progress[i-1].CharsDone {
			t.Fatal("进度出现倒退")
		}
	}
	out, err := e.ExportText(id, ExportTranslation)
	if err != nil || !strings.Contains(out, "译:") {
		t.Fatalf("导出异常: %v", err)
	}
	if _, err := e.ExportText(id, ExportBilingual); err != nil {
		t.Fatalf("双语导出异常: %v", err)
	}
}

// 术语注入：prompt 含第 4 条规则与逐条 term→translation，锚点在注入块之后；
// 覆盖率按 canonical 译名命中统计。
func TestPipelineGlossaryPromptAndCoverage(t *testing.T) {
	var gotPrompt string
	e := NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) {
		gotPrompt = prompt
		return "The Queen went to Green Rock Pass.", nil
	})
	id, err := e.Open("a.txt", "王妃第二次到青岩关时，河水刚退。", dir("zh-en"),
		[]translator.GlossaryItem{
			{Term: "王妃", Translation: "Queen"},
			{Term: "青岩关", Translation: "Green Rock Pass"},
		},
		2048, 0)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan DocDone, 1)
	if err := e.Run(id, nil, func(r DocDone) { done <- r }); err != nil {
		t.Fatal(err)
	}
	waitDocDone(t, e, id)
	r := <-done

	if !strings.Contains(gotPrompt, "4. 固定译名（下列词条必须逐字使用，不得改写、不得另行音译或意译）：") {
		t.Fatalf("prompt 缺注入规则头：%s", gotPrompt)
	}
	if !strings.Contains(gotPrompt, "   王妃→Queen") || !strings.Contains(gotPrompt, "   青岩关→Green Rock Pass") {
		t.Fatalf("prompt 缺词条行：%s", gotPrompt)
	}
	ruleIdx := strings.Index(gotPrompt, "4. 固定译名")
	anchorIdx := strings.Index(gotPrompt, "只输出译文，不要有任何额外说明。")
	if anchorIdx < 0 || ruleIdx < 0 || anchorIdx < ruleIdx {
		t.Fatal("注入块必须在收尾句之前")
	}
	if len(r.Coverage) != 2 {
		t.Fatalf("覆盖率应有 2 条，got %+v", r.Coverage)
	}
	for _, c := range r.Coverage {
		if c.SourceChunks != 1 || c.HitChunks != 1 {
			t.Fatalf("覆盖率统计异常: %+v", c)
		}
	}
}

// 取消：done 保留、在途/未完成块回 pending；Resume 后全部完成。
func TestPipelineCancelAndResume(t *testing.T) {
	release := make(chan struct{})
	e := NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) {
		<-release // 每块都挂住，等待测试放行
		return "译", nil
	})
	text := strings.Repeat(strings.Repeat("字", 300)+"。\n\n", 4) // 4 块 @ceiling 540
	id, err := e.Open("a.txt", text, dir("zh-en"), nil, 2048, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Run(id, nil, func(DocDone) {}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(150 * time.Millisecond) // 等第一块进入 translating
	e.Cancel(id)
	close(release)
	waitDocDone(t, e, id)

	snap, _ := e.Get(id)
	for i, c := range snap.Chunks {
		if c.State != "done" && c.State != "pending" {
			t.Fatalf("取消后块 %d 状态异常: %s", i+1, c.State)
		}
	}
	if err := e.Run(id, nil, func(DocDone) {}); err != nil {
		t.Fatal(err)
	}
	waitDocDone(t, e, id)
	snap, _ = e.Get(id)
	for i, c := range snap.Chunks {
		if c.State != "done" {
			t.Fatalf("Resume 后块 %d 未完成: %s", i+1, c.State)
		}
	}
}

// 失败块标记 failed；Resume 只重跑 failed/pending，不重复翻 done 块。
func TestPipelineResumeSkipsDone(t *testing.T) {
	attempts := 0
	countContains := map[string]int{}
	e := NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) {
		attempts++
		if strings.Contains(prompt, "字字") {
			countContains["zi"]++
			if attempts <= 3 { // 首块 3 次全失败（首试 + 重试×2）
				return "", context.DeadlineExceeded
			}
		} else {
			countContains["shi"]++
		}
		return "译", nil
	})
	text := strings.Repeat("字", 300) + "。\n\n" + strings.Repeat("石", 300) + "。"
	id, err := e.Open("a.txt", text, dir("zh-en"), nil, 2048, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Run(id, nil, func(DocDone) {}); err != nil {
		t.Fatal(err)
	}
	waitDocDone(t, e, id)

	snap, _ := e.Get(id)
	if snap.Chunks[0].State != "failed" || snap.Chunks[1].State != "done" {
		t.Fatalf("首轮状态异常: %s / %s", snap.Chunks[0].State, snap.Chunks[1].State)
	}
	if err := e.Run(id, nil, func(DocDone) {}); err != nil {
		t.Fatal(err)
	}
	waitDocDone(t, e, id)
	snap, _ = e.Get(id)
	if snap.Chunks[0].State != "done" || snap.Chunks[1].State != "done" {
		t.Fatalf("续跑后未全 done: %s / %s", snap.Chunks[0].State, snap.Chunks[1].State)
	}
	// done 块恰被翻译 1 次；failed 块首轮 3 次 + 续跑 1 次 = 4
	if countContains["shi"] != 1 {
		t.Fatalf("done 块被重复翻译: %d 次", countContains["shi"])
	}
	if countContains["zi"] != 4 {
		t.Fatalf("failed 块调用次数异常: %d（want 4）", countContains["zi"])
	}
}

// 超上限 / 空文本 / 非法方向拒绝（§10 决策 5）。
func TestPipelineOpenRejects(t *testing.T) {
	e := NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) { return "", nil })
	if _, err := e.Open("a.txt", strings.Repeat("字", 101), dir("zh-en"), nil, 2048, 100); err == nil {
		t.Fatal("超上限应拒绝")
	}
	if _, err := e.Open("a.txt", "", dir("zh-en"), nil, 2048, 0); err == nil {
		t.Fatal("空文本应拒绝")
	}
	if _, err := e.Open("a.txt", "字", dir("xx-yy"), nil, 2048, 0); err == nil {
		t.Fatal("非法方向应拒绝")
	}
}
