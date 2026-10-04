package translator

import "unicode"

// ScriptCounts 统计文本中各文字系统的字符数。
func ScriptCounts(text string) map[string]int {
	counts := map[string]int{}
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Han, r):
			counts["Han"]++
		case unicode.Is(unicode.Hiragana, r), unicode.Is(unicode.Katakana, r):
			counts["Kana"]++
		case unicode.Is(unicode.Hangul, r):
			counts["Hangul"]++
		case unicode.Is(unicode.Cyrillic, r):
			counts["Cyrillic"]++
		case unicode.Is(unicode.Greek, r):
			counts["Greek"]++
		case unicode.Is(unicode.Arabic, r):
			counts["Arabic"]++
		case unicode.Is(unicode.Hebrew, r):
			counts["Hebrew"]++
		case unicode.Is(unicode.Devanagari, r):
			counts["Devanagari"]++
		case unicode.Is(unicode.Bengali, r):
			counts["Bengali"]++
		case unicode.Is(unicode.Tamil, r):
			counts["Tamil"]++
		case unicode.Is(unicode.Telugu, r):
			counts["Telugu"]++
		case unicode.Is(unicode.Kannada, r):
			counts["Kannada"]++
		case unicode.Is(unicode.Malayalam, r):
			counts["Malayalam"]++
		case unicode.Is(unicode.Gujarati, r):
			counts["Gujarati"]++
		case unicode.Is(unicode.Gurmukhi, r):
			counts["Gurmukhi"]++
		case unicode.Is(unicode.Oriya, r):
			counts["Oriya"]++
		case unicode.Is(unicode.Sinhala, r):
			counts["Sinhala"]++
		case unicode.Is(unicode.Thai, r):
			counts["Thai"]++
		case unicode.Is(unicode.Lao, r):
			counts["Lao"]++
		case unicode.Is(unicode.Khmer, r):
			counts["Khmer"]++
		case unicode.Is(unicode.Myanmar, r):
			counts["Myanmar"]++
		case unicode.Is(unicode.Georgian, r):
			counts["Georgian"]++
		case unicode.Is(unicode.Armenian, r):
			counts["Armenian"]++
		case unicode.Is(unicode.Ethiopic, r):
			counts["Ethiopic"]++
		case unicode.Is(unicode.Tibetan, r):
			counts["Tibetan"]++
		case unicode.Is(unicode.Thaana, r):
			counts["Thaana"]++
		case unicode.Is(unicode.Latin, r):
			counts["Latin"]++
		}
	}
	return counts
}

func dominantScript(counts map[string]int) string {
	best, bestN := "", 0
	for k, n := range counts {
		if n > bestN {
			best, bestN = k, n
		}
	}
	return best
}

// scriptMatches 期望脚本是否匹配实际主脚本。
// 日语例外：Kana 或 Han 都可能合法（汉字词）；粤语同理 Han。
func scriptMatches(expected, actual string) bool {
	if expected == actual {
		return true
	}
	if expected == "Japanese" && (actual == "Kana" || actual == "Han") {
		return true
	}
	return false
}

// DetectOffTarget off-target 粗检（01 文档 §5.3）：输出主脚本 vs 目标语言期望脚本。
// 阈值：主脚本不匹配即怀疑（2B 低资源语言官方 off-target 率 4.2%，宁报勿漏，
// UI 以"可能不是"措辞呈现）。
func DetectOffTarget(output, targetLang string) bool {
	tl, ok := LangByCode(targetLang)
	if !ok {
		return false
	}
	counts := ScriptCounts(output)
	if len(counts) == 0 {
		return false // 无文字符号（纯数字/符号）不判
	}
	actual := dominantScript(counts)
	return !scriptMatches(tl.Script, actual)
}

// DetectSourceLang auto 检测（F-02：auto 徽标显示 Detected·中文）。
// 按主脚本映射默认语言；拉丁脚本保守返回 en。
func DetectSourceLang(text string) string {
	counts := ScriptCounts(text)
	dom := dominantScript(counts)
	switch dom {
	case "Han":
		// 日文文本中的汉字比例也高；有假名则判日语
		if counts["Kana"] > 0 {
			return "ja"
		}
		// 粤语特有字 heuristic（唔/嘅/咗/啲/冇）
		for _, r := range []rune("唔嘅咗啲冇喺咁") {
			if countsHanRune(text, r) > 0 {
				return "yue_Hani"
			}
		}
		return "zh"
	case "Kana":
		return "ja"
	case "Hangul":
		return "ko"
	case "Cyrillic":
		return "ru"
	case "Greek":
		return "ell_Grek"
	case "Arabic":
		return "ar"
	case "Hebrew":
		return "heb_Hebr"
	case "Devanagari":
		return "hi"
	case "Bengali":
		return "ben_Beng"
	case "Tamil":
		return "tam_Taml"
	case "Telugu":
		return "tel_Telu"
	case "Kannada":
		return "kan_Knda"
	case "Malayalam":
		return "mal_Mlym"
	case "Gujarati":
		return "guj_Gujr"
	case "Gurmukhi":
		return "pan_Guru"
	case "Sinhala":
		return "sin_Sinh"
	case "Thai":
		return "th"
	case "Lao":
		return "lao_Laoo"
	case "Khmer":
		return "khm_Khmr"
	case "Myanmar":
		return "mya_Mymr"
	case "Georgian":
		return "kat_Geor"
	case "Armenian":
		return "hye_Armn"
	case "Ethiopic":
		return "amh_Ethi"
	case "Tibetan":
		return "bod_Tibt"
	case "Thaana":
		return "div_Thaa"
	default:
		return "en"
	}
}

func countsHanRune(text string, target rune) int {
	n := 0
	for _, r := range text {
		if r == target {
			n++
		}
	}
	return n
}
