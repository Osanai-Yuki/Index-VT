package subtitle

import (
	"strings"
	"testing"
)

// makeTestDoc 构造一个测试用字幕文档（3 条 cue，连续时间轴）。
func makeTestDoc() *SubtitleDoc {
	return &SubtitleDoc{
		ID:     "test-doc",
		Format: FormatSRT,
		Cues: []Cue{
			{Index: 1, StartMs: 0, EndMs: 1000, Original: "你好世界", Translated: "Hello world", State: CueDone},
			{Index: 2, StartMs: 1000, EndMs: 2000, Original: "今天天气不错", State: CuePending},
			{Index: 3, StartMs: 2000, EndMs: 3000, Original: "我们去散步吧", State: CuePending},
		},
	}
}

func TestUpdateCue_ChangeTime(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	ms := int64(500)
	doc, err := e.UpdateCue("test", 1, CuePatch{StartMs: &ms})
	if err != nil {
		t.Fatalf("UpdateCue failed: %v", err)
	}
	if doc.Cues[0].StartMs != 500 {
		t.Errorf("StartMs = %d, want 500", doc.Cues[0].StartMs)
	}
	if doc.Cues[0].State != CueDone {
		t.Errorf("State = %s, want done", doc.Cues[0].State)
	}
}

func TestUpdateCue_ChangeOriginal_RollbackDone(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	orig := "你好地球"
	doc, err := e.UpdateCue("test", 1, CuePatch{Original: &orig})
	if err != nil {
		t.Fatalf("UpdateCue failed: %v", err)
	}
	if doc.Cues[0].Original != "你好地球" {
		t.Errorf("Original = %s, want 你好地球", doc.Cues[0].Original)
	}
	if doc.Cues[0].State != CuePending {
		t.Errorf("State = %s, want pending", doc.Cues[0].State)
	}
}

func TestUpdateCue_IndexOutOfBounds(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	_, err := e.UpdateCue("test", 99, CuePatch{})
	if err == nil {
		t.Error("越界序号应返回错误")
	}
}

func TestUpdateCue_RejectNegativeTime(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	neg := int64(-100)
	if _, err := e.UpdateCue("test", 1, CuePatch{StartMs: &neg}); err == nil {
		t.Error("负起时间应返回错误")
	}
	if _, err := e.UpdateCue("test", 1, CuePatch{EndMs: &neg}); err == nil {
		t.Error("负止时间应返回错误")
	}
	// 拒绝后不得留下半改状态
	if got := e.docs["test"].Cues[0].StartMs; got != 0 {
		t.Errorf("StartMs = %d, want 0（拒绝后保持原值）", got)
	}
}

func TestUpdateCue_RejectEndBeforeStart(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	// cue[1] = [0, 1000]：止改到 0 之前 / 起改过止，都应拒绝
	end := int64(0)
	if _, err := e.UpdateCue("test", 1, CuePatch{EndMs: &end}); err == nil {
		t.Error("止 ≤ 起应返回错误")
	}
	start := int64(1500)
	if _, err := e.UpdateCue("test", 1, CuePatch{StartMs: &start}); err == nil {
		t.Error("起 ≥ 止应返回错误")
	}
	if got := e.docs["test"].Cues[0].EndMs; got != 1000 {
		t.Errorf("EndMs = %d, want 1000（拒绝后保持原值）", got)
	}
}

func TestUpdateCue_TextOnlyOnZeroDurationAllowed(t *testing.T) {
	// 源文件里可能有零时长条目；纯文本编辑不得被时间校验误伤
	e := NewEngine(nil)
	doc := makeTestDoc()
	doc.Cues[0].StartMs, doc.Cues[0].EndMs = 500, 500
	e.docs["test"] = doc
	orig := "改文本"
	if _, err := e.UpdateCue("test", 1, CuePatch{Original: &orig}); err != nil {
		t.Fatalf("纯文本补丁不应触发时间校验: %v", err)
	}
}

func TestSplitCue_MidPoint(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.SplitCue("test", 1, 500)
	if err != nil {
		t.Fatalf("SplitCue failed: %v", err)
	}
	if len(doc.Cues) != 4 {
		t.Fatalf("Cues count = %d, want 4", len(doc.Cues))
	}
	if doc.Cues[0].StartMs != 0 || doc.Cues[0].EndMs != 500 {
		t.Errorf("前半时间 = [%d, %d], want [0, 500]", doc.Cues[0].StartMs, doc.Cues[0].EndMs)
	}
	if doc.Cues[1].StartMs != 500 || doc.Cues[1].EndMs != 1000 {
		t.Errorf("后半时间 = [%d, %d], want [500, 1000]", doc.Cues[1].StartMs, doc.Cues[1].EndMs)
	}
}

func TestSplitCue_BoundaryReject(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	_, err := e.SplitCue("test", 1, 0)
	if err == nil {
		t.Error("拆分点 = start 应拒绝")
	}
	_, err = e.SplitCue("test", 1, 1000)
	if err == nil {
		t.Error("拆分点 = end 应拒绝")
	}
}

func TestMergeCues_Success(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.MergeCues("test", 1, 2)
	if err != nil {
		t.Fatalf("MergeCues failed: %v", err)
	}
	if len(doc.Cues) != 2 {
		t.Fatalf("Cues count = %d, want 2", len(doc.Cues))
	}
	if doc.Cues[0].StartMs != 0 || doc.Cues[0].EndMs != 2000 {
		t.Errorf("合并后时间 = [%d, %d], want [0, 2000]", doc.Cues[0].StartMs, doc.Cues[0].EndMs)
	}
}

func TestMergeCues_NonContiguous(t *testing.T) {
	e := NewEngine(nil)
	doc := &SubtitleDoc{
		ID:     "gap-doc",
		Format: FormatSRT,
		Cues: []Cue{
			{Index: 1, StartMs: 0, EndMs: 1000, Original: "A", State: CuePending},
			{Index: 2, StartMs: 1500, EndMs: 2000, Original: "B", State: CuePending},
		},
	}
	e.docs["gap-doc"] = doc
	_, err := e.MergeCues("gap-doc", 1, 2)
	if err == nil {
		t.Error("不连续条目应拒绝合并")
	}
}

func TestShiftAll_Positive(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.ShiftAll("test", 2000)
	if err != nil {
		t.Fatalf("ShiftAll failed: %v", err)
	}
	for i, c := range doc.Cues {
		want := int64(i)*1000 + 2000
		if c.StartMs != want {
			t.Errorf("Cue %d StartMs = %d, want %d", i, c.StartMs, want)
		}
	}
}

func TestShiftAll_NegativeClamp(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.ShiftAll("test", -500)
	if err != nil {
		t.Fatalf("ShiftAll failed: %v", err)
	}
	if doc.Cues[0].StartMs != 0 {
		t.Errorf("负值钳 0: StartMs = %d, want 0", doc.Cues[0].StartMs)
	}
	if !doc.Cues[0].NeedsCheck {
		t.Error("负值钳 0 应标记 needsCheck")
	}
}

func TestCalibrate_LinearMap(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.Calibrate("test", 1, 3, 100, 2100)
	if err != nil {
		t.Fatalf("Calibrate failed: %v", err)
	}
	if doc.Cues[0].StartMs != 100 {
		t.Errorf("Cue 1 StartMs = %d, want 100", doc.Cues[0].StartMs)
	}
	if doc.Cues[2].StartMs != 2100 {
		t.Errorf("Cue 3 StartMs = %d, want 2100", doc.Cues[2].StartMs)
	}
	for i, c := range doc.Cues {
		if c.NeedsCheck {
			t.Errorf("Cue %d needsCheck 应为 false", i)
		}
	}
}

func TestCalibrate_DegenerateToShift(t *testing.T) {
	e := NewEngine(nil)
	doc := &SubtitleDoc{
		ID:     "degen-doc",
		Format: FormatSRT,
		Cues: []Cue{
			{Index: 1, StartMs: 500, EndMs: 1000, Original: "A", State: CuePending},
			{Index: 2, StartMs: 500, EndMs: 1000, Original: "B", State: CuePending},
			{Index: 3, StartMs: 1000, EndMs: 1500, Original: "C", State: CuePending},
		},
	}
	e.docs["degen-doc"] = doc
	out, err := e.Calibrate("degen-doc", 1, 2, 1000, 1000)
	if err != nil {
		t.Fatalf("Calibrate failed: %v", err)
	}
	if out.Cues[0].StartMs != 1000 {
		t.Errorf("退化平移: Cue 1 StartMs = %d, want 1000", out.Cues[0].StartMs)
	}
}

func TestDeleteCues_Success(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.DeleteCues("test", []int{2})
	if err != nil {
		t.Fatalf("DeleteCues failed: %v", err)
	}
	if len(doc.Cues) != 2 {
		t.Fatalf("Cues count = %d, want 2", len(doc.Cues))
	}
	if doc.Cues[1].Original != "我们去散步吧" {
		t.Errorf("删除后第 2 条原文 = %q", doc.Cues[1].Original)
	}
}

func TestInsertCue_AtEnd(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.InsertCue("test", 3)
	if err != nil {
		t.Fatalf("InsertCue failed: %v", err)
	}
	if len(doc.Cues) != 4 {
		t.Fatalf("Cues count = %d, want 4", len(doc.Cues))
	}
	if doc.Cues[3].StartMs != 3000 || doc.Cues[3].EndMs != 5000 {
		t.Errorf("新条目时间 = [%d, %d], want [3000, 5000]", doc.Cues[3].StartMs, doc.Cues[3].EndMs)
	}
}

func TestInsertCue_AtStart(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	doc, err := e.InsertCue("test", 0)
	if err != nil {
		t.Fatalf("InsertCue failed: %v", err)
	}
	if len(doc.Cues) != 4 {
		t.Fatalf("Cues count = %d, want 4", len(doc.Cues))
	}
	if doc.Cues[0].StartMs != 0 || doc.Cues[0].EndMs != 2000 {
		t.Errorf("新条目时间 = [%d, %d], want [0, 2000]", doc.Cues[0].StartMs, doc.Cues[0].EndMs)
	}
}

func TestEdit_QueueActiveGuard(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()
	e.queueCancel["test"] = &queueCtl{cancel: func() {}, paused: make(chan struct{}, 1), resume: make(chan struct{}, 1)}
	_, err := e.UpdateCue("test", 1, CuePatch{})
	if err == nil {
		t.Error("队列进行中 UpdateCue 应返回错误")
	}
	_, err = e.SplitCue("test", 1, 500)
	if err == nil {
		t.Error("队列进行中 SplitCue 应返回错误")
	}
	_, err = e.MergeCues("test", 1, 2)
	if err == nil {
		t.Error("队列进行中 MergeCues 应返回错误")
	}
	_, err = e.ShiftAll("test", 100)
	if err == nil {
		t.Error("队列进行中 ShiftAll 应返回错误")
	}
	_, err = e.Calibrate("test", 1, 2, 100, 200)
	if err == nil {
		t.Error("队列进行中 Calibrate 应返回错误")
	}
	_, err = e.DeleteCues("test", []int{1})
	if err == nil {
		t.Error("队列进行中 DeleteCues 应返回错误")
	}
	_, err = e.InsertCue("test", 0)
	if err == nil {
		t.Error("队列进行中 InsertCue 应返回错误")
	}
	_, err = e.SetStyle("test", StyleDef{Name: "X"})
	if err == nil {
		t.Error("队列进行中 SetStyle 应返回错误")
	}
	_, err = e.AssignStyle("test", []int{1}, "X")
	if err == nil {
		t.Error("队列进行中 AssignStyle 应返回错误")
	}
}

// ---- M4 样式结构化解析/序列化 ----

func TestAssColorToRGB(t *testing.T) {
	cases := []struct{ ass, want string }{
		{"&H00FFFFFF", "#FFFFFF"},
		{"&H00000000", "#000000"},
		{"&H0000FFFF", "#FFFF00"}, // BB=00 GG=FF RR=FF → #FFFF00
		{"&HFF0000FF", "#FF0000"}, // AA=FF,BB=00,GG=00,RR=FF → #FF0000
		{"&HFFFFFF", "#FFFFFF"},   // 6 位简写
		{"", "#000000"},
		{"garbage", "#000000"},
	}
	for _, c := range cases {
		if got := assColorToRGB(c.ass); got != c.want {
			t.Errorf("assColorToRGB(%q) = %q, want %q", c.ass, got, c.want)
		}
	}
}

func TestRgbToAssColor(t *testing.T) {
	cases := []struct{ rgb, want string }{
		{"#FFFFFF", "&H00FFFFFF"},
		{"#000000", "&H00000000"},
		{"#FFFF00", "&H0000FFFF"}, // RR=FF GG=FF BB=00 → &H00 BB GG RR = 00 FF FF 00
		{"#FF00FF", "&H00FF00FF"},
		{"", "&H00000000"},
		{"bad", "&H00000000"},
	}
	for _, c := range cases {
		if got := rgbToAssColor(c.rgb); got != c.want {
			t.Errorf("rgbToAssColor(%q) = %q, want %q", c.rgb, got, c.want)
		}
	}
}

func TestParseStyleLine(t *testing.T) {
	raw := "Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1"
	st := parseStyleLine(raw)
	if st.Name != "Default" {
		t.Errorf("Name = %q, want Default", st.Name)
	}
	if st.FontName != "Arial" {
		t.Errorf("FontName = %q, want Arial", st.FontName)
	}
	if st.FontSize != 40 {
		t.Errorf("FontSize = %d, want 40", st.FontSize)
	}
	if st.PrimaryRGB != "#FFFFFF" {
		t.Errorf("PrimaryRGB = %q, want #FFFFFF", st.PrimaryRGB)
	}
	if st.OutlineRGB != "#000000" {
		t.Errorf("OutlineRGB = %q, want #000000", st.OutlineRGB)
	}
	if !st.Bold {
		t.Error("Bold = false, want true")
	}
	if st.Outline != 2 {
		t.Errorf("Outline = %v, want 2", st.Outline)
	}
	if st.Alignment != 2 {
		t.Errorf("Alignment = %d, want 2", st.Alignment)
	}
	if st.MarginV != 20 {
		t.Errorf("MarginV = %d, want 20", st.MarginV)
	}
	if st.Raw != raw {
		t.Errorf("Raw 未保留")
	}
}

func TestBuildStyleLine_Roundtrip(t *testing.T) {
	raw := "Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,20,1"
	st := parseStyleLine(raw)
	// 结构化字段修改后重建：仅改字号与对齐，其余字段逐字保留
	st.FontSize = 44
	st.Alignment = 5
	rebuilt := buildStyleLine(st)
	if !strings.Contains(rebuilt, ",44,") {
		t.Errorf("重建行未含新字号 44: %q", rebuilt)
	}
	// Alignment 在第 19 字段（索引 18）
	fields := strings.Split(strings.TrimPrefix(rebuilt, "Style:"), ",")
	if len(fields) > 18 && strings.TrimSpace(fields[18]) != "5" {
		t.Errorf("重建行 Alignment = %q, want 5", fields[18])
	}
	// 未映射字段保真：ScaleX(11)=100, BorderStyle(15)=1, Shadow(17)=0
	if len(fields) > 11 && strings.TrimSpace(fields[11]) != "100" {
		t.Errorf("ScaleX 未保留: %q", fields[11])
	}
	if len(fields) > 15 && strings.TrimSpace(fields[15]) != "1" {
		t.Errorf("BorderStyle 未保留: %q", fields[15])
	}
	if len(fields) > 17 && strings.TrimSpace(fields[17]) != "0" {
		t.Errorf("Shadow 未保留: %q", fields[17])
	}
}

func TestStyles_SetStyle_AssignStyle(t *testing.T) {
	e := NewEngine(nil)
	e.docs["test"] = makeTestDoc()

	// 初始无样式
	styles, err := e.Styles("test")
	if err != nil {
		t.Fatalf("Styles failed: %v", err)
	}
	if len(styles) != 0 {
		t.Fatalf("初始样式数 = %d, want 0", len(styles))
	}

	// SetStyle 追加
	st := StyleDef{
		Name: "Title", FontName: "Arial", FontSize: 40,
		PrimaryRGB: "#FFFFFF", OutlineRGB: "#000000", Outline: 2,
		Bold: true, Alignment: 2, MarginV: 20,
	}
	doc, err := e.SetStyle("test", st)
	if err != nil {
		t.Fatalf("SetStyle failed: %v", err)
	}
	if len(doc.Styles) != 1 {
		t.Fatalf("样式数 = %d, want 1", len(doc.Styles))
	}
	if doc.Styles[0].Name != "Title" {
		t.Errorf("样式名 = %q, want Title", doc.Styles[0].Name)
	}
	if doc.Styles[0].Raw == "" {
		t.Error("Raw 未重建")
	}

	// SetStyle upsert（改）
	st.FontSize = 48
	doc, err = e.SetStyle("test", st)
	if err != nil {
		t.Fatalf("SetStyle upsert failed: %v", err)
	}
	if len(doc.Styles) != 1 {
		t.Fatalf("upsert 后样式数 = %d, want 1", len(doc.Styles))
	}
	if doc.Styles[0].FontSize != 48 {
		t.Errorf("upsert 后 FontSize = %d, want 48", doc.Styles[0].FontSize)
	}

	// AssignStyle 指派
	doc, err = e.AssignStyle("test", []int{1, 2}, "Title")
	if err != nil {
		t.Fatalf("AssignStyle failed: %v", err)
	}
	if doc.Cues[0].StyleName != "Title" || doc.Cues[1].StyleName != "Title" {
		t.Errorf("指派失败: %q, %q", doc.Cues[0].StyleName, doc.Cues[1].StyleName)
	}
	if doc.Cues[2].StyleName != "" {
		t.Errorf("未指派的 cue 被改: %q", doc.Cues[2].StyleName)
	}

	// AssignStyle 越界
	_, err = e.AssignStyle("test", []int{99}, "Title")
	if err == nil {
		t.Error("越界 AssignStyle 应返回错误")
	}

	// SetStyle 空名
	_, err = e.SetStyle("test", StyleDef{Name: ""})
	if err == nil {
		t.Error("空名 SetStyle 应返回错误")
	}
}
