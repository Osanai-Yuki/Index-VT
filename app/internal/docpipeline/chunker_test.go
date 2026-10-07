package docpipeline

import (
	"strings"
	"testing"
)

// MaxChunkRunes ceiling 钉死（M5 报告 §11）：数值由 (ctx − 896 − 128) / (1.0 + 0.893)
// 推导，与 translator.translateMaxTokens 的请求钳制同源（对齐钉子见
// translator/maxtokens_test.go 的 M5ChunkCeiling 用例）。改任何常数必须重推两处并同步本表。
func TestMaxChunkRunesTable(t *testing.T) {
	cases := []struct {
		ctx  int
		want int
	}{
		{2048, 540},    // (2048−1024)/1.893 = 540.94 → 540
		{8192, 3786},   // (8192−1024)/1.893 = 3786.58 → 3786
		{16384, 8114},  // (16384−1024)/1.893 = 8114.10 → 8114
		{32768, 16769}, // (32768−1024)/1.893 = 16769.15 → 16769
	}
	for _, tc := range cases {
		if got := MaxChunkRunes(tc.ctx); got != tc.want {
			t.Fatalf("MaxChunkRunes(%d) = %d, want %d", tc.ctx, got, tc.want)
		}
	}
	// 异常小的 ctx：下限钳制保底可推进
	if got := MaxChunkRunes(512); got != chunkMinRunes {
		t.Fatalf("MaxChunkRunes(512) = %d, want %d", got, chunkMinRunes)
	}
}

// 满块不变式：任何块都不超 ceiling；块区间单调无缝；块文本重组（Trim 后）等于原文 Trim。
func TestChunkTextRespectsBudget(t *testing.T) {
	para := strings.Repeat("王妃出宫去了青岩关，节度使在城头看着铁浮图列队。", 40) // 880 字
	text := strings.Repeat(para+"\n\n", 5) + para                                  // 5280 字
	const ctx = 2048
	chunks := ChunkText(text, ctx)
	ceil := MaxChunkRunes(ctx)
	if len(chunks) < 2 {
		t.Fatalf("5280 字 @ceiling %d 应切成多块，got %d", ceil, len(chunks))
	}
	var joined strings.Builder
	lastEnd := 0
	for i, c := range chunks {
		if c.End-c.Start > ceil {
			t.Fatalf("块 %d 超 ceiling：%d > %d", i, c.End-c.Start, ceil)
		}
		if c.EstTokens == 0 || c.Text == "" {
			t.Fatalf("块 %d 为空", i)
		}
		if c.Start < lastEnd {
			t.Fatalf("块 %d 与前块重叠", i)
		}
		lastEnd = c.End
		joined.WriteString(c.Text)
	}
	// 分隔空白属刻意丢弃（块内 Trim），所以比较「去全部空白后的内容序列」：
	// 能抓内容丢失/乱序，不纠缠分隔符策略。
	if stripSpace(joined.String()) != stripSpace(text) {
		t.Fatal("块文本重组（去空白）不等于原文")
	}
}

func stripSpace(s string) string {
	var b strings.Builder
	for _, r := range s {
		if !isSpaceRune(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// 段落边界优先：有 \n 时按段落切，每块恰好一段。
func TestChunkTextParagraphBoundary(t *testing.T) {
	para := strings.Repeat("字", 300) + "。"
	text := strings.Repeat(para+"\n\n", 3) + para // 3 段，段间双换行
	chunks := ChunkText(text, 2048)               // ceiling 540 > 单段 301
	if len(chunks) != 4 {
		t.Fatalf("4 段应切 4 块（按段落边界），got %d", len(chunks))
	}
	for i, c := range chunks {
		if !strings.HasPrefix(c.Text, "字") || !strings.HasSuffix(c.Text, "。") {
			t.Fatalf("块 %d 未对齐段落边界：%q…%q", i, c.Text[:min(6, len(c.Text))], c.Text[max(0, len(c.Text)-3):])
		}
	}
}

// 段落缺失时退到句读边界；仍无处可切才硬切。
func TestChunkTextSentenceThenHardCut(t *testing.T) {
	// 句子 301 字一条、无换行：ceiling 540 装不下两条，必须句读切
	text := strings.Repeat(strings.Repeat("字", 300)+"。", 4)
	chunks := ChunkText(text, 2048)
	if len(chunks) != 4 {
		t.Fatalf("4 句应切 4 块（句读边界），got %d", len(chunks))
	}
	for i, c := range chunks {
		if !strings.HasSuffix(c.Text, "。") {
			t.Fatalf("块 %d 未落在句读后：%q…", i, c.Text[:min(6, len(c.Text))])
		}
	}
	// 硬切：无段落无句读
	hard := strings.Repeat("长", 9000)
	chunks = ChunkText(hard, 8192) // ceiling 3785 → 3785+3785+1430
	if len(chunks) != 3 {
		t.Fatalf("9000 字无标点 @8K 应切 3 块，got %d", len(chunks))
	}
	var joined strings.Builder
	for _, c := range chunks {
		joined.WriteString(c.Text)
	}
	if joined.String() != hard {
		t.Fatal("硬切块重组应逐字等于原文")
	}
}

func TestChunkTextEmpty(t *testing.T) {
	if got := ChunkText("", 8192); got != nil {
		t.Fatalf("空文本应返回 nil，got %v", got)
	}
	if got := ChunkText(" \n\t　", 8192); got != nil {
		t.Fatalf("纯空白应返回 nil，got %v", got)
	}
}
