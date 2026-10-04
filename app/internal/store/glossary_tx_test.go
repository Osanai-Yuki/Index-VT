package store

import (
	"math"
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// 词条写入中途失败时，原有术语本必须保持完整（B20）。
func TestSaveGlossaryRollsBackOnItemFailure(t *testing.T) {
	s := newTestStore(t)
	id, err := s.SaveGlossary(Glossary{Name: "FF14", Items: []GlossaryItemEnt{
		{Term: "a", Translation: "A"}, {Term: "b", Translation: "B"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	// 用触发器阻断后续 INSERT
	if _, err := s.db.Exec(`CREATE TRIGGER trg AFTER INSERT ON glossary_items BEGIN SELECT RAISE(ABORT,'boom'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveGlossary(Glossary{ID: id, Name: "FF14改", Items: []GlossaryItemEnt{{Term: "c", Translation: "C"}}}); err == nil {
		t.Fatal("插入被触发器阻断，应返回错误")
	}
	gs, err := s.ListGlossaries()
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range gs {
		if g.ID != id {
			continue
		}
		if len(g.Items) != 2 {
			t.Fatalf("未回滚：词条数=%d，期望仍是原来的 2 条", len(g.Items))
		}
		if g.Name != "FF14" {
			t.Fatalf("名称也被改了：%q（应整体回滚）", g.Name)
		}
		return
	}
	t.Fatal("术语本整个不见了")
}

// 非法页码不得报错，也不得产生越界/静默空页的 OFFSET（B21）。
// 先放 1 条历史：合法语义下，任何被钳制的页码都应回到第 1 页并看到这 1 条。
func TestListHistoryIllegalPage(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.AddHistory(HistoryItem{SourceLang: "ja", TargetLang: "zh", SourceText: "x", Output: "y", Model: "m"}); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		page, pageSize int
		desc           string
	}{
		{-5, 50, "负页码"},
		{1 << 40, 50, "超大页码（offset 超过 1<<40，应钳制回第 1 页）"},
		{math.MaxInt64, 200, "极限页码（int 乘法会回绕成负值）"},
	} {
		got, err := s.ListHistory(tc.page, tc.pageSize, false)
		if err != nil {
			t.Fatalf("%s page=%d 应被钳制而非报错: %v", tc.desc, tc.page, err)
		}
		if len(got) != 1 {
			t.Fatalf("%s page=%d 应钳制回第 1 页返回 1 条，实际 %d 条", tc.desc, tc.page, len(got))
		}
	}
}

// 全新空库打开后，migrate 必须建齐全部表（回归锁）。
func TestMigrateCreatesAllTables(t *testing.T) {
	s := newTestStore(t)
	for _, tbl := range []string{"history", "config", "glossaries", "glossary_items", "model_files"} {
		var n int
		if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("表 %s 未创建", tbl)
		}
	}
}
