package docpipeline

import (
	"context"
	"strings"
	"testing"
)

func TestRestartRetranslatesDoneAndPartialExportIsExplicit(t *testing.T) {
	calls := 0
	e := NewEngine(func(ctx context.Context, prompt string, max int) (string, error) { calls++; return "translated", nil })
	id, err := e.Open("a.txt", "一段文本", dir("zh-en"), nil, 8192, 50000)
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan DocDone, 1)
	if err := e.Run(id, nil, func(d DocDone) { done <- d }); err != nil {
		t.Fatal(err)
	}
	<-done
	if d, _ := e.Get(id); d.QueueActive {
		t.Fatal("terminal callback observed a running queue")
	}
	if err := e.Run(id, nil, func(d DocDone) { done <- d }); err != nil {
		t.Fatal(err)
	}
	<-done
	if calls != 1 {
		t.Fatal("resume repeated completed chunks")
	}
	if err := e.Restart(id, nil, func(d DocDone) { done <- d }); err != nil {
		t.Fatal(err)
	}
	<-done
	if calls != 2 {
		t.Fatal("restart did not retranslate done chunk")
	}
	e.mu.Lock()
	e.docs[id].Chunks = append(e.docs[id].Chunks, ChunkState{Index: 2, Text: "pending", State: "pending"})
	e.mu.Unlock()
	if _, err := e.ExportText(id, ExportTranslation); err == nil {
		t.Fatal("implicit partial export allowed")
	}
	text, err := e.ExportText(id, ExportKind("translation-partial"))
	if err != nil || !strings.Contains(text, "未完成") || !strings.Contains(text, "translated") {
		t.Fatal("explicit partial export did not preserve markers", err)
	}
}
