package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"indexvt/internal/paths"
)

// logsExcludedFromBundle 打包时默认排除的日志文件名。
// llama-server.out.log 可能包含提示词原文（即用户待翻译正文与术语表）；
// "脱敏"承诺不能靠"打了包再指望它干净"来兑现，故默认不打包（B31）。
// 事实核验（翻译哨兵文本后 grep 该日志）尚未在真实 exe 上执行 —— 排除是无论
// 结果如何都安全的默认值：若该日志实测干净，代价仅为包内少一个文件。
// 需要推理侧日志时由用户显式提供该文件，不应经此"脱敏"包流出。
// 测试与打包逻辑共用这一份事实来源（logs_test.go: TestCollectLogsExcludesInferenceLog）。
var logsExcludedFromBundle = map[string]bool{
	"llama-server.out.log": true,
}

type LogCleanupResult struct {
	Removed int      `json:"removed"`
	Skipped []string `json:"skipped"`
}

// ClearLogs 仅清理应用生成的日志与诊断包；不递归、不跟随链接，不触碰模型或数据。
func (a *App) ClearLogs() (LogCleanupResult, error) {
	if err := a.ensureReady(); err != nil {
		return LogCleanupResult{}, err
	}
	a.logsMu.Lock()
	defer a.logsMu.Unlock()
	return clearLogsInto(paths.LogsDir())
}

func clearLogsInto(dir string) (LogCleanupResult, error) {
	result := LogCleanupResult{Skipped: []string{}}
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	for _, entry := range entries {
		name := entry.Name()
		owned := name == "llama-server.out.log" ||
			(strings.HasPrefix(name, "indexvt-") && strings.HasSuffix(name, ".log")) ||
			(strings.HasPrefix(name, "indexvt-logs-") && strings.HasSuffix(name, ".zip"))
		if !owned || !entry.Type().IsRegular() {
			continue
		}
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			result.Skipped = append(result.Skipped, name)
		} else {
			result.Removed++
		}
	}
	return result, nil
}

// collectLogsZip 一键打包：logs/ 运行日志（不含 logsExcludedFromBundle 内的推理日志）
// + 脱敏配置副本（F-24：无用户文本内容泄露）。返回 zip 路径。
func (a *App) collectLogsZip() (string, error) {
	// 薄封装：真实目录注入可测入口 collectLogsZipInto（logs_test.go 锁住排除规则）。
	return a.collectLogsZipInto(paths.LogsDir(), paths.LogsDir())
}

// collectLogsZipInto 打包 logsDir 下日志 + 配置快照副本到 outDir 下的 zip，返回 zip 路径。
// 目录参数化以支持测试；除排除表过滤外，zip 内容逻辑与重构前一致。
func (a *App) collectLogsZipInto(logsDir, outDir string) (string, error) {
	_ = os.MkdirAll(outDir, 0o755)
	outPath := filepath.Join(outDir, fmt.Sprintf("indexvt-logs-%s.zip", time.Now().Format("20060102-150405")))
	f, err := os.Create(outPath)
	if err != nil {
		return "", err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	// 日志文件：排除表（logsExcludedFromBundle）内的文件名一律跳过。
	entries, _ := os.ReadDir(logsDir)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".log") {
			continue
		}
		if logsExcludedFromBundle[filepath.Base(e.Name())] {
			continue
		}
		data, err := os.ReadFile(filepath.Join(logsDir, e.Name()))
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
	if err := zw.Close(); err != nil {
		return "", err
	}
	return outPath, nil
}
