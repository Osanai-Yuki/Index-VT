package modelmanager

import "testing"

func TestMissingModelCannotReplaceActiveSelection(t *testing.T) {
	t.Setenv("INDEXVT_ROOT", t.TempDir())
	m := newManagerForTest(t, stubOrchView{})
	m.SetActiveID("translate")
	if err := m.SetActive(ModelNailong); err == nil {
		t.Fatal("activated missing file")
	}
	if m.ActiveID() != "translate" {
		t.Fatal("missing model changed selection")
	}
}
