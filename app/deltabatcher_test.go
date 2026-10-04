package main

import (
	"strconv"
	"strings"
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

// Fix round 1：OnBeforeStop 的 teardown 恢复为「锁内摘 a.deltas → 锁外逐个 go b.close()」
// （异步等待）。异步不得破坏顺序不变量：
//   - close() 返回 ⇔ done 已关闭 ⇔ 最终 flush 已在唯一 ticker goroutine 内完成，
//     且 flushNow 只在 ticker goroutine 里被调用 → 同一 task 的任何两次 emit 必然
//     同 goroutine 串行，不可能乱序；
//   - 任务完成路径（Translate 的 goroutine）close 返回后才 emit translate:done，
//     与 teardown 的 go close 竞争同一 sync.Once/done 也无影响。
//
// 测试覆盖 teardown 形状（每个 batcher 从独立 goroutine close，与完成路径并发），
// 断言「每个 task 的 chunk 序列完整且有序、done 必在所有 chunk 之后」。
// 确定性：不 sleep 猜时序，断言前 wg.Wait() —— 等齐所有显式完成信号，此后事件序列
// 不再变化；ticker 在 append 与 close 之间是否发生过 flush 不影响断言（拼接不变）。
func TestDeltaBatcherAsyncClosePreservesOrder(t *testing.T) {
	const tasks = 8
	type rec struct {
		mu     sync.Mutex
		events []string
	}
	recs := make([]*rec, tasks)
	batchers := make([]*deltaBatcher, tasks)
	var wg sync.WaitGroup

	for i := 0; i < tasks; i++ {
		r := &rec{}
		recs[i] = r
		id := strconv.Itoa(i)
		b := newDeltaBatcher(func(text string) {
			r.mu.Lock()
			r.events = append(r.events, text)
			r.mu.Unlock()
		})
		batchers[i] = b
		b.append("A" + id)
		if i%2 == 0 {
			// 完成路径：close 返回（排空完成）后才 emit done，模拟 translate:done。
			wg.Add(1)
			go func() {
				defer wg.Done()
				b.close()
				r.mu.Lock()
				r.events = append(r.events, "done")
				r.mu.Unlock()
			}()
		}
	}

	// teardown 形状：锁内已摘出 pending，锁外逐个 go b.close()（本次修复点）。
	for _, b := range batchers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			b.close()
		}()
	}
	wg.Wait() // 每个 batcher 的最终排空与 done 追加都已完成，序列已定格

	for i, r := range recs {
		r.mu.Lock()
		got := strings.Join(r.events, "|")
		r.mu.Unlock()
		want := "A" + strconv.Itoa(i)
		if i%2 == 0 {
			want += "|done"
		}
		if got != want {
			t.Errorf("task %d 异步 close 后事件序列错误: got=%q want=%q", i, got, want)
		}
	}
}
