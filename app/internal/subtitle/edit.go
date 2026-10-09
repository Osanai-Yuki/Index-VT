package subtitle

import (
	"fmt"
	"strings"
)

// ============================================================================
// M4 字幕编辑（01 文档 §5.4 / spec 2026-10-07-m4-subtitle-editing-design.md）
//
// 五操作 + 删除/插入 + 并发守卫。全部返回刷新后的权威快照（GetDoc 同款浅拷贝）。
// 编辑是用户节奏的离散操作，不新增事件——事件流是为队列连续进度设计的，两者不混用。
//
// 并发守卫：queueCancel[docID] 存在时返回错误「队列进行中，先暂停或取消再编辑」。
// 编辑与队列都写 doc.Cues，按用户心智模型一刀切（翻译跑着的时候没人编辑时间轴）。
// ============================================================================

// CuePatch 行内编辑补丁。指针字段 nil = 不动；非 nil = 改为新值。
// 原文被改的 done 条目自动回退 pending（译文已不对应新原文）；仅改时间/样式则保持 done。
type CuePatch struct {
	StartMs    *int64  `json:"startMs,omitempty"`
	EndMs      *int64  `json:"endMs,omitempty"`
	Original   *string `json:"original,omitempty"`
	Translated *string `json:"translated,omitempty"`
	StyleName  *string `json:"styleName,omitempty"`
}

// checkQueueActive 检查文档是否有进行中的翻译队列。
func (e *Engine) checkQueueActive(docID string) error {
	if _, busy := e.queueCancel[docID]; busy {
		return fmt.Errorf("队列进行中，先暂停或取消再编辑（文档 %s）", docID)
	}
	return nil
}

// reindex 重排序号（1 起始连续）。
func reindex(cues []Cue) {
	for i := range cues {
		cues[i].Index = i + 1
	}
}

// splitTextByRatio 按时间占比切分文本，就近落在空白/标点边界。
func splitTextByRatio(text string, ratio float64) (string, string) {
	if text == "" {
		return "", ""
	}
	runes := []rune(text)
	splitIdx := int(float64(len(runes)) * ratio)
	if splitIdx <= 0 {
		return "", text
	}
	if splitIdx >= len(runes) {
		return text, ""
	}
	// 就近找空白/标点边界（前后各扫 20% 长度）
	scanRange := len(runes) / 5
	if scanRange < 1 {
		scanRange = 1
	}
	bestIdx := splitIdx
	bestDist := scanRange + 1
	for i := splitIdx - scanRange; i <= splitIdx+scanRange; i++ {
		if i < 0 || i >= len(runes) {
			continue
		}
		r := runes[i]
		if r == ' ' || r == '\n' || r == '\r' || r == '，' || r == '。' || r == '、' || r == '；' || r == '：' || r == ',' || r == '.' || r == ';' || r == ':' {
			dist := i - splitIdx
			if dist < 0 {
				dist = -dist
			}
			if dist < bestDist {
				bestDist = dist
				bestIdx = i + 1 // 切在标点之后
			}
		}
	}
	part1 := string(runes[:bestIdx])
	part2 := strings.TrimSpace(string(runes[bestIdx:]))
	return part1, part2
}

// UpdateCue 行内编辑：改 index 对应 cue 的任意子集。不改序号。
// 原文被改的 done 条目自动回退 pending（译文已不对应新原文）。
func (e *Engine) UpdateCue(docID string, index int, patch CuePatch) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if index < 1 || index > len(doc.Cues) {
		return nil, fmt.Errorf("序号 %d 越界（共 %d 条）", index, len(doc.Cues))
	}
	c := &doc.Cues[index-1]
	wasDone := c.State == CueDone
	// 时间合法性校验：先算出落点值再决定改不改——不合法整体拒绝，
	// 不做静默钳制（行内编辑的输入应按用户所见生效）。仅当补丁动了时间才校验，
	// 免得源文件里既有畸形条目（如零时长）连纯文本都改不了。
	// 约束：时间不得为负，且止 > 起（否则导出的是非法字幕，时间码渲染也会乱）。
	if patch.StartMs != nil || patch.EndMs != nil {
		newStart, newEnd := c.StartMs, c.EndMs
		if patch.StartMs != nil {
			newStart = *patch.StartMs
		}
		if patch.EndMs != nil {
			newEnd = *patch.EndMs
		}
		if newStart < 0 || newEnd < 0 {
			return nil, fmt.Errorf("时间不得为负（起 %dms / 止 %dms）", newStart, newEnd)
		}
		if newEnd <= newStart {
			return nil, fmt.Errorf("止时间 %dms 必须大于起时间 %dms", newEnd, newStart)
		}
	}
	if patch.StartMs != nil {
		c.StartMs = *patch.StartMs
	}
	if patch.EndMs != nil {
		c.EndMs = *patch.EndMs
	}
	if patch.Original != nil {
		c.Original = *patch.Original
		if wasDone {
			c.State = CuePending
		}
	}
	if patch.Translated != nil {
		c.Translated = *patch.Translated
	}
	if patch.StyleName != nil {
		c.StyleName = *patch.StyleName
	}
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// SplitCue 拆分：atMs ∈ (start, end) 开区间；时间 [start,atMs] / [atMs,end]；
// 原文按时间占比映射到字符位置、就近落在空白/标点边界（无空白则硬切）；译文同规则。
// 新两条继承原样式；后条及之后全部 Index 重排。
func (e *Engine) SplitCue(docID string, index int, atMs int64) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if index < 1 || index > len(doc.Cues) {
		return nil, fmt.Errorf("序号 %d 越界（共 %d 条）", index, len(doc.Cues))
	}
	c := &doc.Cues[index-1]
	if atMs <= c.StartMs || atMs >= c.EndMs {
		return nil, fmt.Errorf("拆分点 %dms 必须在 (%d, %d) 开区间内", atMs, c.StartMs, c.EndMs)
	}
	origEnd := c.EndMs
	ratio := float64(atMs-c.StartMs) / float64(origEnd-c.StartMs)
	origPart1, origPart2 := splitTextByRatio(c.Original, ratio)
	tranPart1, tranPart2 := splitTextByRatio(c.Translated, ratio)

	// 原条目改为前半
	c.EndMs = atMs
	c.Original = origPart1
	c.Translated = tranPart1
	if c.State == CueDone {
		c.State = CuePending
	}

	// 插入后半为新条目
	newCue := Cue{
		StartMs:    atMs,
		EndMs:      origEnd,
		Original:   origPart2,
		Translated: tranPart2,
		StyleName:  c.StyleName,
		State:      CuePending,
	}
	// 在 index 位置后插入
	doc.Cues = append(doc.Cues, Cue{})
	copy(doc.Cues[index:], doc.Cues[index-1:])
	doc.Cues[index] = newCue
	reindex(doc.Cues)
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// MergeCues 合并连续区间 [from..to]（≥2 条，校验连续性）：
// start=首条.start，end=末条.end，原文/译文以空格连接；样式取首条。
// toIndex 之后条目重排。
func (e *Engine) MergeCues(docID string, fromIndex, toIndex int) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if fromIndex < 1 || toIndex > len(doc.Cues) || fromIndex >= toIndex {
		return nil, fmt.Errorf("合并区间 [%d, %d] 非法（共 %d 条，且 from < to）", fromIndex, toIndex, len(doc.Cues))
	}
	// 校验连续性
	for i := fromIndex; i < toIndex; i++ {
		if doc.Cues[i-1].EndMs != doc.Cues[i].StartMs {
			return nil, fmt.Errorf("条目 %d 与 %d 不连续（%dms ≠ %dms），合并要求首尾相接",
				i, i+1, doc.Cues[i-1].EndMs, doc.Cues[i].StartMs)
		}
	}
	first := &doc.Cues[fromIndex-1]
	var origParts, tranParts []string
	for i := fromIndex - 1; i < toIndex; i++ {
		origParts = append(origParts, doc.Cues[i].Original)
		if doc.Cues[i].Translated != "" {
			tranParts = append(tranParts, doc.Cues[i].Translated)
		}
	}
	first.EndMs = doc.Cues[toIndex-1].EndMs
	first.Original = strings.Join(origParts, " ")
	first.Translated = strings.Join(tranParts, " ")
	// 合并后状态：任一条目带 needsCheck 则合并后 needsCheck=true
	for i := fromIndex - 1; i < toIndex; i++ {
		if doc.Cues[i].NeedsCheck {
			first.NeedsCheck = true
		}
	}
	// 删除合并区间内的后续条目
	deleteCount := toIndex - fromIndex
	doc.Cues = append(doc.Cues[:fromIndex], doc.Cues[toIndex:]...)
	_ = deleteCount
	reindex(doc.Cues)
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// ShiftAll 整体平移：全部条目 start/end += delta（可为负，负到 <0 钳到 0 并 needsCheck=true）。不重排。
func (e *Engine) ShiftAll(docID string, deltaMs int64) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	for i := range doc.Cues {
		doc.Cues[i].StartMs += deltaMs
		doc.Cues[i].EndMs += deltaMs
		if doc.Cues[i].StartMs < 0 {
			doc.Cues[i].StartMs = 0
			doc.Cues[i].NeedsCheck = true
		}
		if doc.Cues[i].EndMs < 0 {
			doc.Cues[i].EndMs = 0
			doc.Cues[i].NeedsCheck = true
		}
	}
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// Calibrate 两点校准：线性映射——两锚点条目的 start 分别对齐到 anchor1Ms/anchor2Ms，
// 求 scale = (m2−m1)/(old2−old1) 与 offset，作用于全部条目 start/end。
// 旧两点重合则退化为纯平移。校准后全部条目 needsCheck=false（时间轴已被人工确认）。
func (e *Engine) Calibrate(docID string, anchor1Idx, anchor2Idx int, anchor1Ms, anchor2Ms int64) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if anchor1Idx < 1 || anchor1Idx > len(doc.Cues) || anchor2Idx < 1 || anchor2Idx > len(doc.Cues) {
		return nil, fmt.Errorf("锚点序号越界（共 %d 条）", len(doc.Cues))
	}
	old1 := doc.Cues[anchor1Idx-1].StartMs
	old2 := doc.Cues[anchor2Idx-1].StartMs
	if old1 == old2 {
		// 退化为纯平移
		offset := anchor1Ms - old1
		for i := range doc.Cues {
			doc.Cues[i].StartMs += offset
			doc.Cues[i].EndMs += offset
			if doc.Cues[i].StartMs < 0 {
				doc.Cues[i].StartMs = 0
			}
			if doc.Cues[i].EndMs < 0 {
				doc.Cues[i].EndMs = 0
			}
		}
	} else {
		scale := float64(anchor2Ms-anchor1Ms) / float64(old2-old1)
		offset := anchor1Ms - int64(float64(old1)*scale)
		for i := range doc.Cues {
			doc.Cues[i].StartMs = int64(float64(doc.Cues[i].StartMs)*scale) + offset
			doc.Cues[i].EndMs = int64(float64(doc.Cues[i].EndMs)*scale) + offset
			if doc.Cues[i].StartMs < 0 {
				doc.Cues[i].StartMs = 0
			}
			if doc.Cues[i].EndMs < 0 {
				doc.Cues[i].EndMs = 0
			}
		}
	}
	// 校准后全部条目 needsCheck=false（时间轴已被人工确认）
	for i := range doc.Cues {
		doc.Cues[i].NeedsCheck = false
	}
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// DeleteCues 删除选中条目（indices 为 1 起始序号列表），重排。
func (e *Engine) DeleteCues(docID string, indices []int) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if len(indices) == 0 {
		return e.snapshotLocked(doc), nil
	}
	// 用 set 标记删除
	toBeDeleted := make(map[int]bool)
	for _, idx := range indices {
		if idx < 1 || idx > len(doc.Cues) {
			return nil, fmt.Errorf("删除序号 %d 越界（共 %d 条）", idx, len(doc.Cues))
		}
		toBeDeleted[idx-1] = true
	}
	// 过滤
	filtered := doc.Cues[:0]
	for i := range doc.Cues {
		if !toBeDeleted[i] {
			filtered = append(filtered, doc.Cues[i])
		}
	}
	doc.Cues = filtered
	reindex(doc.Cues)
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// InsertCue 在 afterIndex 后插一条 2s 空白 cue，state=pending。
// afterIndex=0 表示在开头插入。
func (e *Engine) InsertCue(docID string, afterIndex int) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if afterIndex < 0 || afterIndex > len(doc.Cues) {
		return nil, fmt.Errorf("插入位置 %d 越界（共 %d 条）", afterIndex, len(doc.Cues))
	}
	var startMs int64
	if afterIndex == 0 {
		startMs = 0
	} else {
		startMs = doc.Cues[afterIndex-1].EndMs
	}
	newCue := Cue{
		StartMs: startMs,
		EndMs:   startMs + 2000,
		State:   CuePending,
	}
	// 在 afterIndex 位置后插入
	doc.Cues = append(doc.Cues, Cue{})
	copy(doc.Cues[afterIndex+1:], doc.Cues[afterIndex:])
	doc.Cues[afterIndex] = newCue
	reindex(doc.Cues)
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// Styles 返回文档的样式库列表（结构化字段）。
func (e *Engine) Styles(docID string) ([]StyleDef, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	out := make([]StyleDef, len(doc.Styles))
	copy(out, doc.Styles)
	return out, nil
}

// SetStyle 按 Name upsert 样式：存在则改，不存在则追加。
// 结构化字段经 buildStyleLine 重建 Raw；SRT/VTT/LRC 无样式概念时
// 仅记录 styleName（导出为 ASS 才落成真实样式行，M4 §2 格式边界）。
func (e *Engine) SetStyle(docID string, style StyleDef) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	if style.Name == "" {
		return nil, fmt.Errorf("样式名不能为空")
	}
	style.Raw = buildStyleLine(style)
	found := false
	for i := range doc.Styles {
		if doc.Styles[i].Name == style.Name {
			doc.Styles[i] = style
			found = true
			break
		}
	}
	if !found {
		doc.Styles = append(doc.Styles, style)
	}
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}

// AssignStyle 按行指派样式（indices 为 1 起始序号列表）。
func (e *Engine) AssignStyle(docID string, indices []int, styleName string) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[docID]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", docID)
	}
	if err := e.checkQueueActive(docID); err != nil {
		return nil, err
	}
	for _, idx := range indices {
		if idx < 1 || idx > len(doc.Cues) {
			return nil, fmt.Errorf("指派序号 %d 越界（共 %d 条）", idx, len(doc.Cues))
		}
		doc.Cues[idx-1].StyleName = styleName
	}
	e.touchLocked(docID)
	return e.snapshotLocked(doc), nil
}
