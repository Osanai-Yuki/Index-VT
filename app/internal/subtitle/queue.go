package subtitle

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ============================================================================
// 翻译队列（02 文档 §11.4）：单 worker 逐条非流式，失败独立重试 ≤2，
// 事件 100ms 合并推送；可暂停/取消；"重试失败"只取 failed 子集。
// ============================================================================

type queueCtl struct {
	cancel   context.CancelFunc
	isPaused bool // e.mu 保护；暂停不打断当前条，停止推进下一条
	resume   chan struct{}
}

// TranslateQueue 启动逐条翻译队列。
func (e *Engine) TranslateQueue(docID string, opt QueueOptions, onProgress func(CueProgress)) error {
	return e.translateQueue(docID, opt, onProgress, nil)
}

func (e *Engine) translateQueue(docID string, opt QueueOptions, onProgress func(CueProgress), prepare func(*SubtitleDoc) error) error {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	if _, busy := e.queueCancel[docID]; busy {
		e.mu.Unlock()
		return fmt.Errorf("该文档队列已在进行中")
	}
	if e.translate == nil {
		e.mu.Unlock()
		return fmt.Errorf("翻译服务不可用")
	}
	if prepare != nil {
		if err := prepare(doc); err != nil {
			e.mu.Unlock()
			return err
		}
	}
	// Full（整卷重翻，来自「全部翻译」按钮）：done/failed 一并重置为 pending——
	// 目标语言选错后重翻必须覆盖已翻过的条目，否则同一文档混着两轮语言的译文。
	// skipped 保留不动：空行跳过与语言无关。重试路径（RetryFailed/RetryCues）
	// 防御性清掉 Full，它们只重跑自己的目标集。
	if opt.Full {
		for i := range doc.Cues {
			if doc.Cues[i].State == CueDone || doc.Cues[i].State == CueFailed {
				doc.Cues[i].State = CuePending
			}
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	ctx = context.WithValue(ctx, glossaryContextKey{}, append([]GlossaryTerm(nil), opt.Terms...))
	ctl := &queueCtl{
		cancel: cancel,
		resume: make(chan struct{}, 1),
	}
	e.queueCancel[docID] = ctl
	doc.Revision++
	delete(e.undo, docID)
	delete(e.redo, docID)
	delete(e.editBefore, docID)
	// 只取 pending/failed（重试场景只重跑 failed 由 RetryCue 保证）
	var targets []int
	for i := range doc.Cues {
		c := &doc.Cues[i]
		if (c.State == CuePending || c.State == CueFailed) && (opt.targets == nil || opt.targets[c.Index]) {
			targets = append(targets, i)
			c.State = CuePending
		}
	}
	e.mu.Unlock()

	go func() {
		defer func() {
			cancel() // B6：正常结束也必须释放，否则每跑一次队列泄漏一个 ctx
			e.mu.Lock()
			for _, index := range targets {
				if doc.Cues[index].State == CueTranslating {
					doc.Cues[index].State = CuePending
					doc.Revision++
				}
			}
			delete(e.queueCancel, docID)
			e.mu.Unlock()
		}()
		total := len(targets)
		done := 0
		var lastEmit time.Time
		var pending *CueProgress
		// flushPending 冲出挂起的非终态事件（至多一条）。done/total 取调用时刻的值，
		// 而非挂起时刻的快照：事件表达的是「此刻仍在翻译 + 已掌握的最新进度」，
		// 且它们先于同批次的终态事件送出、计数单调不减，不会出现进度倒退。
		flushPending := func() {
			if pending == nil {
				return
			}
			q := *pending
			q.DocID, q.Total, q.Done = docID, total, done
			pending = nil
			onProgress(q)
		}
		emit := func(p CueProgress) {
			e.mu.Lock()
			p.Revision = doc.Revision
			e.mu.Unlock()
			if onProgress == nil {
				return
			}
			// B4：终态立即推（并先冲掉挂起的非终态）；非终态只保留最新一条，
			// 到点合并发出。旧实现整条丢弃 → 行看起来卡在 pending。
			if p.State == CueDone || p.State == CueFailed {
				flushPending()
				p.DocID, p.Total, p.Done = docID, total, done
				lastEmit = time.Now()
				onProgress(p)
				return
			}
			if time.Since(lastEmit) < 100*time.Millisecond {
				cp := p
				pending = &cp
				return
			}
			p.DocID, p.Total, p.Done = docID, total, done
			lastEmit = time.Now()
			onProgress(p)
		}
		// 注册在拥有 pending 的 goroutine 内、紧随 emit 之后：队列退出（含取消）
		// 时最后一条 translating 也会被冲出，且发生在删除 queueCancel 之前。
		defer flushPending()
		for _, idx := range targets {
			for {
				if ctx.Err() != nil {
					return
				}
				e.mu.Lock()
				paused := ctl.isPaused
				e.mu.Unlock()
				if !paused {
					break
				}
				select {
				case <-ctx.Done():
					return
				case <-ctl.resume:
				}
			}
			e.mu.Lock()
			cue := &doc.Cues[idx]
			rawText := cue.Original
			if strings.TrimSpace(rawText) == "" {
				cue.State = CueSkipped
				doc.Revision++
				e.mu.Unlock()
				done++ // B2（跳过分支同序）：先计数再 emit，totals 保持一致
				emit(CueProgress{CueIndex: cue.Index, State: CueSkipped})
				continue
			}
			cue.State = CueTranslating
			doc.Revision++
			e.mu.Unlock()
			emit(CueProgress{CueIndex: cue.Index, State: CueTranslating})

			// 覆写标签剥离 → 纯文本送翻 → 回填（02 文档 §11.2）
			clean, tags := StripOverrideTags(rawText)
			clean = strings.TrimSpace(clean)
			var translated string
			var err error
			for attempt := 0; attempt < 3; attempt++ { // 首次 + 重试 ≤2
				if attempt > 0 {
					select {
					case <-ctx.Done():
					case <-time.After(300 * time.Millisecond):
					}
					if ctx.Err() != nil {
						return
					}
				}
				translated, err = e.translate(ctx, clean, "auto", opt.TargetLang)
				if err == nil {
					break
				}
				if ctx.Err() != nil {
					return
				}
			}
			e.mu.Lock()
			cue = &doc.Cues[idx]
			if err != nil {
				cue.State = CueFailed
			} else {
				back, needsCheck := ReinsertOverrideTags(translated, tags)
				cue.Translated = back
				cue.State = CueDone
				cue.OffTarget = offTargetCheck(back, opt.TargetLang)
				cue.NeedsCheck = needsCheck
			}
			// 不变量（spec §7.2）：持锁期间不 emit。所需值先在锁内拷成局部值，
			doc.Revision++
			// 解锁后不得再经 cue 指针读取 doc.Cues（B3：与快照/其它写者竞争）。
			p := CueProgress{
				CueIndex:   cue.Index,
				State:      cue.State,
				OffTarget:  cue.OffTarget,
				NeedsCheck: cue.NeedsCheck,
				Translated: cue.Translated,
			}
			e.mu.Unlock()

			done++ // B2：先计数再 emit，最后一行 Done == Total
			emit(p)
		}
	}()
	return nil
}

// offTargetCheck 队列场景 off-target 粗检（通过注入的检查函数或内置启发式）。
// 此处使用与主翻译台一致的启发式：由 app 注入。为避免循环依赖，
// 引擎内以回调注入（见 SetOffTargetChecker）。
var offTargetFn func(text, lang string) bool

// SetOffTargetChecker 注入 off-target 检查实现。
func SetOffTargetChecker(fn func(text, lang string) bool) { offTargetFn = fn }

func offTargetCheck(text, lang string) bool {
	if offTargetFn == nil {
		return false
	}
	return offTargetFn(text, lang)
}

// PauseQueue 暂停队列。
func (e *Engine) PauseQueue(docID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	ctl, ok := e.queueCancel[docID]
	if !ok {
		return fmt.Errorf("文档 %s 无进行中队列", docID)
	}
	ctl.isPaused = true
	return nil
}

// ResumeQueue 恢复队列。
func (e *Engine) ResumeQueue(docID string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	ctl, ok := e.queueCancel[docID]
	if !ok {
		return fmt.Errorf("文档 %s 无进行中队列", docID)
	}
	ctl.isPaused = false
	select {
	case ctl.resume <- struct{}{}:
	default:
	}
	return nil
}

// CancelQueue 取消队列（进行中的条目回 pending 或标 failed 前态）。
func (e *Engine) CancelQueue(docID string) {
	e.mu.Lock()
	ctl, ok := e.queueCancel[docID]
	e.mu.Unlock()
	if ok {
		ctl.cancel()
	}
}

// CancelAllQueues 取消全部队列（退出编排/空闲卸载前调用）。
func (e *Engine) CancelAllQueues() {
	e.mu.Lock()
	ctls := make([]*queueCtl, 0, len(e.queueCancel))
	for _, c := range e.queueCancel {
		ctls = append(ctls, c)
	}
	e.mu.Unlock()
	for _, c := range ctls {
		c.cancel()
	}
}

// RetryFailed 对 failed 条目重新排队（F-19 语义：只取 failed 子集）。
func (e *Engine) RetryFailed(docID string, opt QueueOptions, onProgress func(CueProgress)) error {
	opt.Full = false
	opt.targets = map[int]bool{}
	return e.translateQueue(docID, opt, onProgress, func(doc *SubtitleDoc) error {
		count := 0
		for i := range doc.Cues {
			if doc.Cues[i].State == CueFailed {
				count++
				opt.targets[doc.Cues[i].Index] = true
			}
		}
		if count == 0 {
			return fmt.Errorf("没有失败条目")
		}
		return nil
	})
}

// RetryCues 重译指定条目。
func (e *Engine) RetryCues(docID string, cueIdx []int, opt QueueOptions, onProgress func(CueProgress)) error {
	opt.Full = false
	opt.targets = map[int]bool{}
	return e.translateQueue(docID, opt, onProgress, func(doc *SubtitleDoc) error {
		for _, index := range cueIdx {
			if index < 1 || index > len(doc.Cues) {
				return fmt.Errorf("字幕序号%d不存在", index)
			}
		}
		if len(cueIdx) == 0 {
			return fmt.Errorf("请选择需要重译的条目")
		}
		for _, index := range cueIdx {
			doc.Cues[index-1].State = CuePending
			opt.targets[index] = true
		}
		return nil
	})
}
