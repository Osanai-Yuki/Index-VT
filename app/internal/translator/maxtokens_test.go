package translator

import (
	"encoding/json"
	"strings"
	"testing"
)

// ============================================================================
// max_tokens 参数化 + 注册表采样参数接线（M5 报告 §9 步 2 的「不等 M5」部分）
// ============================================================================

func TestEstimateTokens(t *testing.T) {
	if got := EstimateTokens(""); got != 0 {
		t.Fatalf("空文本: got %d want 0", got)
	}
	if got := EstimateTokens("abcdefgh"); got != 4 {
		t.Fatalf("8 ASCII: got %d want 4", got)
	}
	if got := EstimateTokens("王妃沈三娘"); got != 5 {
		t.Fatalf("5 CJK: got %d want 5", got)
	}
	if got := EstimateTokens("abc王妃"); got != 3 { // 3÷2=1 + 2 = 3
		t.Fatalf("混合: got %d want 3", got)
	}
}

// 短文本必须维持历史行为（1024）：主翻译台与字幕逐条队列的既有请求不被放大。
func TestTranslateMaxTokensShortTextStaysAtBase(t *testing.T) {
	tr := NewTranslator(Deps{CtxTokens: func() int { return 8192 }}, nil)
	prompt, maxTokens, temp, extra := tr.buildRequest("translate", TranslateRequest{
		Text: "一句短话", TargetLang: "en", Mode: ModeNormal,
	})
	if !strings.Contains(prompt, "一句短话") {
		t.Fatalf("prompt 应包含源文")
	}
	if maxTokens != 1024 {
		t.Fatalf("短文本 max_tokens: got %d want 1024（历史行为）", maxTokens)
	}
	if temp != 0.0 {
		t.Fatalf("Translate 温度: got %v want 0", temp)
	}
	if extra.stopTokenIDs != nil || extra.topK != 0 || extra.topP != 0 || extra.seed != 0 {
		t.Fatalf("Translate-2B 档案全零，不应发送任何额外采样参数: %+v", extra)
	}
}

func TestTranslateMaxTokensBudgetTable(t *testing.T) {
	longZh := strings.Repeat("妃", 1503) // §7.2 的截断样本长度
	cases := []struct {
		name     string
		text     string
		ctx      int // 0 = Deps 未接
		want     int
		wantCalc func(t *testing.T, got int)
	}{
		{
			// §7.2：1503 字实测需 1342 输出 token，1024 截断；8192 档预算应放大
			name: "1503字@8192 放大到估算预算",
			text: longZh, ctx: 8192,
			wantCalc: func(t *testing.T, got int) {
				want := 2*1503 + 128 // 3134
				if got != want {
					t.Fatalf("got %d want %d", got, want)
				}
			},
		},
		{
			// ctx 余量不足预算时让位钳制：4096-1503-896=1697
			name: "1503字@4096 钳到 ctx 余量",
			text: longZh, ctx: 4096,
			wantCalc: func(t *testing.T, got int) {
				if got != 1697 {
					t.Fatalf("got %d want 1697", got)
				}
			},
		},
		{
			// 余量低于基值 1024 时维持基值：不比历史更差（历史同样 1024，真超限由服务端 400）
			name: "1503字@2048 维持基值",
			text: longZh, ctx: 2048, want: 1024,
		},
		{
			name: "ctx 未知回落基值",
			text: longZh, ctx: 0, want: 1024,
		},
		{
			name: "拉丁长文按 0.5/字符估",
			text: strings.Repeat("a", 6000), ctx: 8192,
			wantCalc: func(t *testing.T, got int) {
				// est=3000；room=8192-3000-896=4296 < budget=6128 → 4296
				if got != 4296 {
					t.Fatalf("got %d want 4296", got)
				}
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tr := NewTranslator(Deps{CtxTokens: func() int { return tc.ctx }}, nil)
			_, maxTokens, _, _ := tr.buildRequest("translate", TranslateRequest{Text: tc.text, TargetLang: "en"})
			if tc.wantCalc != nil {
				tc.wantCalc(t, maxTokens)
				return
			}
			if maxTokens != tc.want {
				t.Fatalf("max_tokens: got %d want %d", maxTokens, tc.want)
			}
		})
	}
}

// Nailong 官方采样参数（top_k=-1 / seed=42 / stop_token_ids）必须真正进入请求体。
// M5 报告 §0.2：此前 sse.go 发送管道与 registry 存储各自就位，中间无生产代码接线。
func TestBuildRequestNailongSamplingWired(t *testing.T) {
	tr := NewTranslator(Deps{CtxTokens: func() int { return 8192 }}, nil)
	prompt, maxTokens, temp, extra := tr.buildRequest("nailong", TranslateRequest{
		Text: strings.Repeat("妃", 1503), TargetLang: "en",
	})
	if temp != 0.0 {
		t.Fatalf("Nailong 温度: got %v want 0", temp)
	}
	if len(extra.stopTokenIDs) != 2 || extra.stopTokenIDs[0] != 248044 || extra.stopTokenIDs[1] != 248046 {
		t.Fatalf("stop_token_ids 未接线: %v", extra.stopTokenIDs)
	}
	if extra.topK != -1 || extra.topP != 1.0 || extra.seed != 42 {
		t.Fatalf("Nailong top_k/top_p/seed 未接线: %+v", extra)
	}
	if !strings.Contains(prompt, "妃") {
		t.Fatalf("prompt 应包含源文")
	}
	// max_tokens 走与 Translate 相同的参数化路径（注册表基值 0 视同 1024 下限）
	if want := 2*1503 + 128; maxTokens != want {
		t.Fatalf("Nailong max_tokens: got %d want %d", maxTokens, want)
	}
	// 序列化层：非零档案字段必须出现在 JSON（sse.go MarshalJSON 的 omitempty 语义）
	req := ChatRequest{Model: "x", Messages: []ChatMessage{{Role: "user", Content: "y"}}}
	applyExtra(&req, extra)
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	for _, frag := range []string{`"stop_token_ids":[248044,248046]`, `"top_k":-1`, `"top_p":1`, `"seed":42`} {
		if !strings.Contains(string(b), frag) {
			t.Fatalf("请求 JSON 缺 %s: %s", frag, b)
		}
	}
}

// M5 §11 对齐钉子：docpipeline.MaxChunkRunes(32768) = 16769（ceiling 公式同源）。
// 该尺寸的满块在请求路径不得被 max_tokens 截断——若本测试失败，说明钳制常数被改动，
// 必须同步重推 docpipeline/chunker.go 的 ceiling 公式与 TestMaxChunkRunesTable。
func TestTranslateMaxTokensAccommodatesM5ChunkCeiling(t *testing.T) {
	tr := NewTranslator(Deps{CtxTokens: func() int { return 32768 }}, nil)
	ceiling := 16769 // docpipeline.MaxChunkRunes(32768)；用变量避免常量截断的编译期检查
	chunk := strings.Repeat("字", ceiling)
	_, maxTokens, _, _ := tr.buildRequest("translate", TranslateRequest{Text: chunk, TargetLang: "en"})
	need := int(0.893 * float64(ceiling)) // §7.3 实测输出膨胀
	if maxTokens < need {
		t.Fatalf("满块会被截断：max_tokens %d < 输出需求 %d", maxTokens, need)
	}
}

// Homura 官方公式不被本次改动影响。
func TestBuildRequestHomuraUnchanged(t *testing.T) {	tr := NewTranslator(Deps{CtxTokens: func() int { return 8192 }}, nil)
	_, maxTokens, temp, extra := tr.buildRequest("homura", TranslateRequest{
		Text: "一句配音词", TargetLang: "en", Mode: ModeDubbing, Syllables: 8,
	})
	if maxTokens != 512 { // max(512, 3×5)=512
		t.Fatalf("Homura max_tokens: got %d want 512", maxTokens)
	}
	if temp != 0.3 {
		t.Fatalf("Homura 温度: got %v want 0.3", temp)
	}
	if extra.stopTokenIDs != nil || extra.topK != 0 || extra.seed != 0 {
		t.Fatalf("Homura 档案全零: %+v", extra)
	}
}
