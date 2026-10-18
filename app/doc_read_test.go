package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDocumentReadRejectsHugeFilesBeforeAllocation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "huge.txt")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	f.Truncate(100 << 20)
	f.Close()
	if _, err := readDocument(path); err == nil {
		t.Fatal("oversize document accepted")
	}
	if _, err := readDocument(filepath.Dir(path)); err == nil {
		t.Fatal("directory accepted")
	}
}
