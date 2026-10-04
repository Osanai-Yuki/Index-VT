// Package paths 解析 Index-VT 便携布局的全部磁盘路径。
//
// 基准目录解析顺序（01 文档 §5.2 / ADR-005 便携布局）：
//  1. 环境变量 INDEXVT_ROOT（开发/测试显式指定）
//  2. 可执行文件所在目录（正常分发：exe 与 models/ 同级）
//  3. 当前工作目录
package paths

import (
	"os"
	"path/filepath"
)

// BaseDir 返回便携布局基准目录（models/、logs/ 的父目录）。
func BaseDir() string {
	if root := os.Getenv("INDEXVT_ROOT"); root != "" {
		return root
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
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
