package main

import (
	"sync"
	"testing"
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
