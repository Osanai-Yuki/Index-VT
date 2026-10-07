// Package paths 解析 Index-VT 便携布局的全部磁盘路径。
//
// 基准目录解析顺序（01 文档 §5.2 / ADR-005 便携布局）：
//  1. 环境变量 INDEXVT_ROOT（开发/测试显式指定）
//  2. 从 exe 所在目录起向上最多 4 层，取第一个「已装配根」（见 BaseDir）
//  3. 兜底 exe 所在目录（全新环境：引导页会把资产装配到 exe 旁）
package paths

import (
	"os"
	"path/filepath"
	"strings"
)

// maxWalkUp BaseDir 向上回溯的层数上限。
const maxWalkUp = 4

// BaseDir 返回便携布局基准目录（models/、logs/ 的父目录）。
//
// 从 exe 目录起向上找第一个「已装配根」——含 llama-server（thirdparty/ 子目录
// 或与根同级）或 models/ 下已有完整 .gguf 的目录。正常分发里 exe 与资产同级，
// 第一层即命中，语义与旧版「exe 所在目录」一致；差别在仓库检出场景：直接跑
// app/build/bin/Index-VT.exe 时资产在仓库根，不回溯的话已下载模型完全不可见
// （引导页会对它重新发起下载），llama-server 也永远探测不到（功能链路进不去）。
func BaseDir() string {
	if root := os.Getenv("INDEXVT_ROOT"); root != "" {
		return root
	}
	return resolveBaseDir(defaultStart())
}

func defaultStart() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

// resolveBaseDir 从 start 起向上最多 maxWalkUp 层找已装配根；找不到回落 start。
func resolveBaseDir(start string) string {
	dir := start
	for i := 0; ; i++ {
		if isAssembledRoot(dir) {
			return dir
		}
		parent := filepath.Dir(dir)
		if i == maxWalkUp || parent == dir {
			return start
		}
		dir = parent
	}
}

// isAssembledRoot 判定 dir 是否已装配 Index-VT 运行资产。只认两类硬证据：
// llama-server 可执行文件（两种分发布局之一）、models/ 下的完整 .gguf。
// EnsureDirs 建出的空 models/、残留的 .part 与 data/ 都不算，否则仓库检出里
// exe 目录的残留会让回溯停在错误的层。
func isAssembledRoot(dir string) bool {
	if fileExists(filepath.Join(dir, "thirdparty", "llama-server", "llama-server.exe")) ||
		fileExists(filepath.Join(dir, "llama-server.exe")) {
		return true
	}
	entries, err := os.ReadDir(filepath.Join(dir, "models"))
	if err != nil {
		return false
	}
	for _, e := range entries {
		// .gguf.part 以 .part 结尾，不会被 .gguf 后缀误命中
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".gguf") {
			return true
		}
	}
	return false
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func ModelsDir() string  { return filepath.Join(BaseDir(), "models") }
func DataDir() string    { return filepath.Join(ModelsDir(), "data") }
func LogsDir() string    { return filepath.Join(BaseDir(), "logs") }
func DBPath() string     { return filepath.Join(DataDir(), "indexvt.db") }
func PartDir() string    { return ModelsDir() } // .part 与 .gguf 同目录（02 文档 §4）

// LlamaServerPath 依次探测：thirdparty/llama-server/（仓库布局）→ 基准目录（dist 便携布局）。
func LlamaServerPath() string {
	candidates := []string{
		filepath.Join(BaseDir(), "thirdparty", "llama-server", "llama-server.exe"),
		filepath.Join(BaseDir(), "llama-server.exe"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return candidates[0]
}

// EnsureDirs 创建运行时所需目录。
func EnsureDirs() error {
	for _, d := range []string{ModelsDir(), DataDir(), LogsDir()} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
	}
	return nil
}
