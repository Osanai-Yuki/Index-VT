package main

import (
	"sync"
	"testing"
	"time"
)

// 并发 close 不得 panic（B10）。无 -race，用屏障 + 200 轮提高命中概率。
func TestDeltaBatcherConcurrentCloseDoesNotPanic(t *testing.T) {
	for iter := 0; iter < 200; iter++ {
		b := newDeltaBatcher(func(string) {})
		var start, done sync.WaitGroup
		start.Add(1)
		done.Add(4)
		for i := 0; i < 4; i++ {
			go func() {
				defer done.Done()
				start.Wait()
				b.close()
			}()
		}
		start.Done()
		done.Wait()
	}
}

// Task 1.1 的 CARRY FORWARD（归属 Task 1.4/1.7）：flushNow 先前先释放 b.mu 再 emit，
// ticker 与 close 并发时会出现「后快照的 chunk 先 emit」→ 前端 delta 乱序。
// 修复后 flush 只发生在唯一的 ticker goroutine 里（快照与 emit 成对），close 等待最终排空。
// 本测试不用 sleep 猜时序：flush("A") 被显式卡住，再写 "B" 并在同刻触发 close，
// 旧实现必然在 close 自己的 goroutine 里先 emit "B"（确定性乱序）；新实现里 got 在
// 放行 "A" 前必为空。
func TestDeltaBatcherFlushOrderPreserved(t *testing.T) {
	var mu sync.Mutex
	var got []string
	blockA := make(chan struct{})
	startedA := make(chan struct{})
	b := newDeltaBatcher(func(s string) {
		if s == "A" {
			close(startedA)
			<-blockA // 阻塞首个 flush，制造「快照 B 先 emit」的窗口
		}
		mu.Lock()
		got = append(got, s)
		mu.Unlock()
	})

	b.append("A")
	select {
	case <-startedA:
	case <-time.After(2 * time.Second):
		t.Fatal("ticker 未在 50ms 窗口内 flush 首个 chunk")
	}
	// "A" 的 emit 仍被卡住：此刻写入 "B"，并发触发 close。
	b.append("B")
	closed := make(chan struct{})
	go func() {
		b.close()
		close(closed)
	}()

	deadline := time.Now().Add(300 * time.Millisecond)
	for time.Now().Before(deadline) {
		mu.Lock()
		n, first := len(got), ""
		if n > 0 {
			first = got[0]
		}
		mu.Unlock()
		if n > 0 && first != "A" {
			t.Fatalf("flush 乱序：后写入的 %q 先于 \"A\" emit（got=%v）", first, got)
		}
		time.Sleep(5 * time.Millisecond)
	}
	close(blockA) // 放行 "A"
	select {
	case <-closed:
	case <-time.After(2 * time.Second):
		t.Fatal("close 未在放行 \"A\" 后完成（最终排空未发生）")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(got) != 2 || got[0] != "A" || got[1] != "B" {
		t.Fatalf("最终顺序错误: got=%v（期望 [A B]）", got)
	}
}
