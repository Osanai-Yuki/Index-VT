package main

import (
	"path/filepath"
	"sync"
	"testing"
	"time"

	"indexvt/internal/config"
	"indexvt/internal/modelmanager"
	"indexvt/internal/store"
)

// 前端线程写、编排线程读：无锁会撕裂 string header（B8）。
// 无 -race，用"读到的值只能是两个写入值之一"这一不变量来暴露。
func TestConfigSnapshotNeverTears(t *testing.T) {
	a := &App{}
	a.cfg = config.Default()
	const aVal, bVal = "AAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBB"
	a.cfg.ActiveModel = aVal

	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			want := aVal
			if i%2 == 0 {
				want = bVal
			}
			v := want
			a.withCfg(func(c *config.Config) { c.ActiveModel = v })
			i++
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			got := a.cfgSnapshot().ActiveModel
			if got != aVal && got != bVal {
				t.Errorf("配置撕裂: %q", got)
				return
			}
		}
	}()
	time.Sleep(2 * time.Second)
	close(stop)
	wg.Wait()
}

// B11：装配未完成（a.ready 未关闭）时 SetConfig 必须等待 ensureReady，
// 而不是在 store 就绪前写入造成 nil 解引用。就绪后保持既有语义：
// Normalize + 非法 ActiveModel 回落 translate + 持久化。
func TestSetConfigWaitsForReady(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "appgate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	a := &App{store: st}
	a.ready = make(chan struct{}) // 模拟装配窗口：未关闭

	done := make(chan error, 1)
	go func() { done <- a.SetConfig(config.Config{ActiveModel: "bogus-id"}) }()

	select {
	case err := <-done:
		t.Fatalf("装配未完成时 SetConfig 未等待 ensureReady: err=%v", err)
	case <-time.After(100 * time.Millisecond):
		// 正确：应阻塞在 ensureReady
	}
	close(a.ready)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("就绪后 SetConfig 失败: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("就绪后 SetConfig 仍未返回")
	}

	var out config.Config
	ok, err := st.GetConfig("app", &out)
	if err != nil || !ok {
		t.Fatalf("配置未持久化: ok=%v err=%v", ok, err)
	}
	if out.ActiveModel != string(modelmanager.ModelTranslate) {
		t.Fatalf("非法 ActiveModel 未回落 translate: %q", out.ActiveModel)
	}
}

// R2：GetConfig 不加 ensureReady 门禁 —— 装配期调用必须立即返回（零值 Config 无害），
// 不得挂住设置页。
func TestGetConfigDoesNotWaitForReady(t *testing.T) {
	a := &App{}
	a.ready = make(chan struct{}) // 永不关闭
	done := make(chan config.Config, 1)
	go func() { done <- a.GetConfig() }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("GetConfig 不应等待装配完成（控制器裁定 R2）")
	}
}
