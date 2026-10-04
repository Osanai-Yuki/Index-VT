package main

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"indexvt/internal/paths"
)

// collectLogsZip 一键打包：logs/ 全部日志 + 脱敏配置副本（F-24：无用户文本内容泄露）。
// 返回 zip 路径。
func (a *App) collectLogsZip() (string, error) {
	outDir := paths.LogsDir()
	_ = os.MkdirAll(outDir, 0o755)
	outPath := filepath.Join(outDir, fmt.Sprintf("indexvt-logs-%s.zip", time.Now().Format("20060102-150405")))
	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	// 日志文件
	entries, _ := os.ReadDir(paths.LogsDir())
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".log") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(paths.LogsDir(), e.Name()))
		if err != nil {
			continue
		}
		w, err := zw.Create("logs/" + e.Name())
		if err != nil {
			continue
		}
		_, _ = w.Write(data)
	}
	// 脱敏配置（config 中无用户文本，但同样不包含任何历史/术语数据）
	cfgJSON, _ := json.MarshalIndent(a.cfgSnapshot(), "", "  ")
	if w, err := zw.Create("config.json"); err == nil {
		_, _ = w.Write(cfgJSON)
	}
	// llama-server 输出（含模型加载日志，无用户文本）
	if data, err := os.ReadFile(filepath.Join(paths.LogsDir(), "llama-server.out.log")); err == nil {
		if w, err := zw.Create("llama-server.out.log"); err == nil {
			_, _ = w.Write(data)
		}
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	return outPath, nil
}
