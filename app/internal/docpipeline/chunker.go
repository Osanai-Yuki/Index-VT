// chunker.go —— token 预算分块器（M5 报告 §9 步 1 / §11 对齐约定）。
//
// 职责：把任意长度的纯文本按「单次请求内 prompt+输出都不超 ctx」的预算切成块，
// 边界优先落在段落，其次句子，最后硬切。块内文本已去除块间空白；原文以
// 双换行重组的近似性由管线层负责（对照导出用 chunk 序号一一配对，不依赖偏移还原）。
//
// 与请求路径的对齐是本文件的硬约束：块上限公式 (ctx−896−margin)/(1.0+0.893) 的
// 两个斜率分别来自 translator.EstimateTokens（非 ASCII 1.0/字）与 §7.3 实测输出
// 膨胀 0.893 token/源字。分块器放行的块在 translator.translateMaxTokens 的钳制下
// 不得再被 max_tokens 截断——ceiling 数值由表驱动测试钉死（8K/16K/32K 三档）。
package docpipeline

import (
	"strings"

	"indexvt/internal/translator"
)

// 分块预算常数（M5 报告 §10 决策 6 / §11）。
const (
	// ChunkPromptOverhead 单块固定 prompt 开销：Nailong 模板 115 token（§7.1 实测）
	// + 术语注入余量 256（§7.11 实测 +142，留裕）。
	ChunkPromptOverhead = 371
	// ChunkOutputPerChar 输出膨胀系数：zh→en 实测 0.893 token/源字（§7.3）。
	// 其他方向（en→zh 等）输出更短，沿用 0.893 属保守高估，方向安全。
	ChunkOutputPerChar = 0.893
	// ChunkMarginTokens 分词误差与服务端余量。
	ChunkMarginTokens = 128
	// chunkPromptSlope 与 translator.EstimateTokens 的每字符斜率一致（非 ASCII 1.0）。
	chunkPromptSlope = 1.0
	// chunkMinRunes 天花板公式的下限钳制：ctx 档位最小 2048 时公式仍给出 ~637，
	// 但再小的 ctx（异常配置）也要保证能推进。
	chunkMinRunes = 256
)

// MaxChunkRunes 给定 ctx 档位的单块 rune 上限。
// 推导：请求路径 prompt 估算 = EstimateTokens(块) + 896 固定余量（translator.go），
// max_tokens 钳制 = ctx − EstimateTokens − 896；块不被截断要求
// 0.893×块 ≤ max_tokens，且 estimate+overhead 与 max_tokens 之和不触发
// exceed_context_size 400（§7.6）。解出 ceiling = (ctx − 896 − margin)/(1.0 + 0.893)。
// 术语注入预算（ChunkPromptOverhead）不进此式：请求路径的钳制按「翻译服务不可用」
// 之外的同一公式给出，overhead 已被 896 固定余量覆盖且实测注入仅 +1.0%。
func MaxChunkRunes(ctxTokens int) int {
	if ctxTokens < 1024 {
		return chunkMinRunes
	}
	ceil := int(float64(ctxTokens-896-ChunkMarginTokens) / (chunkPromptSlope + ChunkOutputPerChar))
	if ceil < chunkMinRunes {
		return chunkMinRunes
	}
	return ceil
}

// Chunk 一个翻译块。
type Chunk struct {
	Text string // 已去首尾空白的块内文本（不含块间分隔空行）
	Start int   // 源文中的起始 rune 下标（调试/对照用）
	End   int   // 结束 rune 下标（不含）
	EstTokens int
}

// ChunkText 按段落 > 句子 > 硬切的优先级切块。
// text 为空或全空白返回 nil。任何块的 rune 数 ≤ MaxChunkRunes(ctxTokens)，
// 块的 Start/End 在原文 rune 坐标上单调不减且无缝隙（分隔空白除外）。
func ChunkText(text string, ctxTokens int) []Chunk {
	maxRunes := MaxChunkRunes(ctxTokens)
	runes := []rune(text)
	if len(strings.TrimSpace(text)) == 0 {
		return nil
	}

	var chunks []Chunk
	pos := 0 // 已消费到的 rune 下标（含分隔空白）
	for pos < len(runes) {
		// 跳过块间空白
		for pos < len(runes) && isSpaceRune(runes[pos]) {
			pos++
		}
		if pos >= len(runes) {
			break
		}
		end := pos + maxRunes
		if end >= len(runes) {
			// 剩余全部装得下
			chunks = append(chunks, newChunk(runes, pos, len(runes)))
			break
		}
		// 在 (pos, end] 窗口内回找最佳边界：段落 > 句子
		cut := lastBoundary(runes, pos, end)
		chunks = append(chunks, newChunk(runes, pos, cut))
		pos = cut
	}
	return chunks
}

func newChunk(runes []rune, start, end int) Chunk {
	txt := strings.TrimSpace(string(runes[start:end]))
	return Chunk{Text: txt, Start: start, End: end, EstTokens: translator.EstimateTokens(txt)}
}

// lastBoundary 在窗口内从后往前找切割点：优先段落边界（\n），其次句读
// （。！？；…….!?!?），都找不到则硬切在 end。
// 返回值是「下一块的起点」= 边界字符之后（换行归前块结尾的空白，newChunk 会 Trim）。
func lastBoundary(runes []rune, start, end int) int {
	for i := end - 1; i > start; i-- {
		r := runes[i]
		if r == '\n' {
			return i
		}
	}
	for i := end - 1; i > start; i-- {
		if strings.ContainsRune("。！？；!?", runes[i]) {
			return i + 1
		}
	}
	return end
}

func isSpaceRune(r rune) bool {
	switch r {
	case ' ', '\t', '\n', '\r', '　', '\v', '\f':
		return true
	}
	return false
}
