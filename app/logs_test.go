package main

import (
	"archive/zip"
	"bytes"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"indexvt/internal/config"
	"indexvt/internal/paths"
)

func TestLoggingDisabledCreatesNoFiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv("INDEXVT_ROOT", root)
	previous := slog.Default()
	t.Cleanup(func() { slog.SetDefault(previous) })
	if config.Default().LoggingEnabled {
		t.Fatal("日志必须默认关闭")
	}
	if closer := setupLogger(false); closer != nil {
		t.Fatal("关闭日志时不应打开文件")
	}
	slog.Info("must not be written")
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatalf("关闭日志时创建了文件或目录: %v, %v", entries, err)
	}
	closer := setupLogger(true)
	if closer == nil {
		t.Fatal("开启日志时应打开文件")
	}
	slog.Info("enabled sentinel")
	if err := (*closer)(); err != nil {
		t.Fatal(err)
	}
	entries, err = os.ReadDir(paths.LogsDir())
	if err != nil || len(entries) != 1 {
		t.Fatalf("开启日志后缺少日志文件: %v, %v", entries, err)
	}
	data, err := os.ReadFile(filepath.Join(paths.LogsDir(), entries[0].Name()))
	if err != nil || !bytes.Contains(data, []byte("enabled sentinel")) {
		t.Fatalf("开启后的日志未记录: %s, %v", data, err)
	}
}

func TestClearLogsPreservesOtherDataAndReportsBusyFile(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"indexvt-20261018.log", "llama-server.out.log", "indexvt-logs-old.zip", "notes.txt", "history.db", "personal.log"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("keep or remove"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// Windows 的在用日志不允许删除，应被报告而非导致其余清理中止。
	busy, err := os.Open(filepath.Join(dir, "llama-server.out.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer busy.Close()
	if err := os.Mkdir(filepath.Join(dir, "indexvt-nested.log"), 0o700); err != nil {
		t.Fatal(err)
	}
	result, err := clearLogsInto(dir)
	if err != nil || result.Removed != 2 || len(result.Skipped) != 1 || result.Skipped[0] != "llama-server.out.log" {
		t.Fatalf("清理结果异常: %+v, %v", result, err)
	}
	for _, name := range []string{"notes.txt", "history.db", "personal.log", "indexvt-nested.log"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("误删 %s: %v", name, err)
		}
	}
	busy.Close()
	result, err = clearLogsInto(dir)
	if err != nil || result.Removed != 1 || len(result.Skipped) != 0 {
		t.Fatalf("关闭占用后未清理: %+v, %v", result, err)
	}
}

// TestCollectLogsExcludesInferenceLog 锁住 1.20 的脱敏承诺：
//  1. 推理日志 llama-server.out.log（可能含提示词原文＝用户待翻译正文/术语表）不进包；
//  2. 普通运行日志必须在包里 —— 否则"打包成空"的 bug 也能让本测试通过。
func TestCollectLogsExcludesInferenceLog(t *testing.T) {
	if len(logsExcludedFromBundle) == 0 {
		t.Skip("推理日志未启用排除规则，跳过")
	}
	logsDir := t.TempDir()
	outDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(logsDir, "llama-server.out.log"),
		[]byte("用户待翻译正文：机密哨兵字符串 ZEBRA-42"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logsDir, "indexvt-20261004.log"),
		[]byte("普通运行日志 无正文"), 0o644); err != nil {
		t.Fatal(err)
	}

	app := &App{} // 零值即可：zip 逻辑只用到 cfgSnapshot 的零值配置
	zipPath, err := app.collectLogsZipInto(logsDir, outDir)
	if err != nil {
		t.Fatal(err)
	}
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	foundRuntimeLog := false
	for _, f := range r.File {
		if filepath.Base(f.Name) == "llama-server.out.log" {
			t.Fatal("推理日志被打包，脱敏承诺失效")
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if bytes.Contains(b, []byte("ZEBRA-42")) {
			t.Fatalf("%s 内含用户正文", f.Name)
		}
		if filepath.Base(f.Name) == "indexvt-20261004.log" {
			foundRuntimeLog = true
		}
	}
	if !foundRuntimeLog {
		t.Fatal("普通日志也没打包进去，排除逻辑写错了")
	}
}
