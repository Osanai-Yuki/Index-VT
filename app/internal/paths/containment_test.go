package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateGGUFName(t *testing.T) {
	for _, n := range []string{"Index-Translate-2B.Q4_K_M.gguf", "my model.gguf", "x.YY.GGUF"} {
		if err := ValidateGGUFName(n); err != nil {
			t.Fatalf("%q 应合法，却报错 %v", n, err)
		}
	}
	for _, n := range []string{"", ".gguf", "..", "../../etc/passwd", `sub\x.gguf`, "x.GGUF.exe", "x.txt", "/abs/x.gguf"} {
		if err := ValidateGGUFName(n); err == nil {
			t.Fatalf("%q 应被拒绝", n)
		}
	}
}

func TestContainsRejectsDirAndEscape(t *testing.T) {
	base := t.TempDir()
	// Windows：os.Create 的句柄必须关闭，否则 t.TempDir 清理时 unlinkat 报共享冲突
	f, err := os.Create(filepath.Join(base, "ok.gguf"))
	if err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Contains(base, filepath.Join(base, "ok.gguf")); err != nil {
		t.Fatalf("目录内合法文件被拒: %v", err)
	}
	if _, err := Contains(base, base); err == nil {
		t.Fatal("目录本身必须被拒绝（Delete 正是栽在这里）")
	}
	if _, err := Contains(base, filepath.Join(base, "..", "..", "x.gguf")); err == nil {
		t.Fatal(".. 逃逸必须被拒绝")
	}
	outside := filepath.Join(filepath.Dir(base), "x.gguf")
	if _, err := Contains(base, outside); err == nil {
		t.Fatal("目录外绝对路径必须被拒绝")
	}
}
