package subtitle

import (
	"testing"
	"time"
)

// 本文件为 subtitle 包共享测试夹具（Task 1.17 创建）。
// Task 1.9 / Task 1.10 复用此处定义，不得重复定义同名 helper。

// newDocForTest 构造 n 条 pending cue 的文档：Index 从 1 起，
// 时间轴自 0 起每 1s 一条（末段 900ms），便于队列/导出类测试直接使用。
func newDocForTest(n int) *SubtitleDoc {
	cues := make([]Cue, 0, n)
	for i := 0; i < n; i++ {
		cues = append(cues, Cue{
			Index: i + 1, StartMs: int64(i * 1000), EndMs: int64(i*1000 + 900),
			Original: "原文", State: CuePending,
		})
	}
	return &SubtitleDoc{ID: "d1", Path: "x.srt", Encoding: "utf-8", Cues: cues}
}

// waitQueueDone 轮询 queueCancel（持 e.mu）直到 docID 的队列结束；10s 未结束即 Fatal。
func waitQueueDone(t *testing.T, e *Engine, docID string) {
	t.Helper()
	for i := 0; i < 400; i++ {
		e.mu.Lock()
		_, busy := e.queueCancel[docID]
		e.mu.Unlock()
		if !busy {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("队列 10s 内未结束")
}
