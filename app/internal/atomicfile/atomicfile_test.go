package atomicfile

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStageFailurePreservesAllExistingFiles(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "first.txt")
	if err := os.WriteFile(first, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	err := WriteFiles([]File{{first, []byte("new")}, {filepath.Join(dir, "missing", "second.txt"), []byte("new2")}})
	if err == nil {
		t.Fatal("expected staging failure")
	}
	got, _ := os.ReadFile(first)
	if string(got) != "original" {
		t.Fatal("existing file was changed before all outputs were staged")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("staging files leaked")
	}
}

func TestReplaceAndProtectSource(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.txt")
	os.WriteFile(path, []byte("before"), 0600)
	if err := Write(path, []byte("after")); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "after" {
		t.Fatal(string(got))
	}
	if err := ProtectSource(path, path); err == nil {
		t.Fatal("allowed original source overwrite")
	}
	if err := Write(path, nil); err == nil {
		t.Fatal("allowed empty export")
	}
	got, _ = os.ReadFile(path)
	if string(got) != "after" {
		t.Fatal("empty export damaged output")
	}
}
