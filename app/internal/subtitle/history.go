package subtitle

import "fmt"

// 历史按文档隔离；至多20步/约16MiB，至少保留最后一步以允许撤销大文档编辑。
func trimHistory(items []*SubtitleDoc) []*SubtitleDoc {
	bytes := 0
	start := len(items) - 1
	for i := len(items) - 1; i >= 0 && len(items)-i <= 20; i-- {
		size := len(items[i].Cues)*128 + len(items[i].Styles)*256
		for _, c := range items[i].Cues {
			size += len(c.Original) + len(c.Translated)
		}
		if bytes+size > 16<<20 && i < len(items)-1 {
			break
		}
		bytes += size
		start = i
	}
	return append([]*SubtitleDoc(nil), items[start:]...)
}

func (e *Engine) rememberEditLocked(id string) {
	e.docs[id].Revision++
	if before := e.editBefore[id]; before != nil {
		e.undo[id] = trimHistory(append(e.undo[id], before))
		delete(e.redo, id)
		delete(e.editBefore, id)
	}
}

func (e *Engine) Undo(id string, redo bool) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc := e.docs[id]
	if doc == nil {
		return nil, fmt.Errorf("文档不存在")
	}
	if _, busy := e.queueCancel[id]; busy {
		return nil, fmt.Errorf("请先取消翻译队列再撤销/重做")
	}
	from, to := e.undo, e.redo
	if redo {
		from, to = to, from
	}
	stack := from[id]
	if len(stack) == 0 {
		return nil, fmt.Errorf("没有可撤销/重做的操作")
	}
	to[id] = trimHistory(append(to[id], e.snapshotLocked(doc)))
	e.docs[id] = stack[len(stack)-1]
	e.docs[id].Revision = doc.Revision + 1
	from[id] = stack[:len(stack)-1]
	delete(e.editBefore, id)
	e.touchLocked(id)
	return e.snapshotLocked(e.docs[id]), nil
}

// ShiftCue 在引擎锁内应用增量，连续点击不会把旧快照里的时间覆盖回去。
func (e *Engine) ShiftCue(id string, index int, field string, delta int64) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc := e.docs[id]
	if doc == nil || index < 1 || index > len(doc.Cues) {
		return nil, fmt.Errorf("字幕条目不存在")
	}
	if err := e.checkQueueActive(id); err != nil {
		return nil, err
	}
	c := &doc.Cues[index-1]
	switch field {
	case "startMs":
		c.StartMs = max(int64(0), min64(c.EndMs-1, c.StartMs+delta))
	case "endMs":
		c.EndMs = max(c.StartMs+1, c.EndMs+delta)
	default:
		return nil, fmt.Errorf("时间字段无效")
	}
	e.rememberEditLocked(id)
	e.touchLocked(id)
	return e.snapshotLocked(doc), nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}
