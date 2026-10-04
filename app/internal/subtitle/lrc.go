package subtitle

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// LRC 自研解析/序列化（ADR-007：astisub 无 LRC 支持）。
// 行格式 [mm:ss.xx]文本；无结束时间——按下一行起始推算，
// 末条结束 = start + 5s（约定值，UI 注明，02 文档 §11.3）。

var lrcLineRe = regexp.MustCompile(`^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\](.*)$`)
var lrcTagRe = regexp.MustCompile(`^\[(ar|ti|al|by|offset|re|ve|length):(.*)\]$`)

// parseLRC 解析 LRC 行（支持一行多时间标签 [00:01.00][00:05.00]text）。
func parseLRC(text string) ([]Cue, error) {
	type rawCue struct {
		startMs int64
		text    string
	}
	var raws []rawCue
	offsetMs := int64(0)
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if m := lrcTagRe.FindStringSubmatch(line); m != nil {
			if m[1] == "offset" {
				// LRC offset：正值提前（时间减），负值延后
				if v, err := strconv.ParseInt(strings.TrimSpace(m[2]), 10, 64); err == nil {
					offsetMs = -v
				}
			}
			continue
		}
		// 一行可能有多个时间标签
		rest := line
		var stamps []int64
		for {
			m := lrcLineRe.FindStringSubmatch(rest)
			if m == nil {
				break
			}
			min, _ := strconv.ParseInt(m[1], 10, 64)
			sec, _ := strconv.ParseInt(m[2], 10, 64)
			var ms int64
			if m[3] != "" {
				frac := m[3]
				msv, _ := strconv.ParseInt(frac, 10, 64)
				switch len(frac) {
				case 1:
					ms = msv * 100
				case 2:
					ms = msv * 10
				default:
					ms = msv
				}
			}
			stamps = append(stamps, min*60000+sec*1000+ms)
			rest = m[4]
			if strings.TrimSpace(rest) == "" && len(stamps) > 0 {
				break
			}
			if !strings.Contains(rest, "]") {
				break
			}
		}
		if len(stamps) == 0 {
			continue
		}
		for _, st := range stamps {
			start := st + offsetMs
			if start < 0 {
				start = 0 // offset 位移后可能为负 → 钳到 0，cue 起始不得为负（B28）
			}
			raws = append(raws, rawCue{startMs: start, text: strings.TrimSpace(rest)})
		}
	}
	sort.SliceStable(raws, func(i, j int) bool { return raws[i].startMs < raws[j].startMs })
	cues := make([]Cue, 0, len(raws))
	for i, r := range raws {
		var end int64
		if i+1 < len(raws) && raws[i+1].startMs > r.startMs {
			end = raws[i+1].startMs - 1 // 下一条 start − 1ms（02 文档 §11.3）
		} else {
			end = r.startMs + 5000 // 末条 +5s 约定
		}
		cues = append(cues, Cue{StartMs: r.startMs, EndMs: end, Original: r.text, State: CuePending})
	}
	return cues, nil
}

// serializeLRC 导出 LRC，按双语模式真正分支（B28）：
//   - DualLine：LRC 无双行标准，同一时间标签内嵌换行「原文\n译文」；
//   - TranslationOnly / KeepOriginal：译文替换（keep-original 的「原文另存 .lrc.orig」
//     由 ExportOriginal 负责，主文件为译文，app.go 出口注释与 02 文档 §11.5 一致）。
func (e *Engine) serializeLRC(doc *SubtitleDoc, opt ExportOptions) ([]byte, error) {
	cues := append([]Cue(nil), doc.Cues...)
	sortCues(cues)
	var b strings.Builder
	b.WriteString("[re:Index-VT]\n")
	for _, c := range cues {
		text := c.Original
		switch opt.Bilingual {
		case BilingualDualLine:
			if c.Translated != "" && c.Original != "" {
				text = c.Original + "\n" + c.Translated
			}
		case BilingualTranslationOnly, BilingualKeepOriginal:
			if c.Translated != "" {
				text = c.Translated
			}
		default:
			// 未指定/未知模式：有译文用译文，否则回退原文（兼容旧行为）
			if c.Translated != "" {
				text = c.Translated
			}
		}
		start := c.StartMs
		if start < 0 {
			start = 0 // 兜底：手工构造/旧快照的负时间戳不得进入导出（B28）
		}
		b.WriteString(fmt.Sprintf("[%s]%s\n", lrcTime(start), text))
	}
	return []byte(b.String()), nil
}

func lrcTime(ms int64) string {
	m := ms / 60000
	s := (ms % 60000) / 1000
	cs := (ms % 1000) / 10
	return fmt.Sprintf("%02d:%02d.%02d", m, s, cs)
}
