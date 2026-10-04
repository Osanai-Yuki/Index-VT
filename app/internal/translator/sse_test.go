package translator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// 02 文档 §7 SSE 坑：多字节 token 被拆分——解析器必须按字节缓冲到完整 JSON 再解码。
// 构造一个把 UTF-8 多字节字符按字节切开的 SSE 流验证。
func TestChatStreamMultiByteSplit(t *testing.T) {
	text := "今天天气不错，我们去公园散步吧。Hello!"
	// 构造 delta 序列：每 3 字节切一刀（必然拆开多字节字符）
	var deltas []string
	b := []byte(text)
	for i := 0; i < len(b); i += 3 {
		end := i + 3
		if end > len(b) {
			end = len(b)
		}
		deltas = append(deltas, string(b[i:end]))
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, d := range deltas {
			payload, _ := json.Marshal(map[string]any{
				"choices": []map[string]any{
					{"delta": map[string]any{"content": d}},
				},
			})
			_, _ = w.Write([]byte("data: " + string(payload) + "\n\n"))
			w.(http.Flusher).Flush()
		}
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	client := newChatClient(srv.URL)
	var got strings.Builder
	res, err := client.ChatStream(context.Background(), ChatRequest{
		Model: "m", Messages: []ChatMessage{{Role: "user", Content: "hi"}},
	}, func(delta string) { got.WriteString(delta) })
	if err != nil {
		t.Fatal(err)
	}
	if res.Text != text {
		t.Fatalf("多字节拆分重组失败:\n got=%q\nwant=%q", res.Text, text)
	}
	if got.String() != text {
		t.Fatalf("onDelta 重组失败: %q", got.String())
	}
}

func TestStripThink(t *testing.T) {
	if got := stripThink("<think>reasoning</think>答案"); got != "答案" {
		t.Fatalf("stripThink=%q", got)
	}
	if got := stripThink("纯文本"); got != "纯文本" {
		t.Fatalf("stripThink plain=%q", got)
	}
}

// 语言清单：官方 154 标识符（含别名）/ 150 条目——本表 152 标识符覆盖全部 150 条目
//（未收录 eng_Latn / zho_Hans 两个核心别名）。
func TestLanguageInventory(t *testing.T) {
	if len(Languages) != 152 {
		t.Fatalf("语言标识符数量=%d want 152", len(Languages))
	}
	seen := map[string]bool{}
	for _, l := range Languages {
		seen[l.EnName] = true
	}
	// pes_Arab/fas_Arab 同为 Persian；yue_Hani/yue_Hant 同为 Cantonese
	if n := len(seen); n != 150 {
		t.Fatalf("去重后条目=%d want 150", n)
	}
	if _, ok := LangByCode("en"); !ok {
		t.Fatal("en 缺失")
	}
	if LangName("ja") != "日语" || LangName("zh") != "中文" {
		t.Fatal("核心语言中文名缺失")
	}
	// 未知代码回退为码本身（官方 LANG_NAMES.get(code, code) 语义）
	if LangName("xx_unknown") != "xx_unknown" {
		t.Fatal("未知码应原样返回")
	}
}

func TestOffTarget(t *testing.T) {
	if !DetectOffTarget("こんにちは世界", "en") {
		t.Fatal("目标 en 输出日文应判定 off-target")
	}
	if DetectOffTarget("Hello world, this is fine.", "en") {
		t.Fatal("目标 en 输出英文不应判定")
	}
	if DetectOffTarget("你好世界", "zh") {
		t.Fatal("目标 zh 输出中文不应判定")
	}
	// 日语期望脚本对 Han/Kana 均合法
	if DetectOffTarget("今日は良い天気ですね", "ja") {
		t.Fatal("日语输出误判")
	}
}

func TestDetectSourceLang(t *testing.T) {
	if DetectSourceLang("你好，世界。") != "zh" {
		t.Fatal("中文检测失败")
	}
	if DetectSourceLang("こんにちは") != "ja" {
		t.Fatal("日语检测失败")
	}
	if DetectSourceLang("Hello, world.") != "en" {
		t.Fatal("拉丁默认 en 失败")
	}
}
