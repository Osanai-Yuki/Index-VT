package translator

import (
	"strings"
	"testing"
)

// F-07 / 01 文档 §4.2：Homura 模板逐字断言（官方 syl_prompt）。
func TestBuildHomuraPromptNoGlossary(t *testing.T) {
	got := BuildHomuraPrompt("我们今天去看电影吧", "en", 7, nil)
	want := "请将以下文本翻译为英语，译文严格控制在 7 个音节。直接输出翻译结果，不要进行任何解释。\n\n我们今天去看电影吧"
	if got != want {
		t.Fatalf("homura no-glossary mismatch:\n got=%q\nwant=%q", got, want)
	}
}

func TestBuildHomuraPromptWithGlossary(t *testing.T) {
	got := BuildHomuraPrompt("我们今天去看电影吧", "en", 7, []GlossaryItem{
		{Term: "电影", Translation: "cinema"},
	})
	want := "请将以下文本翻译为英语，译文严格控制在 7 个音节。要求：严格遵守术语映射表【电影 -> cinema】。直接输出翻译结果，不要进行任何解释。\n\n我们今天去看电影吧"
	if got != want {
		t.Fatalf("homura glossary mismatch:\n got=%q\nwant=%q", got, want)
	}
}

// 官方 max_tokens = max(512, 3×len(text))。
func TestHomuraMaxTokens(t *testing.T) {
	if got := HomuraMaxTokens("hi"); got != 512 {
		t.Fatalf("短文本 max_tokens=%d want 512", got)
	}
	if got := HomuraMaxTokens(strings.Repeat("字", 100)); got != 512 {
		t.Fatalf("100 字 max_tokens=%d want 512（3×100=300 < 512）", got)
	}
	if got := HomuraMaxTokens(strings.Repeat("字", 200)); got != 600 {
		t.Fatalf("200 字 max_tokens=%d want 600", got)
	}
}

// Nailong：官方 render_prompt（占位符替换 + 方向校验 + 模板原文保真）。
func TestBuildNailongPrompt(t *testing.T) {
	got, err := BuildNailongPrompt(DirZhEn, "少年抬头，看见阁楼门口站着一个熟悉的身影。")
	if err != nil {
		t.Fatal(err)
	}
	wantHead := "请将以下中文小说翻译成英语，并且严格遵循所有约束要求。"
	if !strings.HasPrefix(got, wantHead) {
		t.Fatalf("zh-en 模板头不符: %q", got[:min(len(got), len(wantHead))])
	}
	if !strings.Contains(got, "少年抬头，看见阁楼门口站着一个熟悉的身影。") {
		t.Fatal("原文未被替换进模板")
	}
	if !strings.Contains(got, "1. 完整翻译所有内容，不要遗漏、概括、合并或添加内容。") {
		t.Fatal("缺官方约束行 1")
	}
	if strings.Contains(got, "（在这里放入需要翻译的完整中文原文）") {
		t.Fatal("占位符未被替换")
	}
}

func TestBuildNailongDirectionMarker(t *testing.T) {
	// 每个方向的占位符语言词必须与官方 SRC_WORD 表一致
	cases := map[NailongDirection]string{
		DirZhEn: "中文", DirEnZh: "英文", DirZhJa: "中文", DirJaZh: "日文",
	}
	for dir, word := range cases {
		tpl, err := nailongTemplate(dir)
		if err != nil {
			t.Fatal(err)
		}
		marker := "（在这里放入需要翻译的完整" + word + "原文）"
		if count := strings.Count(tpl, marker); count != 1 {
			t.Fatalf("%s 模板占位符数量=%d", dir, count)
		}
	}
}

func TestBuildNailongInvalidDirection(t *testing.T) {
	if _, err := BuildNailongPrompt("fr-ja", "text"); err == nil {
		t.Fatal("非法方向应报错")
	}
	if _, err := BuildNailongPrompt(DirZhEn, "  "); err == nil {
		t.Fatal("空文本应报错")
	}
}
