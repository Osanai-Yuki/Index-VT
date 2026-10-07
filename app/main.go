// Index-VT 主程序入口（01 文档 §8）。
// 启动序列：单实例锁 → 日志/残留清扫 → 服务装配（OnStartup）→ UI。
// 退出序列：前端 PrepareExit → Quit；OnShutdown 兜底全量释放（ADR-006）。
package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"indexvt/internal/envprobe"
	"indexvt/internal/paths"
	"indexvt/internal/winproc"
)

//go:embed all:frontenddist
var assetsRoot embed.FS

// assets 剥离 frontenddist 前缀，使 FileServer 根路径即 index.html。
func assets() fs.FS {
	sub, err := fs.Sub(assetsRoot, "frontenddist")
	if err != nil {
		panic(err)
	}
	return sub
}

const (
	appTitle    = "Index-VT"
	version     = "1.0.0"
	windowTitle = "Index-VT"
	mutexName   = `Global\IndexVT-SingleInstance`
	logKeepDays = 7
)

func main() {
	showVersion := flag.Bool("version", false, "打印版本退出")
	flag.Parse()
	if *showVersion {
		fmt.Println("Index-VT", version)
		return
	}

	// 单实例锁（01 文档 §9 / F-20）：二次启动激活既有窗口后退出
	mh, acquired, err := winproc.TryCreateMutex(mutexName)
	switch {
	case err != nil:
		// 锁创建失败 ≠ 已有实例。此处必须 fail-open：若当成"已有实例"，
		// 任何 CreateMutex 异常（权限、策略、Global\ 命名空间限制）都会让
		// 程序去激活一个不存在的窗口然后退出，看起来像"双击没反应"（B15）。
		slog.Error("单实例锁创建失败，继续启动", "err", err)
	case !acquired:
		slog.Info("已有实例在运行，激活其窗口后退出")
		winproc.ActivateExistingWindow(windowTitle)
		return
	default:
		defer winproc.ReleaseMutex(mh)
	}

	_ = paths.EnsureDirs()

	// 日志：logs/indexvt-YYYYMMDD.log，滚动保留 7 天（01 文档 §9）
	logClose := setupLogger()
	if logClose != nil {
		defer (*logClose)()
	}

	// 启动残留清扫（02 文档 §6.4 三重指纹），结果在首次引导展示
	sweep := envprobe.SweepResiduals()
	if sweep.Count > 0 {
		slog.Info("启动残留清扫", "cleaned", strings.Join(sweep.Cleaned, "; "))
	}

	app := &App{}
	err = wails.Run(&options.App{
		Title:     appTitle,
		Width:     1280,
		Height:    800,
		MinWidth:  1180,
		MinHeight: 700,
		// 瑞士风格基准底色（#FFFFFF）：WebView2 首帧前默认白底，深色主题下会先白后黑
		// 闪一下（B30）；预置设计基准底色消除该闪变。
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Handler: http.FileServer(http.FS(assets())),
		},
		OnStartup: func(ctx context.Context) {
			if err := app.startup(ctx, slog.Default(), version, sweep.Count); err != nil {
				slog.Error("startup failed", "err", err)
				os.Exit(1)
			}
		},
		// 点 X 关窗只触发 OnBeforeClose/OnShutdown，不走前端 PrepareExit→Quit；
		// 在此补上推理进程释放，否则 llama-server 成孤儿常驻显存。
		// prepare 失败也放行关闭 —— 不得把用户困在关不掉的窗口里。
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			if err := app.PrepareExit(); err != nil {
				slog.Error("OnBeforeClose 中 PrepareExit 失败", "err", err)
			}
			return false
		},
		OnShutdown: func(ctx context.Context) {
			app.shutdown()
		},
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		slog.Error("wails run failed", "err", err)
	}
}

// setupLogger 初始化 slog（文件+stdout），清理 7 天前日志。
func setupLogger() *func() error {
	_ = paths.EnsureDirs()
	entries, _ := os.ReadDir(paths.LogsDir())
	cutoff := time.Now().AddDate(0, 0, -logKeepDays)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(paths.LogsDir(), e.Name()))
		}
	}
	name := filepath.Join(paths.LogsDir(), "indexvt-"+time.Now().Format("20060102")+".log")
	f, err := os.OpenFile(name, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		slog.Error("打开日志文件失败", "err", err)
		return nil
	}
	logger := slog.New(slog.NewTextHandler(io.MultiWriter(f, os.Stdout), nil))
	slog.SetDefault(logger)
	logger.Info("Index-VT 启动", "version", version, "root", paths.BaseDir())
	closeFn := func() error { return f.Close() }
	return &closeFn
}
