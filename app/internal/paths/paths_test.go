package paths

import (
	"os"
	"path/filepath"
	"testing"
)

// mkTouch 建文件（含父目录）。Windows 上句柄未关会让 t.TempDir 清理报共享冲突，
// os.WriteFile 打开即关，无此问题。
func mkTouch(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestResolveBaseDirStartAssembled(t *testing.T) {
	start := filepath.Join(t.TempDir(), "dist")
	mkTouch(t, filepath.Join(start, "thirdparty", "llama-server", "llama-server.exe"))
	if got := resolveBaseDir(start); got != start {
		t.Fatalf("exe 目录自带 llama-server 应就地命中，得到 %s", got)
	}
}

func TestResolveBaseDirStartAssembledByModel(t *testing.T) {
	start := filepath.Join(t.TempDir(), "dist")
	mkTouch(t, filepath.Join(start, "models", "Index-Translate-2B.Q4_K_M.gguf"))
	if got := resolveBaseDir(start); got != start {
		t.Fatalf("exe 目录 models/ 已有完整模型应就地命中，得到 %s", got)
	}
}

func TestResolveBaseDirWalksUpToRepoRoot(t *testing.T) {
	root := t.TempDir()
	start := filepath.Join(root, "app", "build", "bin")
	mkTouch(t, filepath.Join(start, "Index-VT.exe"))
	// 仓库根有 thirdparty/llama-server；exe 目录只有残留 data/ 与 .part（不算装配证据）
	mkTouch(t, filepath.Join(root, "thirdparty", "llama-server", "llama-server.exe"))
	mkTouch(t, filepath.Join(start, "models", "Index-Translate-2B.Q4_K_M.gguf.part"))
	mkTouch(t, filepath.Join(start, "models", "data", "indexvt.db"))
	if got := resolveBaseDir(start); got != root {
		t.Fatalf("仓库检出内应回溯到仓库根，得到 %s", got)
	}
}

func TestResolveBaseDirWalkUpBound(t *testing.T) {
	root := t.TempDir()
	// 逐层：bin(0)→build(1)→app(2)→checkout(3)→projects(4)→越界。
	// 装配根放在第 5 层之外（root 本身距 start 5 层），不应被命中。
	start := filepath.Join(root, "projects", "checkout", "app", "build", "bin")
	mkTouch(t, filepath.Join(root, "thirdparty", "llama-server", "llama-server.exe"))
	if got := resolveBaseDir(start); got != start {
		t.Fatalf("超出回溯上限不应命中远端装配根，得到 %s", got)
	}
}

func TestResolveBaseDirNoAssetsFallsBack(t *testing.T) {
	start := filepath.Join(t.TempDir(), "somewhere", "bin")
	mkTouch(t, filepath.Join(start, "Index-VT.exe"))
	if got := resolveBaseDir(start); got != start {
		t.Fatalf("无任何资产应回落 exe 目录，得到 %s", got)
	}
}

func TestBaseDirEnvWins(t *testing.T) {
	custom := t.TempDir()
	t.Setenv("INDEXVT_ROOT", custom)
	if got := BaseDir(); got != custom {
		t.Fatalf("INDEXVT_ROOT 必须最高优先，得到 %s", got)
	}
}

func TestGGUFPartSuffixNotAssembledEvidence(t *testing.T) {
	start := filepath.Join(t.TempDir(), "dist")
	mkTouch(t, filepath.Join(start, "models", "Index-Translate-2B.Q4_K_M.gguf.part"))
	if isAssembledRoot(start) {
		t.Fatal(".part 半成品不得作为装配证据（正是重复下载残留的典型形态）")
	}
}
