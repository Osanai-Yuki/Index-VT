package csvsanitizer

import "testing"

func TestCellNeutralizesFormulas(t *testing.T) {
	cases := []struct{ in, want string }{
		{"=SUM(A1:A9)", "'=SUM(A1:A9)"},
		{"+1", "'+1"},
		{"-1", "'-1"},
		{"@SUM(A1)", "'@SUM(A1)"},
		{"\t=1", "'\t=1"},
		{"普通术语", "普通术语"},
		{"a=b", "a=b"},     // 非前导 = 不中和
		{`带"引号"`, `带"引号"`}, // 转义由 Quote 负责，Cell 不碰
		{"", ""},
	}
	for _, c := range cases {
		if got := Cell(c.in); got != c.want {
			t.Errorf("Cell(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestQuoteEscapesAndNeutralizes(t *testing.T) {
	if got := Quote(`=cmd`); got != `"'=cmd"` {
		t.Errorf("Quote(=cmd) = %q", got)
	}
	if got := Quote(`a"b`); got != `"a""b"` {
		t.Errorf("Quote(a\"b) = %q", got)
	}
}
