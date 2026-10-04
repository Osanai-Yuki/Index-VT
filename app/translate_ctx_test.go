package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"indexvt/internal/translator"
)

// B23：翻译任务 ctx 必须派生自应用 ctx（a.ctx）。旧实现传 context.Background()，
// 挂死的推理请求永远无法回收 → OnTaskFinish 不执行 → activeTasks 永久 >0。
//
// 为什么用子进程：任务 goroutine 结束时无条件调用 runtime.EventsEmit(a.ctx, ...)，
// 而 Wails 的 getEvents 对没有 "events" 值的 ctx 直接 log.Fatalf（进程退出），
// 自动测试无法构造真实 Wails ctx，所以只能在子进程里跑到 OnTaskFinish 即退出。
func TestTranslateTaskContextFollowsAppContext(t *testing.T) {
	if os.Getenv("INDEXVT_TRANSLATE_CHILD") == "1" {
		runTranslateTaskChild()
		return
	}
	cmd := exec.Command(os.Args[0], "-test.run", "^TestTranslateTaskContextFollowsAppContext$")
	cmd.Env = append(os.Environ(), "INDEXVT_TRANSLATE_CHILD=1")
	out, err := cmd.CombinedOutput()
	if !strings.Contains(string(out), "TASK_FINISHED") {
		t.Fatalf("应用 ctx 取消后挂起的翻译任务未被回收（OnTaskFinish 未调用）: err=%v\nchild output:\n%s", err, out)
	}
}

// runTranslateTaskChild 在子进程中运行真实链路：挂死的 SSE 服务器 → 取消应用 ctx。
// 预期（修复后）：取消传导到任务 ctx，ChatStream 立即返回，OnTaskFinish 被调用。
func runTranslateTaskChild() {
	requestSeen := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		// 先发出响应头（客户端 http.Do 返回），随后挂住不发任何字节——模拟推理卡死。
		if fl, ok := w.(http.Flusher); ok {
			fl.Flush()
		}
		close(requestSeen)
		<-r.Context().Done() // 直到客户端断开
	}))
	defer srv.Close()

	appCtx, cancelApp := context.WithCancel(context.Background())
	a := &App{ctx: appCtx, deltas: map[string]*deltaBatcher{}}
	a.ready = make(chan struct{})
	close(a.ready)
	a.tr = translator.NewTranslator(translator.Deps{
		ResolveEndpoint: func(ctx context.Context, modelID string) (string, string, error) {
			return srv.URL, "", nil
		},
		OnTaskFinish: func(modelID string) {
			// 在这里退出：任务 goroutine 若继续走到 runtime.EventsEmit 会因
			// 测试 ctx 不是 Wails ctx 而 log.Fatal。标记先于退出，父进程据此断言。
			fmt.Println("TASK_FINISHED")
			os.Exit(0)
		},
		ModelForMode: func(mode translator.ModeKind) string { return "index-translate-2b" },
		ModelName:    func(modelID string) string { return "index-translate-2b" },
	}, nil)

	if _, err := a.Translate(TranslateRequestUI{SourceLang: "auto", TargetLang: "en", Text: "你好"}); err != nil {
		fmt.Println("TRANSLATE_ERROR:", err)
		os.Exit(4)
	}
	select {
	case <-requestSeen:
	case <-time.After(3 * time.Second):
		fmt.Println("REQUEST_TIMEOUT")
		os.Exit(5)
	}
	cancelApp() // 模拟应用退出（shutdown/runtime.Quit 触发的 ctx 取消）
	select {
	case <-time.After(3 * time.Second):
		fmt.Println("TASK_TIMEOUT")
		os.Exit(3)
	}
}
