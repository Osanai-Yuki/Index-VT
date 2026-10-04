package translator

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 取消时也必须拿到已流式产出的文本（B22①）。
func TestChatStreamCancelKeepsPartialText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		for i := 0; i < 200; i++ {
			if _, err := fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"字%d \"}}]}\n\n", i); err != nil {
				return
			}
			if fl != nil {
				fl.Flush()
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(40 * time.Millisecond):
			}
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan StreamResult, 1)
	go func() {
		res, _ := newChatClient(srv.URL).ChatStream(ctx, chatRequestForTest(), nil)
		got <- res
	}()
	time.Sleep(250 * time.Millisecond)
	cancel()

	select {
	case res := <-got:
		if res.Text == "" {
			t.Fatalf("取消后已流式文本被丢弃：Text=%q（应非空）", res.Text)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("取消后 ChatStream 未返回")
	}
}

func chatRequestForTest() ChatRequest {
	return ChatRequest{
		Model:    "index-translate-2b",
		Messages: []ChatMessage{{Role: "user", Content: "你好"}},
	}
}

// 服务器迟迟不发事件边界时，事件缓冲必须有上限，且已流式文本仍须保留（B22②）。
func TestChatStreamEventBufferOverflow(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		// 先发一条正常事件，产出部分文本
		_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"已产出\"}}]}\n\n")
		if fl != nil {
			fl.Flush()
		}
		// 之后持续发送字节但永不发送事件边界（空行），总量超过 maxEventBuf
		garbage := strings.Repeat("x", 32*1024)
		for i := 0; i < 64; i++ { // 2MB > 1MB 上限
			if _, err := fmt.Fprint(w, garbage); err != nil {
				return
			}
			if fl != nil {
				fl.Flush()
			}
		}
	}))
	defer srv.Close()

	res, err := newChatClient(srv.URL).ChatStream(context.Background(), chatRequestForTest(), nil)
	if !errors.Is(err, ErrStreamBufferOverflow) {
		t.Fatalf("期望缓冲溢出错误，得到 err=%v", err)
	}
	if res.Text != "已产出" {
		t.Fatalf("溢出时已流式文本应保留：Text=%q", res.Text)
	}
}
