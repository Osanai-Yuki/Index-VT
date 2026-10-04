package translator

import (
	"encoding/json"
	"strings"
)

// ============================================================================
// Translate prompt 构造器 —— 逐字移植官方 bilibili/Index-Translate
// inference/llm/translate.py 的 trans_prompt()（官方源文件已 vendor 至
// testdata/official/translate.py；01 文档 §4 为其转录）。
// ============================================================================

// GlossaryItem 术语对。
type GlossaryItem struct {
	Term        string `json:"term"`
	Translation string `json:"translation"`
}

// Constraints 约束集合（主翻译台约束抽屉，M2 仅保留接口位，M3 启用 UI）。
type Constraints struct {
	Glossary []GlossaryItem // -g
	Hard     []string       // -H 硬约束行（不含【硬性要求】前缀）
	Soft     []string       // -S 软约束行（不含【注意】前缀）
	Genre    string         // -d 文体域（默认"文本"）
	// JSONPreserve 开启且输入为 JSON dict 时追加官方 JSON 硬约束
	JSONPreserve bool
}

// genreDefault 官方默认文体（translate.py --genre 默认 "文本"）。
const genreDefault = "文本"

// parseGlossaryTerms 官方 parse_glossary_terms 的 Go 移植：
// 输出统一为 "term→target" 形式列表（全角箭头，官方原文）。
func parseGlossaryTerms(items []GlossaryItem) []string {
	var out []string
	for _, it := range items {
		k := strings.TrimSpace(it.Term)
		v := strings.TrimSpace(it.Translation)
		if k == "" || v == "" {
			continue
		}
		out = append(out, k+"→"+v)
	}
	return out
}

// isJSONDict 官方 is_json 判定：strip 后以 { 开头 } 结尾且 json.loads 为 dict。
func isJSONDict(text string) bool {
	stripped := strings.TrimSpace(text)
	if !strings.HasPrefix(stripped, "{") || !strings.HasSuffix(stripped, "}") {
		return false
	}
	var obj map[string]any
	return json.Unmarshal([]byte(stripped), &obj) == nil
}

// jsonSuffix 官方 JSON 输出指令原文（translate.py 内 suffix 变量）。
const jsonSuffix = "请以相同的 JSON 格式输出翻译结果，key 保持不变，value 为对应译文。只输出 JSON，不要有任何额外说明。"

// plainSuffix 官方普通输出指令原文。
const plainSuffix = "只输出译文，不要有任何额外说明。"

// BuildTranslatePrompt 官方 trans_prompt 的 Go 移植（逐字一致）。
//
// sourceLang 为官方语言码（如 zh/en）；"auto"/"" 时省略源语言；
// targetLang 同。约束全空时走无约束模板。
func BuildTranslatePrompt(text, sourceLang, targetLang string, c *Constraints) string {
	if c == nil {
		c = &Constraints{}
	}
	text = strings.TrimSpace(text)
	tgtName := LangName(targetLang)
	hasSource := sourceLang != "" && !strings.EqualFold(sourceLang, "auto")
	srcName := ""
	if hasSource {
		srcName = LangName(sourceLang)
	}

	// 1. 硬约束（官方顺序：hard → glossary → soft → instruction）
	var constraints []string
	for _, h := range c.Hard {
		line := strings.TrimSpace(h)
		if line == "" {
			continue
		}
		line = stripNumbering(line)
		if !strings.HasPrefix(line, "【硬性要求】") {
			line = "【硬性要求】" + line
		}
		constraints = append(constraints, line)
	}
	if terms := parseGlossaryTerms(c.Glossary); len(terms) > 0 {
		constraints = append(constraints, "【硬性要求】专名/术语对照: "+strings.Join(terms, "、"))
	}
	for _, s := range c.Soft {
		line := strings.TrimSpace(s)
		if line == "" {
			continue
		}
		line = stripNumbering(line)
		if !(strings.HasPrefix(line, "【注意】") || strings.HasPrefix(line, "【软性要求】")) {
			line = "【注意】" + line
		}
		constraints = append(constraints, line)
	}
	if c.JSONPreserve && isJSONDict(text) {
		constraints = append(constraints, "【硬性要求】仅翻译键值内容，严格保留合法 JSON 语法格式与键名")
	}
	if len(constraints) == 0 {
		// 无约束：官方 plain 分支（\n\n 分隔，text.strip()）
		if srcName != "" {
			return "请将以下" + srcName + "文本翻译为" + tgtName + "，直接输出翻译结果，不要进行任何解释。\n\n" + text
		}
		return "请将以下文本翻译为" + tgtName + "，直接输出翻译结果，不要进行任何解释。\n\n" + text
	}

	// 2. instTrans 分支（官方 header_src：有源语言=src+genre，否则 genre）
	genre := c.Genre
	if strings.TrimSpace(genre) == "" {
		genre = genreDefault
	}
	headerSrc := genre
	if srcName != "" {
		headerSrc = srcName + genre
	}
	header := "请将以下" + headerSrc + "翻译成" + tgtName + "，并且严格遵循所有约束要求。"
	reqLines := make([]string, len(constraints))
	for i, ln := range constraints {
		reqLines[i] = itoa(i+1) + ". " + ln
	}
	suffix := plainSuffix
	if c.JSONPreserve && isJSONDict(text) && anyContains(constraints, "JSON", "json") {
		suffix = jsonSuffix
	}
	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n\n【源文】\n")
	b.WriteString(text)
	b.WriteString("\n\n【约束要求】\n")
	b.WriteString(strings.Join(reqLines, "\n"))
	b.WriteString("\n\n")
	b.WriteString(suffix)
	return b.String()
}

func anyContains(list []string, subs ...string) bool {
	for _, s := range list {
		for _, sub := range subs {
			if strings.Contains(s, sub) {
				return true
			}
		}
	}
	return false
}

// stripNumbering 官方 line.strip().lstrip("0123456789. ") 语义。
func stripNumbering(line string) string {
	line = strings.TrimSpace(line)
	for len(line) > 0 {
		r := rune(line[0])
		if (r >= '0' && r <= '9') || r == '.' || r == ' ' {
			line = line[1:]
			continue
		}
		break
	}
	return strings.TrimSpace(line)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
