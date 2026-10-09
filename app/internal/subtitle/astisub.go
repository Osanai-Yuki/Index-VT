package subtitle

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/asticode/go-astisub"
)

func sscanfImpl(s, format string, args ...any) (int, error) {
	return fmt.Sscanf(s, format, args...)
}

// ============================================================================
// astisub 适配层（SRT/VTT/ASS 序列化 + ASS 样式保真层，ADR-007）
// ============================================================================

// assOverrideTagRe ASS 覆写标签（02 文档 §11.2）：{\i1} 等，翻译前剥离译后回填。
var assOverrideTagRe = regexp.MustCompile(`\{\\[^}]*\}`)

// StripOverrideTags 剥离 ASS 覆写标签，返回纯文本与标签序列（按出现顺序）。
func StripOverrideTags(text string) (string, []string) {
	var tags []string
	clean := assOverrideTagRe.ReplaceAllStringFunc(text, func(m string) string {
		tags = append(tags, m)
		return ""
	})
	return clean, tags
}

// ReinsertOverrideTags 按序回填标签到译文的换行分段（按段落顺序均匀回填）。
// 标签数与译文段数不匹配时（模型输出损坏）丢弃标签 → needsCheck（02 文档 §11.2）。
func ReinsertOverrideTags(translated string, tags []string) (string, bool) {
	if len(tags) == 0 {
		return translated, false
	}
	// 先试按行边界回填：标签按原位置语义通常在一行行首
	lines := strings.Split(translated, "\n")
	if len(lines) == len(tags) {
		var b strings.Builder
		for i, ln := range lines {
			b.WriteString(tags[i])
			b.WriteString(ln)
			if i < len(lines)-1 {
				b.WriteString("\n")
			}
		}
		return b.String(), false
	}
	// 行数不匹配但只有 1 个标签：回填到行首
	if len(tags) == 1 && len(lines) > 0 {
		return tags[0] + translated, false
	}
	// 标签数变化：丢弃标签并标记需人工检查
	return translated, true
}

// parseASS 解析 ASS：cue 从原始 Dialogue 行捕获（astisub 会把 {\i1} 内联覆写
// 标签吞进 InlineStyle 且写出时丢失——ADR-007 预警场景，此处以自捕获层保真）；
// astisub 仅作结构校验（不通过则报错）。
// 另捕获样式段头与样式 Format 行原文（stylesSection/stylesFormat），供序列化
// 原样回写：v4.00 SSA 的字段数与 V4+ 不同，强推 V4+ Format 会让播放器错位（B26）。
func parseASS(text string) (cues []Cue, styles []StyleDef, headerLines, eventsFormat []string, stylesSection, stylesFormat string, err error) {
	if _, aerr := astisub.ReadFromSSA(strings.NewReader(text)); aerr != nil {
		return nil, nil, nil, nil, "", "", aerr
	}
	// 自捕获：逐行扫描原始段
	section := ""
	var eventFields []string
	var styleFieldIdx map[string]int
	type rawDlg struct {
		startMs, endMs int64
		style, text    string
	}
	var dialogs []rawDlg
	for _, ln := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(ln)
		switch {
		case strings.HasPrefix(trimmed, "["):
			section = trimmed
			continue
		case trimmed == "" || strings.HasPrefix(trimmed, ";"):
			continue
		}
		switch section {
		case "[Script Info]":
			headerLines = append(headerLines, ln)
		case "[V4+ Styles]", "[V4 Styles]":
			if strings.HasPrefix(trimmed, "Style:") {
				styles = append(styles, parseStyleLine(trimmed))
			}
			if strings.HasPrefix(trimmed, "Format:") {
				styleFieldIdx = assFieldIndex(strings.TrimPrefix(trimmed, "Format:"))
				stylesSection = section // 段头原文（[V4 Styles] / [V4+ Styles]）
				stylesFormat = trimmed  // Format 行原文（字段数保真）
			}
		case "[Events]":
			if strings.HasPrefix(trimmed, "Format:") {
				eventsFormat = append(eventsFormat, trimmed)
				eventFields = assFieldNames(strings.TrimPrefix(trimmed, "Format:"))
				continue
			}
			if strings.HasPrefix(trimmed, "Dialogue:") && len(eventFields) > 0 {
				body := strings.TrimPrefix(trimmed, "Dialogue:")
				// Text 为最后字段，可含逗号
				parts := strings.SplitN(body, ",", len(eventFields))
				if len(parts) != len(eventFields) {
					continue
				}
				get := func(name string) string {
					for i, f := range eventFields {
						if strings.EqualFold(strings.TrimSpace(f), name) {
							return strings.TrimSpace(parts[i])
						}
					}
					return ""
				}
				start, err1 := parseASSTime(get("Start"))
				end, err2 := parseASSTime(get("End"))
				if err1 != nil || err2 != nil {
					continue
				}
				// ASS 换行标记转真实换行；解析与序列化必须严格互逆（B26）
				// ——否则多行 cue 会被当成一行送翻，换行位置丢失。
				rawText := get("Text")
				rawText = strings.ReplaceAll(rawText, `\N`, "\n")
				rawText = strings.ReplaceAll(rawText, `\n`, "\n")
				rawText = strings.ReplaceAll(rawText, `\h`, " ") // 硬空格
				dialogs = append(dialogs, rawDlg{
					startMs: start, endMs: end,
					style: get("Style"), text: rawText,
				})
			}
		}
	}
	_ = styleFieldIdx
	for _, d := range dialogs {
		cues = append(cues, Cue{
			StartMs:   d.startMs,
			EndMs:     d.endMs,
			Original:  d.text, // 原始文本（含覆写标签，02 文档 §11.2）
			StyleName: d.style,
			State:     CuePending,
		})
	}
	return cues, styles, headerLines, eventsFormat, stylesSection, stylesFormat, nil
}

func assFieldNames(formatArg string) []string {
	var names []string
	for _, f := range strings.Split(formatArg, ",") {
		names = append(names, strings.TrimSpace(f))
	}
	return names
}

func assFieldIndex(formatArg string) map[string]int {
	idx := map[string]int{}
	for i, f := range assFieldNames(formatArg) {
		idx[strings.ToLower(f)] = i
	}
	return idx
}

// parseASSTime "0:01:02.34"（H 可 1-2 位，.cc 两位厘秒）→ 毫秒。
func parseASSTime(s string) (int64, error) {
	var h, m, sec, cc int
	if n, err := fmtSscanf(s, "%d:%d:%d.%d", &h, &m, &sec, &cc); err != nil || n != 4 {
		return 0, fmt.Errorf("ASS 时间格式异常: %q", s)
	}
	return int64(h)*3600000 + int64(m)*60000 + int64(sec)*1000 + int64(cc)*10, nil
}

func fmtSscanf(s, format string, args ...any) (int, error) {
	return sscanfImpl(s, format, args...)
}

// serializeAstisub SRT/VTT/ASS 序列化（含双语合成）。
func (e *Engine) serializeAstisub(doc *SubtitleDoc, opt ExportOptions) ([]byte, error) {
	return e.serializeAstisubOpt(doc, opt.Format, opt.Bilingual, false)
}

// serializeAstisubWithText 指定使用原文内容（keep-original 原文另存用）。
func (e *Engine) serializeAstisubWithText(doc *SubtitleDoc, format Format, useOriginal bool) ([]byte, error) {
	return e.serializeAstisubOpt(doc, format, BilingualTranslationOnly, useOriginal)
}

func (e *Engine) serializeAstisubOpt(doc *SubtitleDoc, format Format, bilingual BilingualMode, useOriginal bool) ([]byte, error) {
	cues := append([]Cue(nil), doc.Cues...)
	sortCues(cues)
	sub := astisub.NewSubtitles()
	// dialogueTexts 与 cues 同序：ASS 自绘 [Events] 段时按原 Format 字段重排（B26）
	dialogueTexts := make([]string, 0, len(cues))
	for _, c := range cues {
		mainText := c.Translated
		if useOriginal || mainText == "" {
			mainText = c.Original
		}
		switch bilingual {
		case BilingualDualLine:
			if c.Translated != "" && c.Original != "" {
				// 原文上、译文下（02 文档 §11.5）
				mainText = c.Original + "\n" + c.Translated
			}
		case BilingualKeepOriginal, BilingualTranslationOnly:
			// 仅译文（keep-original 的"原文另存"由 Export 另写一个文件）
		}
		if format == FormatASS {
			// ASS 用字面 \N 表示换行：解析侧 \N→"\n" 的逆变换（B26）。
			// 须在 textToLines 之前完成，多行合成单段由写出端原样输出。
			mainText = strings.ReplaceAll(mainText, "\n", `\N`)
		}
		dialogueTexts = append(dialogueTexts, mainText)
		item := &astisub.Item{
			StartAt: time.Duration(c.StartMs) * time.Millisecond,
			EndAt:   time.Duration(c.EndMs) * time.Millisecond,
			Lines:   textToLines(mainText),
		}
		if c.StyleName != "" {
			st := sub.Styles[c.StyleName]
			if st == nil {
				// astisub WriteToSSA 直接解引用 InlineStyle，空样式需占位
				st = &astisub.Style{ID: c.StyleName, InlineStyle: &astisub.StyleAttributes{}}
				sub.Styles[c.StyleName] = st
			}
			item.Style = st
		}
		sub.Items = append(sub.Items, item)
	}

	var buf bytes.Buffer
	var err error
	switch format {
	case FormatASS:
		err = sub.WriteToSSA(&buf)
		if err == nil && doc.Format == FormatASS && len(doc.HeaderLines) > 0 {
			var events []string
			if len(doc.EventsLines) > 0 {
				events = assDialogueLines(cues, dialogueTexts, doc.EventsLines[0])
			}
			out := patchASSHeaders(buf.Bytes(), doc, events)
			return []byte(out), nil
		}
	case FormatVTT:
		err = sub.WriteToWebVTT(&buf)
	case FormatSRT, "":
		err = sub.WriteToSRT(&buf)
		if err == nil {
			// 默认 UTF-8 无 BOM（02 文档 §11.6）：astisub SRT 写出器自带 BOM，剥离
			return bytes.TrimPrefix(buf.Bytes(), astisub.BytesBOM), nil
		}
	default:
		return nil, fmt.Errorf("不支持的格式 %s", format)
	}
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// textToLines 文本 → astisub 行（\n 分行）。
func textToLines(text string) []astisub.Line {
	var lines []astisub.Line
	for _, ln := range strings.Split(text, "\n") {
		if ln == "" {
			continue
		}
		lines = append(lines, astisub.Line{Items: []astisub.LineItem{{Text: ln}}})
	}
	if len(lines) == 0 {
		lines = append(lines, astisub.Line{Items: []astisub.LineItem{{Text: " "}}})
	}
	return lines
}

// assStylesFormatDefault V4+ 样式段默认 Format 行（原始行缺失时，如新建/转换文档）。
const assStylesFormatDefault = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"

// assDialogueLines 按原始 [Events] Format 的字段顺序生成 Dialogue 行（B26 保真：
// 字段数必须与原 Format 行严格一致，否则播放器按错误字段数解析）。texts 与 cues 同序。
func assDialogueLines(cues []Cue, texts []string, eventsFormatLine string) []string {
	fields := assFieldNames(strings.TrimPrefix(eventsFormatLine, "Format:"))
	lines := make([]string, 0, len(cues))
	for i, c := range cues {
		parts := make([]string, 0, len(fields))
		for _, f := range fields {
			switch strings.ToLower(f) {
			case "marked":
				parts = append(parts, "Marked=0")
			case "layer", "marginl", "marginr", "marginv":
				parts = append(parts, "0")
			case "start":
				parts = append(parts, formatASSTime(c.StartMs))
			case "end":
				parts = append(parts, formatASSTime(c.EndMs))
			case "style":
				parts = append(parts, c.StyleName)
			case "text":
				parts = append(parts, texts[i])
			default: // name / effect / 未知字段
				parts = append(parts, "")
			}
		}
		lines = append(lines, "Dialogue: "+strings.Join(parts, ","))
	}
	return lines
}

// formatASSTime 毫秒 → "HH:MM:SS.cc"（与 astisub 写出格式一致，2 位小时/厘秒）。
func formatASSTime(ms int64) string {
	h := ms / 3600000
	m := (ms % 3600000) / 60000
	s := (ms % 60000) / 1000
	cs := (ms % 1000) / 10
	return fmt.Sprintf("%02d:%02d:%02d.%02d", h, m, s, cs)
}

// patchASSHeaders 用自捕获的 [Script Info]、[V4/V4+ Styles] 与 [Events] 原文替换
// astisub 输出的对应段（B26 保真）：ScriptType、样式段头、两处 Format 行与字段数
// 一律沿用原文；仅当原始行缺失（新建文档 / 格式转换）才生成 V4+ 默认。
// dialogueLines 为按原 Events Format 生成的 Dialogue 行；为空时保留 astisub 的 [Events] 段
// （其 Format 行与 Dialogue 行自洽）。
func patchASSHeaders(out []byte, doc *SubtitleDoc, dialogueLines []string) string {
	s := string(out)
	eventsIdx := strings.Index(s, "[Events]")
	if eventsIdx < 0 {
		// 无 Events 段（异常）：仅替换头部
		eventsIdx = len(s)
	}
	eventsPart := s[eventsIdx:]

	stylesSection := doc.StylesSection
	if stylesSection == "" {
		stylesSection = "[V4+ Styles]"
	}
	stylesFormat := doc.StylesFormat
	if stylesFormat == "" {
		stylesFormat = assStylesFormatDefault
	}

	var b strings.Builder
	b.WriteString("[Script Info]\n")
	for _, ln := range doc.HeaderLines {
		b.WriteString(ln)
		b.WriteString("\n")
	}
	if len(doc.Styles) > 0 {
		b.WriteString("\n")
		b.WriteString(stylesSection)
		b.WriteString("\n")
		b.WriteString(stylesFormat)
		b.WriteString("\n")
		for _, st := range doc.Styles {
			b.WriteString(st.Raw)
			b.WriteString("\n")
		}
	}
	b.WriteString("\n")
	if len(dialogueLines) > 0 && len(doc.EventsLines) > 0 {
		b.WriteString("[Events]\n")
		b.WriteString(doc.EventsLines[0])
		b.WriteString("\n")
		for _, ln := range dialogueLines {
			b.WriteString(ln)
			b.WriteString("\n")
		}
	} else {
		b.WriteString(eventsPart)
	}
	return b.String()
}

// ============================================================================
// ASS 样式结构化解析/重建（M4 §2）
// ============================================================================

// assColorToRGB 将 ASS 颜色（&HAABBGGRR 或 &HBBGGRR）转换为 #RRGGBB。
// 未知/空值/非十六进制返回 #000000。
func assColorToRGB(ass string) string {
	h := strings.TrimSpace(strings.ToLower(ass))
	h = strings.TrimPrefix(h, "&h")
	if len(h) < 6 || !isHexString(h) {
		return "#000000"
	}
	// 末 6 位为 BBGGRR；不足 8 位时按 BBGGRR 处理
	var bb, gg, rr string
	if len(h) >= 8 {
		bb, gg, rr = h[2:4], h[4:6], h[6:8]
	} else {
		bb, gg, rr = h[0:2], h[2:4], h[4:6]
	}
	return "#" + strings.ToUpper(rr + gg + bb)
}

// isHexString 检查 s 是否仅含十六进制字符。
func isHexString(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

// rgbToAssColor 将 #RRGGBB 转换为 ASS 颜色 &H00BBGGRR（alpha 固定 00）。
// 非法值返回 &H00000000。
func rgbToAssColor(rgb string) string {
	h := strings.TrimSpace(strings.ToLower(strings.TrimPrefix(strings.TrimSpace(rgb), "#")))
	if len(h) < 6 {
		return "&H00000000"
	}
	return "&H00" + strings.ToUpper(h[4:6] + h[2:4] + h[0:2])
}

// parseStyleLine 解析 ASS Style: 行为 StyleDef。
// 字段按 V4+ 顺序（Name,FontName,FontSize,PrimaryColour,...,Alignment,...,Outline,...,MarginV,...），
// 字段数不足时只填充可用字段；未映射字段保留在 Raw。
func parseStyleLine(raw string) StyleDef {
	st := StyleDef{Name: "", Raw: raw}
	body := strings.TrimPrefix(strings.TrimSpace(raw), "Style:")
	fields := strings.Split(body, ",")
	for i := range fields {
		fields[i] = strings.TrimSpace(fields[i])
	}
	if len(fields) < 1 {
		return st
	}
	st.Name = fields[0]
	if len(fields) > 1 {
		st.FontName = fields[1]
	}
	if len(fields) > 2 {
		st.FontSize, _ = strconv.Atoi(fields[2])
	}
	if len(fields) > 3 {
		st.PrimaryRGB = assColorToRGB(fields[3])
	}
	if len(fields) > 5 {
		st.OutlineRGB = assColorToRGB(fields[5])
	}
	if len(fields) > 7 {
		st.Bold = fields[7] == "-1"
	}
	if len(fields) > 16 {
		st.Outline, _ = strconv.ParseFloat(fields[16], 64)
	}
	if len(fields) > 18 {
		st.Alignment, _ = strconv.Atoi(fields[18])
	}
	if len(fields) > 21 {
		st.MarginV, _ = strconv.Atoi(fields[21])
	}
	return st
}

// buildStyleLine 从 StyleDef 重建 ASS Style: 行。
// 以 Raw 为底：按原字段顺序替换结构化字段对应的值，未映射字段
// （SecondaryColour/BackColour/Italic/ScaleX/BorderStyle/Shadow 等）逐字保留。
// Raw 缺失或字段数不足时按 V4+ 默认补全。
func buildStyleLine(s StyleDef) string {
	if s.Raw == "" {
		return fmt.Sprintf("Style: %s,%s,%d,%s,&H000000FF,%s,&H00000000,%d,0,0,0,100,100,0,0,1,%g,0,%d,10,10,10,%d,1",
			s.Name, orDefault(s.FontName, "Arial"), s.FontSize,
			rgbToAssColor(s.PrimaryRGB), rgbToAssColor(s.OutlineRGB),
			boolToInt(s.Bold), s.Outline, s.Alignment, s.MarginV)
	}
	body := strings.TrimPrefix(strings.TrimSpace(s.Raw), "Style:")
	fields := strings.Split(body, ",")
	for i := range fields {
		fields[i] = strings.TrimSpace(fields[i])
	}
	set := func(idx int, val string) {
		for len(fields) <= idx {
			fields = append(fields, "")
		}
		fields[idx] = val
	}
	set(0, s.Name)
	set(1, s.FontName)
	set(2, strconv.Itoa(s.FontSize))
	set(3, rgbToAssColor(s.PrimaryRGB))
	set(5, rgbToAssColor(s.OutlineRGB))
	set(7, strconv.Itoa(boolToInt(s.Bold)))
	set(16, strconv.FormatFloat(s.Outline, 'f', -1, 64))
	set(18, strconv.Itoa(s.Alignment))
	set(21, strconv.Itoa(s.MarginV))
	return "Style: " + strings.Join(fields, ",")
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func boolToInt(b bool) int {
	if b {
		return -1
	}
	return 0
}
