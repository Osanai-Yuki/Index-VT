package translator

import (
	"strings"
	"testing"
)

// F-01 / 01 文档 §4.1：无约束模板逐字断言（官方 trans_prompt plain 分支）。
func TestBuildTranslatePromptPlain(t *testing.T) {
	got := BuildTranslatePrompt("你好，世界。", "zh", "en", nil)
	want := "请将以下中文文本翻译为英语，直接输出翻译结果，不要进行任何解释。\n\n你好，世界。"
	if got != want {
		t.Fatalf("plain(zh→en) mismatch:\n got=%q\nwant=%q", got, want)
	}
}

func TestBuildTranslatePromptAutoOmitsSource(t *testing.T) {
	got := BuildTranslatePrompt(" Hello world ", "auto", "zh", nil)
	want := "请将以下文本翻译为中文，直接输出翻译结果，不要进行任何解释。\n\nHello world"
	if got != want {
		t.Fatalf("auto mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// 01 文档 §4.1 instTrans：术语表硬约束（官方格式："专名/术语对照: A→B、C→D"）。
func TestBuildTranslatePromptInstTransGlossary(t *testing.T) {
	got := BuildTranslatePrompt("王平仲采用了更加昂贵的碳纤维材料。碳纤维的好处就是它抗裂缝。", "zh", "en",
		&Constraints{
			Glossary: []GlossaryItem{
				{Term: "碳纤维", Translation: "carbon fiber"},
				{Term: "抗裂缝", Translation: "crack resistance"},
			},
			Genre: "文本",
		})
	want := "请将以下中文文本翻译成英语，并且严格遵循所有约束要求。\n\n" +
		"【源文】\n" +
		"王平仲采用了更加昂贵的碳纤维材料。碳纤维的好处就是它抗裂缝。\n\n" +
		"【约束要求】\n" +
		"1. 【硬性要求】专名/术语对照: 碳纤维→carbon fiber、抗裂缝→crack resistance\n\n" +
		"只输出译文，不要有任何额外说明。"
	if got != want {
		t.Fatalf("instTrans glossary mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// F-04：JSON 格式保持——输入为 JSON dict 且约束含 JSON 时切换官方 JSON 输出指令。
func TestBuildTranslatePromptJSONSuffix(t *testing.T) {
	input := `{"user_id": 1024, "event": "purchase", "message": "您的订单已支付完成。"}`
	got := BuildTranslatePrompt(input, "auto", "en", &Constraints{JSONPreserve: true})
	if !strings.Contains(got, "【约束要求】") {
		t.Fatalf("JSON 约束应走 instTrans 分支: %q", got)
	}
	if !strings.Contains(got, "【硬性要求】仅翻译键值内容，严格保留合法 JSON 语法格式与键名") {
		t.Fatalf("缺 JSON 硬约束行: %q", got)
	}
	if !strings.Contains(got, jsonSuffix) {
		t.Fatalf("缺官方 JSON 输出指令: %q", got)
	}
	// 官方原文核对
	wantSuffix := "请以相同的 JSON 格式输出翻译结果，key 保持不变，value 为对应译文。只输出 JSON，不要有任何额外说明。"
	if jsonSuffix != wantSuffix {
		t.Fatalf("JSON suffix 与官方原文不一致: %q", jsonSuffix)
	}
}

// 硬约束/软约束编号与【注意】前缀（官方顺序：hard → glossary → soft）。
func TestBuildTranslatePromptConstraintOrdering(t *testing.T) {
	got := BuildTranslatePrompt("今天下午的会议临时取消了。", "zh", "en", &Constraints{
		Hard: []string{"保持 Markdown 表格结构"},
		Soft: []string{"调整为严谨、正式、礼貌的商务公文风格"},
	})
	if !strings.Contains(got, "1. 【硬性要求】保持 Markdown 表格结构\n2. 【注意】调整为严谨、正式、礼貌的商务公文风格") {
		t.Fatalf("约束顺序/编号/前缀不符:\n%s", got)
	}
	if !strings.HasSuffix(got, plainSuffix) {
		t.Fatalf("普通约束应以官方 plainSuffix 结尾:\n%s", got)
	}
}

// stripNumbering 对齐官方 lstrip("0123456789. ") 语义。
func TestStripNumbering(t *testing.T) {
	cases := map[string]string{
		"1. 完整翻译": "完整翻译",
		"12. 保持一致": "保持一致",
		"  3. 保留":   "保留",
		"完整翻译":     "完整翻译",
	}
	for in, want := range cases {
		if got := stripNumbering(in); got != want {
			t.Fatalf("stripNumbering(%q)=%q want=%q", in, got, want)
		}
	}
}

func TestIsJSONDict(t *testing.T) {
	if !isJSONDict(`{"a":1}`) {
		t.Fatal(`{"a":1} 应判定为 JSON dict`)
	}
	if isJSONDict(`[1,2]`) {
		t.Fatal("数组不应判定为 dict")
	}
	if isJSONDict(`{"a":1`) {
		t.Fatal("非法 JSON 不应判定")
	}
}
