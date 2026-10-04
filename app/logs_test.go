package main

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

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
