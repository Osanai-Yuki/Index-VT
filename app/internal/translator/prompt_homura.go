package translator

import "strings"

// ============================================================================
// Homura prompt 构造器 —— 逐字移植官方 inference/llm/syllable_translate.py
// 的 syl_prompt()（01 文档 §4.2）。
// ============================================================================

// BuildHomuraPrompt 官方 syl_prompt 的 Go 移植。
// glossary 为空时省略"要求"子句（官方分支）；术语格式 "k -> v"、", " 连接。
func BuildHomuraPrompt(text, targetLang string, syllables int, glossary []GlossaryItem) string {
	text = strings.TrimSpace(text)
	langName := LangName(targetLang)
	base := "请将以下文本翻译为" + langName + "，译文严格控制在 " + itoa(syllables) + " 个音节。"
	formatted := formatHomuraGlossary(glossary)
	if formatted != "" {
		return base + "要求：严格遵守术语映射表【" + formatted + "】。直接输出翻译结果，不要进行任何解释。\n\n" + text
	}
	return base + "直接输出翻译结果，不要进行任何解释。\n\n" + text
}

// formatHomuraGlossary 官方 parse_glossary 的输出格式："k -> v, k2 -> v2"。
func formatHomuraGlossary(items []GlossaryItem) string {
	var parts []string
	for _, it := range items {
		k := strings.TrimSpace(it.Term)
		v := strings.TrimSpace(it.Translation)
		if k == "" || v == "" {
			continue
		}
		parts = append(parts, k+" -> "+v)
	}
	return strings.Join(parts, ", ")
}

// HomuraMaxTokens 官方 max_tokens 计算：max(512, 3×字符数)（01 文档 §4.2）。
func HomuraMaxTokens(text string) int {
	n := len([]rune(strings.TrimSpace(text))) * 3
	if n < 512 {
		return 512
	}
	return n
}

// ============================================================================
// Nailong prompt 构造器 —— 官方 inference/llm/doc_translate.py 的 render_prompt：
// 按方向加载固定模板，占位标记替换为完整原文（01 文档 §4.3）。
// ============================================================================

// Nailong 方向（官方 DIRECTIONS）。
type NailongDirection string

const (
	DirZhEn NailongDirection = "zh-en"
	DirEnZh NailongDirection = "en-zh"
	DirZhJa NailongDirection = "zh-ja"
	DirJaZh NailongDirection = "ja-zh"
)

// Valid 校验方向。
func (d NailongDirection) Valid() bool {
	switch d {
	case DirZhEn, DirEnZh, DirZhJa, DirJaZh:
		return true
	}
	return false
}

// srcWord 官方 SRC_WORD 表（占位标记内语言词）。
var srcWord = map[NailongDirection]string{
	DirZhEn: "中文", DirEnZh: "英文", DirZhJa: "中文", DirJaZh: "日文",
}

// 官方四个模板原文（inference/llm/prompts/nailong_*.txt，2026-10-04 取自
// bilibili/Index-Translate main 分支；go:embed 在 prompt_nailong_embed.go）。
// 模板占位符（官方 doc_translate.py marker 拼装规则）。
func nailongMarker(d NailongDirection) string {
	return "（在这里放入需要翻译的完整" + srcWord[d] + "原文）"
}

// BuildNailongPrompt 官方 render_prompt：模板中占位标记替换为完整原文。
// 模板必须恰好含 1 个占位符（官方 assert）。
func BuildNailongPrompt(d NailongDirection, text string) (string, error) {
	if !d.Valid() {
		return "", errUnknownDirection(d)
	}
	tmpl, err := nailongTemplate(d)
	if err != nil {
		return "", err
	}
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	text = strings.TrimSpace(text)
	if text == "" {
		return "", errEmptyText()
	}
	marker := nailongMarker(d)
	if strings.Count(tmpl, marker) != 1 {
		return "", errBadTemplate(d)
	}
	return strings.Replace(tmpl, marker, text, 1), nil
}

// nailongInjectAnchor 四方向模板共有的收尾句：固定译名注入点（M5 报告 §7.11）。
const nailongInjectAnchor = "只输出译文，不要有任何额外说明。"

// BuildNailongPromptWithGlossary 官方模板 + 固定译名注入（§7.11 (b') 实证路径）。
// 注入为【约束要求】第 4 条、插在收尾句之前，不新增占位符——「恰好 1 个占位符」
// 断言仍成立。格式逐字复刻 spike run_drift.mjs 的实证版本（竞争译名 8→0，
// 成本 +1.0% prompt token / +5.4% 耗时）：
//
//	4. 固定译名（下列词条必须逐字使用，不得改写、不得另行音译或意译）：
//	   王妃→Queen
//	   （空行）
//	只输出译文，不要有任何额外说明。
func BuildNailongPromptWithGlossary(d NailongDirection, text string, glossary []GlossaryItem) (string, error) {
	prompt, err := BuildNailongPrompt(d, text)
	if err != nil {
		return "", err
	}
	if len(glossary) == 0 {
		return prompt, nil
	}
	var b strings.Builder
	b.WriteString("4. 固定译名（下列词条必须逐字使用，不得改写、不得另行音译或意译）：\n")
	n := 0
	for _, it := range glossary {
		term := strings.TrimSpace(it.Term)
		tr := strings.TrimSpace(it.Translation)
		if term == "" || tr == "" {
			continue
		}
		b.WriteString("   " + term + "→" + tr + "\n")
		n++
	}
	if n == 0 {
		return prompt, nil
	}
	if !strings.Contains(prompt, nailongInjectAnchor) {
		return "", errBadTemplate(d) // 锚点缺失 = 模板被动过，拒绝注入
	}
	return strings.Replace(prompt, nailongInjectAnchor, b.String()+"\n"+nailongInjectAnchor, 1), nil
}
