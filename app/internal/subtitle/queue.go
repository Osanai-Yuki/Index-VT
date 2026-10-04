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
	cancel  context.CancelFunc
	paused  chan struct{}
	resume  chan struct{}
}

// TranslateQueue 启动逐条翻译队列。
func (e *Engine) TranslateQueue(docID string, opt QueueOptions, onProgress func(CueProgress)) error {
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
	ctx, cancel := context.WithCancel(context.Background())
	ctl := &queueCtl{
		cancel: cancel,
		paused: make(chan struct{}, 1),
		resume: make(chan struct{}, 1),
	}
	e.queueCancel[docID] = ctl
	// 只取 pending/failed（重试场景只重跑 failed 由 RetryCue 保证）
	var targets []int
	for i := range doc.Cues {
		c := &doc.Cues[i]
		if c.State == CuePending || c.State == CueFailed {
			targets = append(targets, i)
			c.State = CuePending
		}
	}
	e.mu.Unlock()

	go func() {
		defer func() {
			e.mu.Lock()
			delete(e.queueCancel, docID)
			e.mu.Unlock()
		}()
		total := len(targets)
		done := 0
		var lastEmit time.Time
		emit := func(p CueProgress) {
			if onProgress == nil {
				return
			}
			// 100ms 合并（02 文档 §11.4）；终态事件立即推送
			if p.State != CueDone && p.State != CueFailed && time.Since(lastEmit) < 100*time.Millisecond {
				return
			}
			lastEmit = time.Now()
			p.DocID = docID
			p.Total = total
			p.Done = done
			onProgress(p)
		}
		for _, idx := range targets {
			select {
			case <-ctx.Done():
				return
			case <-ctl.paused:
				select {
				case <-ctx.Done():
					return
				case <-ctl.resume:
				}
			default:
			}
			e.mu.Lock()
			cue := &doc.Cues[idx]
			rawText := cue.Original
			if strings.TrimSpace(rawText) == "" {
				cue.State = CueSkipped
				e.mu.Unlock()
				emit(CueProgress{CueIndex: cue.Index, State: CueSkipped})
				done++
				continue
			}
			cue.State = CueTranslating
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
			e.mu.Unlock()
			if err != nil {
				emit(CueProgress{CueIndex: cue.Index, State: CueFailed})
			} else {
				emit(CueProgress{CueIndex: cue.Index, State: CueDone,
					OffTarget: cue.OffTarget, NeedsCheck: cue.NeedsCheck})
			}
			done++
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
	ctl, ok := e.queueCancel[docID]
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("文档 %s 无进行中队列", docID)
	}
	select {
	case ctl.paused <- struct{}{}:
	default:
	}
	return nil
}

// ResumeQueue 恢复队列。
func (e *Engine) ResumeQueue(docID string) error {
	e.mu.Lock()
	ctl, ok := e.queueCancel[docID]
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("文档 %s 无进行中队列", docID)
	}
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
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	n := 0
	for i := range doc.Cues {
		if doc.Cues[i].State == CueFailed {
			doc.Cues[i].State = CuePending
			n++
		}
	}
	e.mu.Unlock()
	if n == 0 {
		return fmt.Errorf("没有失败条目")
	}
	return e.TranslateQueue(docID, opt, onProgress)
}

// RetryCues 重译指定条目。
func (e *Engine) RetryCues(docID string, cueIdx []int, opt QueueOptions, onProgress func(CueProgress)) error {
	e.mu.Lock()
	doc, ok := e.docs[docID]
	if !ok {
		e.mu.Unlock()
		return fmt.Errorf("文档 %s 不存在", docID)
	}
	for _, i := range cueIdx {
		for j := range doc.Cues {
			if doc.Cues[j].Index == i {
				doc.Cues[j].State = CuePending
				doc.Cues[j].Translated = ""
			}
		}
	}
	e.mu.Unlock()
	return e.TranslateQueue(docID, opt, onProgress)
}
