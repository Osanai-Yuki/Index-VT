package subtitle

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// ============================================================================
// SRT / VTT 自研轻解析（保真时间格式与 cue 边界），序列化走 astisub。
// 相比直接用 astisub 读取：减少行内样式标签被改写导致的文本位移，
// 时间格式规则按 02 文档 §11.3 严格处理（SRT 逗号毫秒 / VTT 点毫秒截断到 ms）。
// ============================================================================

var srtTimeRe = regexp.MustCompile(`^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$`)

func parseSRTTime(s string) (int64, error) {
	m := srtTimeRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("时间格式异常: %q", s)
	}
	h, _ := strconv.ParseInt(m[1], 10, 64)
	mi, _ := strconv.ParseInt(m[2], 10, 64)
	sec, _ := strconv.ParseInt(m[3], 10, 64)
	msStr := m[4] + strings.Repeat("0", 4-len(m[4])) // 补齐毫秒（容忍 1-3 位）
	ms, _ := strconv.ParseInt(msStr[:3], 10, 64)
	return h*3600000 + mi*60000 + sec*1000 + ms, nil
}

var cueTimeLineRe = regexp.MustCompile(`^\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*(.*)$`)

func parseSRT(text string) ([]Cue, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var cues []Cue
	i := 0
	for i < len(lines) {
		// 跳过空行
		if strings.TrimSpace(lines[i]) == "" {
			i++
			continue
		}
		// 序号行（可缺省）
		if _, err := strconv.Atoi(strings.TrimSpace(lines[i])); err == nil {
			i++
		}
		if i >= len(lines) {
			break
		}
		m := cueTimeLineRe.FindStringSubmatch(lines[i])
		if m == nil {
			// 容错：跳过无法识别的行
			i++
			continue
		}
		start, err1 := parseSRTTime(m[1])
		end, err2 := parseSRTTime(m[2])
		if err1 != nil || err2 != nil {
			i++
			continue
		}
		i++
		var textLines []string
		for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
			textLines = append(textLines, lines[i])
			i++
		}
		cues = append(cues, Cue{
			StartMs: start, EndMs: end,
			Original: strings.Join(textLines, "\n"),
			State:    CuePending,
		})
	}
	return cues, nil
}

// parseVTT：跳过 WEBVTT 头、NOTE/STYLE/REGION 块；时间为点毫秒（截断到 ms）。
func parseVTT(text string) ([]Cue, error) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	var cues []Cue
	i := 0
	// 头部
	for i < len(lines) && !cueTimeLineRe.MatchString(lines[i]) {
		i++
	}
	for i < len(lines) {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			i++
			continue
		}
		if strings.HasPrefix(line, "NOTE") || strings.HasPrefix(line, "STYLE") || strings.HasPrefix(line, "REGION") {
			// 跳过整个块
			for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
				i++
			}
			continue
		}
		// cue 标识行（可缺省）
		if !cueTimeLineRe.MatchString(lines[i]) {
			i++
			continue
		}
		m := cueTimeLineRe.FindStringSubmatch(lines[i])
		start, err1 := parseSRTTime(m[1])
		end, err2 := parseSRTTime(m[2])
		if err1 != nil || err2 != nil {
			i++
			continue
		}
		i++
		var textLines []string
		for i < len(lines) && strings.TrimSpace(lines[i]) != "" {
			textLines = append(textLines, lines[i])
			i++
		}
		cues = append(cues, Cue{
			StartMs: start, EndMs: end,
			Original: strings.Join(textLines, "\n"),
			State:    CuePending,
		})
	}
	return cues, nil
}
