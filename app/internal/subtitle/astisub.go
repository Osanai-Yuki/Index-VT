package subtitle

import (
	"bytes"
	"fmt"
	"regexp"
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
func parseASS(text string) (cues []Cue, styles []StyleDef, headerLines, eventsFormat []string, err error) {
	if _, aerr := astisub.ReadFromSSA(strings.NewReader(text)); aerr != nil {
		return nil, nil, nil, nil, aerr
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
				name := strings.TrimSpace(strings.SplitN(strings.TrimPrefix(trimmed, "Style:"), ",", 2)[0])
				styles = append(styles, StyleDef{Name: name, Raw: trimmed})
			}
			if strings.HasPrefix(trimmed, "Format:") {
				styleFieldIdx = assFieldIndex(strings.TrimPrefix(trimmed, "Format:"))
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
				dialogs = append(dialogs, rawDlg{
					startMs: start, endMs: end,
					style: get("Style"), text: get("Text"),
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
	return cues, styles, headerLines, eventsFormat, nil
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
			out := patchASSHeaders(buf.Bytes(), doc)
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

// patchASSHeaders 用自捕获的 [Script Info] 与 [V4+ Styles] 原文替换
// astisub 输出的对应段；[Events] 段保持 astisub 原样（其 Format 行与
// Dialogue 行自洽，VLC 兼容）。
func patchASSHeaders(out []byte, doc *SubtitleDoc) string {
	s := string(out)
	eventsIdx := strings.Index(s, "[Events]")
	if eventsIdx < 0 {
		// 无 Events 段（异常）：仅替换头部
		eventsIdx = len(s)
	}
	eventsPart := s[eventsIdx:]

	var b strings.Builder
	b.WriteString("[Script Info]\n")
	for _, ln := range doc.HeaderLines {
		b.WriteString(ln)
		b.WriteString("\n")
	}
	if len(doc.Styles) > 0 {
		b.WriteString("\n[V4+ Styles]\n")
		b.WriteString("Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
		for _, st := range doc.Styles {
			b.WriteString(st.Raw)
			b.WriteString("\n")
		}
	}
	b.WriteString("\n")
	b.WriteString(eventsPart)
	return b.String()
}
