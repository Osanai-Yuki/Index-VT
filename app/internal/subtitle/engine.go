// Package subtitle 字幕引擎 P0（01 文档 §5.4 / ADR-007）：
// SRT/ASS/VTT 解析导出基于 go-astisub，LRC 自研；翻译走文本队列；
// ASS 头部/样式以自捕获元数据层保证 roundtrip 保真（ADR-007 出口条件）。
package subtitle

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// MaxSubtitleBytes 字幕文件大小上限（B29）：32MB 远超任何真实字幕文件，
// 用于拒绝误选的整本小说或二进制文件 —— 旧实现 os.ReadFile 会直接吃满内存。
const MaxSubtitleBytes = 32 << 20

// maxRetainedDocs 同时保留的文档数上限（B29）：文档元数据本身很小，但每篇都持有
// 全部 cue；8 篇覆盖「一份正在打开 + 近期反复打开过的几份」的常见用法，
// 同时保证长会话中 docs map 不会无界增长。
const maxRetainedDocs = 8

// Format 字幕格式。
type Format string

const (
	FormatSRT Format = "srt"
	FormatASS Format = "ass"
	FormatVTT Format = "vtt"
	FormatLRC Format = "lrc"
)

// CueState cue 翻译状态。
type CueState string

const (
	CuePending     CueState = "pending"
	CueTranslating CueState = "translating"
	CueDone        CueState = "done"
	CueFailed      CueState = "failed"
	CueSkipped     CueState = "skipped"
)

// Cue 字幕条目（01 文档 §5.4 数据模型）。
type Cue struct {
	Index      int      `json:"index"` // 1 起始
	StartMs    int64    `json:"startMs"`
	EndMs      int64    `json:"endMs"`
	Original   string   `json:"original"`   // 原文（含 ASS 覆写标签）
	Translated string   `json:"translated"` // 译文（含回填标签）
	StyleName  string   `json:"styleName,omitempty"`
	State      CueState `json:"state"`
	OffTarget  bool     `json:"offTarget,omitempty"`
	NeedsCheck bool     `json:"needsCheck,omitempty"` // 覆写标签回填失败
}

// StyleDef ASS 样式定义（结构化字段 + 原始行保真）。
// 结构化字段供前端编辑；Raw 保留完整 Style: 行用于序列化回写
// （未映射字段如 BorderStyle/Shadow/ScaleX 等逐字保留，M4 §2）。
// Raw 标记 json:"-"：不暴露前端，前端只编辑结构化字段，
// SetStyle 由引擎从结构化字段重建 Raw。
type StyleDef struct {
	Name       string  `json:"name"`
	FontName   string  `json:"fontName"`
	FontSize   int     `json:"fontSize"`
	PrimaryRGB string  `json:"primaryRGB"` // #RRGGBB（ASS &HAABBGGRR 转换）
	OutlineRGB string  `json:"outlineRGB"` // #RRGGBB
	Outline    float64 `json:"outline"`   // 描边宽度
	Bold       bool    `json:"bold"`
	Alignment  int     `json:"alignment"` // ASS numpad 1-9（底部居中=2）
	MarginV    int     `json:"marginV"`
	Raw        string  `json:"-"` // 完整 Style: 行（序列化回写用）
}

// SubtitleDoc 打开的字幕文档。
type SubtitleDoc struct {
	ID          string     `json:"id"`
	Path        string     `json:"path"`
	Format      Format     `json:"format"`
	Encoding    string     `json:"encoding"`
	Cues        []Cue      `json:"cues"`
	Styles      []StyleDef `json:"styles,omitempty"`
	HeaderLines []string   `json:"-"` // ASS [Script Info] 原始行（roundtrip 保真）
	EventsLines []string   `json:"-"` // ASS [Events] Format 行（保真）
	// ASS 样式段头与 Format 行原文（[V4 Styles] / [V4+ Styles]，字段数保真，B26）。
	// 与 HeaderLines/EventsLines 一样在 Open 后不再被改写，快照浅拷贝安全；
	// 序列化侧只读，不得就地修改（1.17 快照与并发读共享）。
	StylesSection string `json:"-"`
	StylesFormat  string `json:"-"`
	// QueueActive 该文档是否有进行中的翻译队列。不入库；只在 GetDoc 快照时按
	// queueCancel 表计算——前端据此禁用暂停/继续/取消，而不是点了才弹「无进行中队列」。
	QueueActive bool `json:"queueActive,omitempty"`
}

// BilingualMode 双语模式（01 文档 §5.4 三模式）。
type BilingualMode string

const (
	BilingualTranslationOnly BilingualMode = "translation-only" // 仅译文
	BilingualDualLine        BilingualMode = "dual-line"        // 原文上/译文下
	BilingualKeepOriginal    BilingualMode = "keep-original"    // 译文 + 原文另存
)

// ExportOptions 导出选项。
type ExportOptions struct {
	Format    Format        `json:"format"`
	Encoding  string        `json:"encoding"` // utf-8（默认无 BOM）| gbk
	Bilingual BilingualMode `json:"bilingual"`
	OutPath   string        `json:"outPath"`
}

// QueueOptions 队列选项。
type QueueOptions struct {
	TargetLang  string        `json:"targetLang"`
	GlossaryID  int64         `json:"glossaryId,omitempty"` // M3 启用术语
	Bilingual   BilingualMode `json:"bilingual"`
	// Full 整卷重翻：done/failed 一并重跑——目标语言选错后「全部翻译」必须覆盖全片，
	// 否则已翻条目保留旧语言译文。仅 SubTranslate 入口传真；RetryFailed/RetryCues
	// 内部强制清零（重试语义只覆盖各自目标集）。
	Full bool `json:"full,omitempty"`
}

// CueProgress 队列进度事件（100ms 合并后推送）。
type CueProgress struct {
	DocID      string   `json:"docId"`
	CueIndex   int      `json:"cueIndex"`
	State      CueState `json:"state"`
	Done       int      `json:"done"`
	Total      int      `json:"total"`
	OffTarget  bool     `json:"offTarget,omitempty"`
	NeedsCheck bool     `json:"needsCheck,omitempty"`
	// Translated 是终态事件的译文文本（B1）。前端「译文」列的唯一实时来源；
	// 缺失时批量翻译的结果在界面上永远不可见 —— 这正是重构前的实际症状。
	Translated string `json:"translated,omitempty"`
}

// TranslateCueFn 单条翻译函数（app 层桥接 translator，队列与模型解耦）。
type TranslateCueFn func(ctx context.Context, text, sourceLang, targetLang string) (string, error)

// Engine 字幕引擎。
type Engine struct {
	mu       sync.Mutex
	docs     map[string]*SubtitleDoc
	seq      int
	translate TranslateCueFn
	queueCancel map[string]*queueCtl
	order    []string // LRU 最近使用顺序（末尾最新），仅由 touchLocked 在持 e.mu 时维护
}

// NewEngine 创建引擎。translateCue 为单条翻译桥接（可 nil，测试时注入假实现）。
func NewEngine(translateCue TranslateCueFn) *Engine {
	return &Engine{
		docs:        make(map[string]*SubtitleDoc),
		translate:   translateCue,
		queueCancel: make(map[string]*queueCtl),
	}
}

// ---------- Open ----------

// Open 自动识别格式+编码（UTF-8 含/不含 BOM / GBK），解析为文档。
// 先量大小再读：超过 MaxSubtitleBytes 的直接拒绝，避免误选小说/二进制吃满内存（B29）。
func (e *Engine) Open(path string) (*SubtitleDoc, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxSubtitleBytes {
		return nil, fmt.Errorf("文件过大（%d 字节，上限 %d 字节），请确认选的是字幕文件", st.Size(), int64(MaxSubtitleBytes))
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	text, enc := DecodeText(raw)
	format := detectFormat(path, text)
	if format == "" {
		return nil, fmt.Errorf("无法识别字幕格式: %s", filepath.Base(path))
	}
	var cues []Cue
	var styles []StyleDef
	var headerLines, eventsFormat []string
	var stylesSection, stylesFormat string
	switch format {
	case FormatSRT:
		cues, err = parseSRT(text)
	case FormatVTT:
		cues, err = parseVTT(text)
	case FormatLRC:
		cues, err = parseLRC(text)
	case FormatASS:
		cues, styles, headerLines, eventsFormat, stylesSection, stylesFormat, err = parseASS(text)
	}
	if err != nil {
		return nil, fmt.Errorf("解析 %s 失败: %w", format, err)
	}
	for i := range cues {
		cues[i].Index = i + 1
		cues[i].State = CuePending
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.seq++
	doc := &SubtitleDoc{
		ID:            fmt.Sprintf("sub-%d", e.seq),
		Path:          path,
		Format:        format,
		Encoding:      enc,
		Cues:          cues,
		Styles:        styles,
		HeaderLines:   headerLines,
		EventsLines:   eventsFormat,
		StylesSection: stylesSection,
		StylesFormat:  stylesFormat,
	}
	e.docs[doc.ID] = doc
	e.touchLocked(doc.ID)
	return doc, nil
}

// GetDoc 取文档快照（app 层读 cue 列表用）。
// 返回隔离副本：调用方改写返回值既不影响引擎状态，也不与翻译队列的写入竞争。
func (e *Engine) GetDoc(id string) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	d, ok := e.docs[id]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", id)
	}
	e.touchLocked(id)
	out := e.snapshotLocked(d)
	_, out.QueueActive = e.queueCancel[id]
	return out, nil
}

// snapshotLocked 在持有 e.mu 时返回与后续队列写入隔离的文档副本。
// Cue 的字段全是值类型/不可变 string，拷贝切片即足够；Styles/HeaderLines 同样浅拷贝安全
// （它们在 Open 后不再被改写）。序列化在解锁后进行，慢但不会阻塞队列。
func (e *Engine) snapshotLocked(doc *SubtitleDoc) *SubtitleDoc {
	cues := make([]Cue, len(doc.Cues))
	copy(cues, doc.Cues)
	out := *doc
	out.Cues = cues
	if len(doc.Styles) > 0 {
		out.Styles = append([]StyleDef(nil), doc.Styles...)
	}
	return &out
}

// touchLocked 维护最近使用顺序并在超限时淘汰最旧文档；调用方须持 e.mu。
// 不淘汰就意味着长时间使用时内存单调增长（B29）。
func (e *Engine) touchLocked(id string) {
	for i, s := range e.order {
		if s == id {
			e.order = append(e.order[:i], e.order[i+1:]...)
			break
		}
	}
	e.order = append(e.order, id)
	for len(e.order) > maxRetainedDocs {
		oldest := e.order[0]
		e.order = e.order[1:]
		if ctl, busy := e.queueCancel[oldest]; busy {
			ctl.cancel() // 淘汰对象仍在跑队列：先取消再删除，不得把文档从活 goroutine 底下抽走
		}
		delete(e.docs, oldest)
	}
}

// detectFormat 扩展名优先，内容嗅探兜底。
func detectFormat(path, text string) Format {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".srt":
		return FormatSRT
	case ".ass", ".ssa":
		return FormatASS
	case ".vtt":
		return FormatVTT
	case ".lrc":
		return FormatLRC
	}
	head := text[:min(len(text), 2048)]
	switch {
	case strings.Contains(head, "[Script Info]"), strings.Contains(head, "[V4+ Styles]"), strings.Contains(head, "[V4 Styles]"):
		return FormatASS
	case strings.HasPrefix(head, "WEBVTT"):
		return FormatVTT
	case strings.Contains(head, " --> "):
		return FormatSRT
	case lrcLineRe.MatchString(head):
		return FormatLRC
	}
	return ""
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// ---------- Export ----------

// Export 导出（格式+编码+双语模式；UTF-8 默认无 BOM，02 文档 §11.6）。
func (e *Engine) Export(docID string, opt ExportOptions) error {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	snap := e.snapshotLocked(doc)
	e.mu.Unlock()
	data, err := e.serialize(snap, opt)
	if err != nil {
		return err
	}
	if opt.Encoding == "gbk" {
		data, err = encodeGBK(data)
		if err != nil {
			return fmt.Errorf("GBK 编码失败（特数字符可能丢失）: %w", err)
		}
	}
	if opt.OutPath == "" {
		return fmt.Errorf("未指定输出路径")
	}
	return os.WriteFile(opt.OutPath, data, 0o644)
}

// serializeBytes 内存导出（测试用）。
func (e *Engine) serialize(doc *SubtitleDoc, opt ExportOptions) ([]byte, error) {
	switch opt.Format {
	case FormatLRC:
		return e.serializeLRC(doc, opt)
	case FormatSRT, FormatVTT, FormatASS:
		return e.serializeAstisub(doc, opt)
	case "":
		return e.serializeAstisub(doc, opt)
	default:
		return nil, fmt.Errorf("不支持的导出格式 %s", opt.Format)
	}
}

// ExportToBytes 内存导出（供预览/测试）。
func (e *Engine) ExportToBytes(docID string, opt ExportOptions) ([]byte, error) {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	snap := e.snapshotLocked(doc)
	e.mu.Unlock()
	return e.serialize(snap, opt)
}

// ExportOriginal 导出原文内容（keep-original 模式"原文另存"，LRC 为 .lrc.orig 约定）。
func (e *Engine) ExportOriginal(docID string, opt ExportOptions) error {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	snap := e.snapshotLocked(doc)
	e.mu.Unlock()
	data, err := e.serialize(snap, ExportOptions{
		Format:    opt.Format,
		Encoding:  opt.Encoding,
		Bilingual: BilingualTranslationOnly,
	})
	if err != nil {
		return err
	}
	// keep-original 的原文文件：内容应为原文而非译文
	data, err = e.serializeWithText(snap, opt.Format, true)
	if err != nil {
		return err
	}
	if opt.Encoding == "gbk" {
		data, err = encodeGBK(data)
		if err != nil {
			return err
		}
	}
	return os.WriteFile(opt.OutPath, data, 0o644)
}

// serializeWithText 指定使用原文/译文的序列化。
func (e *Engine) serializeWithText(doc *SubtitleDoc, format Format, useOriginal bool) ([]byte, error) {
	cues := append([]Cue(nil), doc.Cues...)
	sortCues(cues)
	switch format {
	case FormatLRC:
		var b strings.Builder
		b.WriteString("[re:Index-VT]\n")
		for _, c := range cues {
			text := c.Translated
			if useOriginal || text == "" {
				text = c.Original
			}
			b.WriteString(fmt.Sprintf("[%s]%s\n", lrcTime(c.StartMs), text))
		}
		return []byte(b.String()), nil
	default:
		return e.serializeAstisubWithText(doc, format, useOriginal)
	}
}

// sortCues 按 Index 排序（内部工具）。
func sortCues(cues []Cue) {
	sort.Slice(cues, func(i, j int) bool { return cues[i].Index < cues[j].Index })
}
