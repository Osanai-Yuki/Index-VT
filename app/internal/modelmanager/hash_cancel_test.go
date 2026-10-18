package modelmanager

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestHashHonorsCancellationAndKeepsFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "model.part")
	os.WriteFile(path, []byte("valid partial data"), 0600)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := sha256FileContext(ctx, path); !errors.Is(err, context.Canceled) {
		t.Fatalf("hash did not cancel: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("cancel removed resumable data")
	}
}
