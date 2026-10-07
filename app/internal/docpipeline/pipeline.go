// pipeline.go —— 长文档管线主体（M5 报告 §9 步 3）。
//
// 结构与字幕队列同构（§10 决策 3）：块级状态机 pending/translating/done/failed、
// 取消保留已产出、同会话内可续跑。差异点：单 worker 逐块调用、prompt 由管线层按
// 官方方向模板+术语注入组装（BuildNailongPromptWithGlossary）、max_tokens 每块按
// translator.MaxTokensForBudget 计算（§11 对齐约定的执行点）。
package docpipeline

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"indexvt/internal/translator"
)

// chunkState 单块状态（与字幕 cue 同构）。
type ChunkState struct {
	Index      int    `json:"index"` // 1 起始
	Text       string `json:"text"`
	Translated string `json:"translated,omitempty"`
	State      string `json:"state"` // pending / translating / done / failed
}

// Doc 长文档翻译任务（Get 快照返回给前端）。
type Doc struct {
	ID          string                      `json:"id"`
	Path        string                      `json:"path"`
	Direction   translator.NailongDirection `json:"direction"`
	Glossary    []translator.GlossaryItem   `json:"glossary,omitempty"`
	CtxTokens   int                         `json:"-"`
	Chunks      []ChunkState                `json:"chunks"`
	CharsTotal  int                         `json:"charsTotal"`
	Coverage    []TermCoverage              `json:"coverage,omitempty"`    // 完成时填充
	QueueActive bool                        `json:"queueActive,omitempty"` // 同 SubGetDoc 语义
}

// TermCoverage 覆盖率度量（§10 决策 2）：按批准名字表逐条比对——
// SourceChunks = 原文含该术语的块数；HitChunks = 其中译文按 canonical 译名命中的块数。
// 竞争形式的模糊归一 v1 不做，未命中清单由人工看（度量先闭环，精度 v2 迭代）。
type TermCoverage struct {
	Term         string `json:"term"`
	Translation  string `json:"translation"`
	SourceChunks int    `json:"sourceChunks"`
	HitChunks    int    `json:"hitChunks"`
}

// DocDone 完成事件载荷（app 层转 doc:done Wails 事件）。
type DocDone struct {
	DocID    string         `json:"docId"`
	Error    string         `json:"error,omitempty"`
	Canceled bool           `json:"canceled,omitempty"`
	Coverage []TermCoverage `json:"coverage,omitempty"`
}

// TranslateFunc 单块翻译：prompt 已含方向模板与术语注入；maxTokens 为该块预算。
type TranslateFunc func(ctx context.Context, prompt string, maxTokens int) (string, error)

// ETA 常数（§10 决策 4，标定自 §7.7 实测）。
const (
	// etaPrefillMsPerToken prefill 每毫秒单价：8192 tok→2.61s=0.319ms/tok、
	// 29561 tok→11.13s=0.376ms/tok，取中值。每块都要付一次，是长任务 ETA 的一阶项。
	etaPrefillMsPerToken = 0.35
	// etaDecodeTokPerSec decode 速率取 32K 档实测 75 tok/s（8K 档 84，取保守低值）。
	etaDecodeTokPerSec = 75.0
)

// Engine 长文档管线。文件读取/编码识别在 app 层（复用 subtitle.DecodeText），
// 本引擎只吃纯文本——fs 无关，测试免夹具。
type Engine struct {
	mu        sync.Mutex
	docs      map[string]*Doc
	cancel    map[string]context.CancelFunc
	seq       int
	translate TranslateFunc
}

func NewEngine(translate TranslateFunc) *Engine {
	return &Engine{
		docs:      map[string]*Doc{},
		cancel:    map[string]context.CancelFunc{},
		translate: translate,
	}
}

// Open 解析文本并建块（不启动翻译）。空文本 / 超上限 / 方向非法即拒绝。
// maxChars=0 表示不设上限（测试用）；生产入口传 50000（§10 决策 5）。
func (e *Engine) Open(path, text string, dir translator.NailongDirection, glossary []translator.GlossaryItem, ctxTokens, maxChars int) (string, error) {
	if !dir.Valid() {
		return "", fmt.Errorf("未知翻译方向 %s", dir)
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("文档内容为空")
	}
	runes := len([]rune(text))
	if maxChars > 0 && runes > maxChars {
		return "", fmt.Errorf("文档 %d 字超出当前上限 %d 字（10 万字级支持在路线图外，见 M5 报告 §10 决策 5）", runes, maxChars)
	}
	if e.translate == nil {
		return "", fmt.Errorf("翻译服务不可用")
	}
	chunks := ChunkText(text, ctxTokens)
	if len(chunks) == 0 {
		return "", fmt.Errorf("文档内容为空")
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	e.seq++
	id := fmt.Sprintf("doc-%d", e.seq)
	states := make([]ChunkState, len(chunks))
	total := 0
	for i, c := range chunks {
		states[i] = ChunkState{Index: i + 1, Text: c.Text, State: "pending"}
		total += len([]rune(c.Text))
	}
	e.docs[id] = &Doc{
		ID: id, Path: path, Direction: dir, Glossary: glossary,
		CtxTokens: ctxTokens, Chunks: states, CharsTotal: total,
	}
	return id, nil
}

// Run 启动/续跑：只翻译 pending/failed 块，done 保留（§10 决策 3 的取消续跑语义）。
// onProgress 在每块终态与启动时回调；onDone 恰好回调一次（含取消/出错）。
func (e *Engine) Run(docID string, onProgress func(DocProgress), onDone func(DocDone)) error {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	if _, busy := e.cancel[docID]; busy {
		e.mu.Unlock()
		return fmt.Errorf("该文档队列已在进行中")
	}
	var targets []int
	for i := range doc.Chunks {
		if doc.Chunks[i].State == "pending" || doc.Chunks[i].State == "failed" {
			targets = append(targets, i)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel[docID] = cancel
	e.mu.Unlock()

	go func() {
		defer func() {
			cancel()
			e.mu.Lock()
			delete(e.cancel, docID)
			e.mu.Unlock()
		}()
		errMsg := ""
		canceled := false
		for _, idx := range targets {
			if ctx.Err() != nil {
				canceled = true
				break
			}
			e.mu.Lock()
			ch := &doc.Chunks[idx]
			ch.State = "translating"
			charsDone := e.charsDoneLocked(doc)
			e.mu.Unlock()
			emitProgress(onProgress, doc, charsDone, idx, "translating")

			translated, err := e.translateChunk(ctx, doc, ch.Text)
			e.mu.Lock()
			ch = &doc.Chunks[idx]
			switch {
			case ctx.Err() != nil:
				ch.State = "pending" // 取消保留可续跑（§10 决策 3）
				canceled = true
			case err != nil:
				ch.State = "failed"
				if errMsg == "" {
					errMsg = err.Error() // 记首个错误；其余失败块继续跑完（与字幕一致）
				}
			default:
				ch.Translated = translated
				ch.State = "done"
			}
			charsDone = e.charsDoneLocked(doc)
			e.mu.Unlock()
			emitProgress(onProgress, doc, charsDone, idx, ch.State)
			if canceled {
				break
			}
		}
		e.mu.Lock()
		coverage := e.coverageLocked(doc)
		doc.Coverage = coverage
		e.mu.Unlock()
		if onDone != nil {
			onDone(DocDone{DocID: docID, Error: errMsg, Canceled: canceled, Coverage: coverage})
		}
	}()
	return nil
}

// translateChunk 组装方向模板 + 术语注入 prompt 并调用注入的翻译通道。
// 重试 ≤2 次（与字幕逐条一致）；块级失败不终止整卷。
func (e *Engine) translateChunk(ctx context.Context, doc *Doc, text string) (string, error) {
	prompt, err := translator.BuildNailongPromptWithGlossary(doc.Direction, text, doc.Glossary)
	if err != nil {
		return "", err
	}
	maxTok := translator.MaxTokensForBudget(text, doc.CtxTokens)
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-ctxDoneOrTimeout(ctx, retryBackoff):
			}
		}
		out, err := e.translate(ctx, prompt, maxTok)
		if err == nil {
			return strings.TrimSpace(out), nil
		}
		lastErr = err
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
	}
	return "", lastErr
}

const retryBackoff = 300 * time.Millisecond

func ctxDoneOrTimeout(ctx context.Context, d time.Duration) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		defer close(ch)
		select {
		case <-ctx.Done():
		case <-time.After(d):
		}
	}()
	return ch
}

// Cancel 取消进行中的整卷任务；已产出块保留，未完成块回到 pending 可续跑。
func (e *Engine) Cancel(docID string) {
	e.mu.Lock()
	cancel, ok := e.cancel[docID]
	e.mu.Unlock()
	if ok {
		cancel()
	}
}

// CancelAll 退出编排前清场（app.shutdown 调用，语义对齐 subtitle.CancelAllQueues）。
func (e *Engine) CancelAll() {
	e.mu.Lock()
	all := make([]context.CancelFunc, 0, len(e.cancel))
	for _, c := range e.cancel {
		all = append(all, c)
	}
	e.mu.Unlock()
	for _, c := range all {
		c()
	}
}

// Get 权威快照（前端轮询/事件丢包兜底，同 SubGetDoc 语义）。
func (e *Engine) Get(docID string) (*Doc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	out := *d
	out.Chunks = make([]ChunkState, len(d.Chunks))
	copy(out.Chunks, d.Chunks)
	_, out.QueueActive = e.cancel[docID]
	return &out, nil
}

// ExportText 组装导出文本。translation = 各块译文以空行连接；
// bilingual = 逐块「原文 / 空行 / 译文」并带块分隔线（对照的单位是块，§10 设计）。
func (e *Engine) ExportText(docID string, kind ExportKind) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.docs[docID]
	if !ok {
		return "", fmt.Errorf("文档 %s 不存在", docID)
	}
	var b strings.Builder
	switch kind {
	case ExportTranslation:
		for i := range d.Chunks {
			if d.Chunks[i].State != "done" {
				return "", fmt.Errorf("块 %d 未完成（%s），导出前需整卷翻译完成", d.Chunks[i].Index, d.Chunks[i].State)
			}
			if i > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(d.Chunks[i].Translated)
		}
	case ExportBilingual:
		for i := range d.Chunks {
			ch := &d.Chunks[i]
			if ch.State != "done" {
				return "", fmt.Errorf("块 %d 未完成（%s），导出前需整卷翻译完成", ch.Index, ch.State)
			}
			if i > 0 {
				b.WriteString("\n\n――――――――――\n\n")
			}
			b.WriteString(ch.Text)
			b.WriteString("\n\n")
			b.WriteString(ch.Translated)
		}
	default:
		return "", fmt.Errorf("未知导出类型 %s", kind)
	}
	return b.String(), nil
}

// charsDoneLocked 已完成字符数（done 块的原文 rune 数累计）。调用方持 e.mu。
func (e *Engine) charsDoneLocked(d *Doc) int {
	n := 0
	for i := range d.Chunks {
		if d.Chunks[i].State == "done" {
			n += len([]rune(d.Chunks[i].Text))
		}
	}
	return n
}

// coverageLocked 覆盖率统计（§10 决策 2）。调用方持 e.mu。
func (e *Engine) coverageLocked(d *Doc) []TermCoverage {
	if len(d.Glossary) == 0 {
		return nil
	}
	out := make([]TermCoverage, 0, len(d.Glossary))
	for _, it := range d.Glossary {
		term := strings.TrimSpace(it.Term)
		tr := strings.TrimSpace(it.Translation)
		if term == "" || tr == "" {
			continue
		}
		cov := TermCoverage{Term: term, Translation: tr}
		for i := range d.Chunks {
			if !strings.Contains(d.Chunks[i].Text, term) {
				continue
			}
			cov.SourceChunks++
			if strings.Contains(d.Chunks[i].Translated, tr) {
				cov.HitChunks++
			}
		}
		if cov.SourceChunks > 0 {
			out = append(out, cov)
		}
	}
	return out
}

// emitProgress 组装冻结的 DocProgress 载荷（charsDone/charsTotal + ETA + 块级标注）。
func emitProgress(onProgress func(DocProgress), doc *Doc, charsDone, chunkIndex int, state string) {
	if onProgress == nil {
		return
	}
	onProgress(DocProgress{
		DocID:      doc.ID,
		CharsDone:  charsDone,
		CharsTotal: doc.CharsTotal,
		ETASeconds: estimateETA(doc.CharsTotal-charsDone, doc.CtxTokens),
		ChunkIndex: chunkIndex,
		State:      state,
	})
}

// estimateETA 剩余时间估算（§10 决策 4）：每块 = prefill 固定开销 + 输出 decode。
// 漏掉 prefill 会在前期严重高估剩余时间（§8.3 / §7.7）。
func estimateETA(remainChars, ctxTokens int) int {
	if remainChars <= 0 {
		return 0
	}
	block := MaxChunkRunes(ctxTokens)
	blocks := (remainChars + block - 1) / block
	total := 0.0
	for i := 0; i < blocks; i++ {
		blockChars := block
		if remain := remainChars - i*block; remain < blockChars {
			blockChars = remain
		}
		total += float64(blockChars) * chunkPromptSlope * etaPrefillMsPerToken / 1000.0
		total += ChunkOutputPerChar * float64(blockChars) / etaDecodeTokPerSec
	}
	return int(total)
}
