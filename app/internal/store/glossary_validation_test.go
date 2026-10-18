package store

import "testing"

func TestInvalidGlossaryDoesNotOverwriteSavedBook(t *testing.T) {
	s := newTestStore(t)
	id, err := s.SaveGlossary(Glossary{Name: "book", Items: []GlossaryItemEnt{{Term: "API", Translation: "接口"}}})
	if err != nil {
		t.Fatal(err)
	}
	for _, items := range [][]GlossaryItemEnt{
		{{Term: "API", Translation: ""}}, {{Term: "API", Translation: "a"}, {Term: "api", Translation: "b"}},
	} {
		if _, err := s.SaveGlossary(Glossary{ID: id, Name: "changed", Items: items}); err == nil {
			t.Fatal("invalid book accepted")
		}
	}
	books, _ := s.ListGlossaries()
	if len(books) != 1 || books[0].Name != "book" || books[0].Items[0].Translation != "接口" {
		t.Fatal("validation damaged old book")
	}
}
