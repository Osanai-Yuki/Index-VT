package translator

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestTranslateFirstTokenTimeout 首字节看门狗：llama-server 接受连接、返回 200 与
// 事件流头后迟迟不发首个增量时，Translate 必须在 firstTokenTimeout 内以
// ErrFirstTokenTimeout 中止，而不是无限阻塞（UI 会一直停在"模型唤醒中…"）。
// 用 firstTokenTimeout 包级变量把看门狗压到 150ms；本用例自带 2s 护栏，
// 旧实现（Timeout: 0 且无首字保护）会一直卡在首个 token 上，护栏即失败点。
func TestTranslateFirstTokenTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush() // 200 与流头已送达：连接"已建立"但永不发首字
		}
		<-r.Context().Done() // 等客户端断开，避免 handler 泄漏
	}))
	// LIFO：先强制断开活动连接让 handler 退出，再 Close 等待收尾。
	t.Cleanup(srv.Close)
	t.Cleanup(srv.CloseClientConnections)

	oldTimeout := firstTokenTimeout
	firstTokenTimeout = 150 * time.Millisecond
	t.Cleanup(func() { firstTokenTimeout = oldTimeout })

	tr := NewTranslator(Deps{
		ResolveEndpoint: func(ctx context.Context, modelID string) (string, string, error) {
			return srv.URL, "", nil
		},
		ModelForMode: func(m ModeKind) string { return "index-translate-2b" },
		ModelName:    func(modelID string) string { return "index-translate-2b" },
	}, nil)

	type outcome struct {
		res TranslateResult
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := tr.Translate(context.Background(), TranslateRequest{
			TaskID: "t-first-token", TargetLang: "en", Text: "你好",
		}, nil)
		done <- outcome{res, err}
	}()

	select {
	case o := <-done:
		if !errors.Is(o.err, ErrFirstTokenTimeout) {
			t.Fatalf("期望 errors.Is(err, ErrFirstTokenTimeout)，得到 err=%v", o.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Translate 未在 2s 内返回：首字节看门狗未生效（旧实现在等首个 token 上无限阻塞）")
	}
}
