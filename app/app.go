// Wails 绑定层（01 文档 §7.1 API 契约）。
// 流式与进度类数据一律走 Wails Events（translate:delta / translate:done /
// model:progress / subtitle:cue / orch:state），避免轮询。
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"indexvt/internal/config"
	"indexvt/internal/envprobe"
	"indexvt/internal/modelmanager"
	"indexvt/internal/orchestrator"
	"indexvt/internal/paths"
	"indexvt/internal/store"
	"indexvt/internal/subtitle"
	"indexvt/internal/translator"
)

// App 绑定对象。
type App struct {
	ctx     context.Context
	log     *slog.Logger
	cfg     config.Config
	store   *store.Store
	orch    *orchestrator.Orchestrator
	models  *modelmanager.Manager
	tr      *translator.Translator
	sub     *subtitle.Engine
	version string
	ready   chan struct{} // OnStartup 装配完成后关闭（Wails OnStartup 晚于前端加载，需门禁）

	mu      sync.Mutex
	taskSeq int
	deltas  map[string]*deltaBatcher
	closing bool
}

// ensureReady 阻塞等待服务装配完成（最长 30s）。
func (a *App) ensureReady() error {
	select {
	case <-a.ready:
		return nil
	case <-time.After(30 * time.Second):
		return errors.New("应用服务装配超时，请重启")
	}
}

// deltaBatcher translate:delta 50ms 合并窗口（02 文档 §7 现象 A）。
type deltaBatcher struct {
	mu       sync.Mutex
	buf      strings.Builder
	last     time.Time
	flush    func(text string)
	stop     chan struct{}
	stopOnce sync.Once
}

func newDeltaBatcher(flush func(string)) *deltaBatcher {
	b := &deltaBatcher{flush: flush, stop: make(chan struct{})}
	go func() {
		t := time.NewTicker(50 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-b.stop:
				return
			case <-t.C:
				b.flushNow()
			}
		}
	}()
	return b
}

func (b *deltaBatcher) append(s string) {
	b.mu.Lock()
	b.buf.WriteString(s)
	b.mu.Unlock()
}

func (b *deltaBatcher) flushNow() {
	b.mu.Lock()
	s := b.buf.String()
	b.buf.Reset()
	b.last = time.Now()
	b.mu.Unlock()
	if s != "" {
		b.flush(s)
	}
}

// close 幂等：OnBeforeStop（热切换/退出）与翻译 goroutine 会并发关闭同一个
// batcher，sync.Once 保证 stop 只关一次，避免 `close of closed channel` panic。
func (b *deltaBatcher) close() {
	b.stopOnce.Do(func() { close(b.stop) })
	b.flushNow()
}

// ---------- 启动装配（main.go OnStartup 调用） ----------

// startup 服务装配（Wails OnStartup）。
func (a *App) startup(ctx context.Context, log *slog.Logger, version string, cleanedResiduals int) error {
	a.ready = make(chan struct{})
	a.ctx = ctx
	a.log = log
	a.version = version
	a.deltas = make(map[string]*deltaBatcher)

	// 配置加载
	st, err := store.Open(paths.DBPath())
	if err != nil {
		return fmt.Errorf("打开数据库失败: %w", err)
	}
	a.store = st
	a.cfg = config.Default()
	if ok, err := st.GetConfig("app", &a.cfg); err == nil && ok {
		a.cfg.Normalize()
	}
	if !modelmanager.ValidModelID(a.cfg.ActiveModel) {
		a.cfg.ActiveModel = string(modelmanager.ModelTranslate)
	}

	// 编排器
	a.orch = orchestrator.New(a, orchestrator.Callbacks{
		OnBeforeStop: func(reason string) {
			// 取消所有任务上下文（断开 SSE，02 文档 §6.2）
			a.tr.CancelAll()
			a.sub.CancelAllQueues()
			a.mu.Lock()
			for id, b := range a.deltas {
				delete(a.deltas, id)
				go b.close()
			}
			a.mu.Unlock()
		},
		OnEvent: func(ev orchestrator.Event) {
			runtime.EventsEmit(a.ctx, "orch:event", ev)
			if ev.Kind == "state" && ev.State == "running" && ev.Model != "" {
				a.models.MarkRan(ev.Model)
			}
		},
	}, log)
	a.orch.Start()

	// 模型管理
	a.models = modelmanager.New(st, a, log, a.sourcePref,
		func(p modelmanager.DownloadProgress) {
			runtime.EventsEmit(a.ctx, "model:progress", p)
		},
		func() {
			if a.ctx != nil {
				runtime.EventsEmit(a.ctx, "models:updated")
			}
		})
	a.models.SetActiveID(a.cfg.ActiveModel)
	a.models.ScanLocal()

	// 翻译器
	a.tr = translator.NewTranslator(translator.Deps{
		ResolveEndpoint: func(ctx context.Context, modelID string) (string, string, error) {
			path, _, err := a.models.ResolveModelPath(modelmanager.ModelID(modelID))
			if err != nil {
				return "", "", err
			}
			ep, err := a.orch.TaskBegin(path, modelID)
			if err != nil {
				return "", "", err
			}
			return ep.BaseURL, path, nil
		},
		OnTaskFinish: func(modelID string) {
			a.orch.TaskDone()
		},
		ModelForMode: func(mode translator.ModeKind) string {
			if mode == translator.ModeDubbing {
				return string(modelmanager.ModelHomura)
			}
			return a.cfg.ActiveModel
		},
		ModelName: func(modelID string) string {
			return "index-" + modelID + "-2b"
		},
		Log: log,
	}, log)

	// 字幕引擎（单条翻译桥接）
	subtitle.SetOffTargetChecker(translator.DetectOffTarget)
	a.sub = subtitle.NewEngine(func(ctx context.Context, text, sourceLang, targetLang string) (string, error) {
		return a.tr.TranslateSync(ctx, translator.TranslateRequest{
			SourceLang: sourceLang,
			TargetLang: targetLang,
			Text:       text,
		})
	})

	close(a.ready) // 装配完成，放行绑定调用
	return nil
}

func (a *App) shutdown() {
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return
	}
	a.closing = true
	a.mu.Unlock()
	_ = a.orch.PrepareExit() // 兜底全量释放（正常路径走 PrepareExit 绑定）
	_ = a.store.Close()
}

// sourcePref 读取配置的下载源偏好。
func (a *App) sourcePref() string { return string(a.cfg.Download.SourcePref) }

// ---------- orchestrator.Settings / modelmanager.OrchestratorView 适配 ----------

func (a *App) NGLOverride() int   { return a.cfg.Inference.NGLOverride }
func (a *App) CtxTokens() int64   { return a.cfg.Inference.CtxTier.Tokens() }
func (a *App) CPUThreads() int    { return a.cfg.Inference.CPUThreads }
func (a *App) IdleMinutes() int   { return a.cfg.Resource.IdleUnloadMinutes }

func (a *App) State() string             { return string(a.orch.State()) }
func (a *App) CurrentModel() string      { return a.orch.CurrentModel() }
func (a *App) CurrentModelPath() string  { return "" } // 预留：模型中心路径显示
func (a *App) EndpointPort() int {
	ep, ok := a.orch.Endpoint()
	if !ok {
		return 0
	}
	return ep.Port
}
func (a *App) IdleSeconds() int  { return a.orch.IdleSeconds() }
func (a *App) ActiveTasks() int  { return a.orch.ActiveTasks() }

// ---------- 翻译 ----------

// TranslateRequestUI 前端翻译请求。
type TranslateRequestUI struct {
	SourceLang string `json:"sourceLang"` // "auto" 或语言码
	TargetLang string `json:"targetLang"`
	Text       string `json:"text"`
	Dubbing    bool   `json:"dubbing,omitempty"`
	Syllables  int    `json:"syllables,omitempty"`
	GlossaryID int64  `json:"glossaryId,omitempty"`
}

// TaskHandle 任务句柄。
type TaskHandle struct {
	TaskID string `json:"taskId"`
}

// Translate 发起流式翻译（01 文档 §7.1 翻译组）。
func (a *App) Translate(req TranslateRequestUI) (TaskHandle, error) {
	if err := a.ensureReady(); err != nil {
		return TaskHandle{}, err
	}
	a.mu.Lock()
	a.taskSeq++
	taskID := fmt.Sprintf("t-%d-%d", time.Now().UnixMilli(), a.taskSeq)
	a.mu.Unlock()

	glossary := []translator.GlossaryItem{}
	if req.GlossaryID > 0 {
		gs, err := a.store.ListGlossaries()
		if err == nil {
			for _, g := range gs {
				if g.ID == req.GlossaryID {
					for _, it := range g.Items {
						glossary = append(glossary, translator.GlossaryItem{Term: it.Term, Translation: it.Translation})
					}
				}
			}
		}
	}

	mode := translator.ModeNormal
	if req.Dubbing {
		mode = translator.ModeDubbing
	}
	source := req.SourceLang
	if source == "" {
		source = "auto"
	}
	detected := ""
	if source == "auto" {
		detected = translator.DetectSourceLang(req.Text)
	}

	batcher := newDeltaBatcher(func(text string) {
		runtime.EventsEmit(a.ctx, "translate:delta", map[string]string{
			"taskId": taskID, "text": text,
		})
	})
	a.mu.Lock()
	a.deltas[taskID] = batcher
	a.mu.Unlock()

	go func() {
		start := time.Now()
		res, err := a.tr.Translate(context.Background(), translator.TranslateRequest{
			TaskID:      taskID,
			SourceLang:  source,
			TargetLang:  req.TargetLang,
			Text:        req.Text,
			Mode:        mode,
			Syllables:   req.Syllables,
			Constraints: &translator.Constraints{Glossary: glossary},
		}, func(delta string) { batcher.append(delta) })
		batcher.close()
		a.mu.Lock()
		delete(a.deltas, taskID)
		a.mu.Unlock()

		done := map[string]any{
			"taskId": taskID,
			"ms":     time.Since(start).Milliseconds(),
		}
		if err != nil {
			done["error"] = err.Error()
			if errors.Is(err, translator.ErrCanceled) {
				done["canceled"] = true
			}
		} else {
			done["output"] = res.Output
			done["offTarget"] = res.OffTargetSuspect
			done["tokPerSec"] = res.TokensPerSec
			done["firstTokenMs"] = res.FirstTokenMs
			done["completionTokens"] = res.CompletionTokens
			done["targetSyllables"] = res.TargetSyllables
			done["actualSyllables"] = res.ActualSyllables
			done["detected"] = detected
			// 写历史（01 文档 §5.3 数据流）
			_, _ = a.store.AddHistory(store.HistoryItem{
				SourceLang: source, TargetLang: req.TargetLang,
				SourceText: req.Text, Output: res.Output,
				Model: a.trModelName(mode), Mode: string(mode),
			})
			_ = a.store.TrimHistory(a.cfg.History.MaxEntries)
		}
		runtime.EventsEmit(a.ctx, "translate:done", done)
	}()
	return TaskHandle{TaskID: taskID}, nil
}

func (a *App) trModelName(mode translator.ModeKind) string {
	if mode == translator.ModeDubbing {
		return "Index-Homura-2B"
	}
	return "Index-Translate-2B"
}

// CancelTask 取消任务（Esc / 按钮）。
func (a *App) CancelTask(taskID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.tr.CancelActive(taskID)
}

// ---------- 历史 ----------

func (a *App) ListHistory(page int) ([]store.HistoryItem, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.store.ListHistory(page, 50, false)
}
func (a *App) SearchHistory(q string) ([]store.HistoryItem, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.store.SearchHistory(q, 50)
}
func (a *App) DeleteHistory(id int64) error { return a.store.DeleteHistory(id) }
func (a *App) StarHistory(id int64, starred bool) error {
	return a.store.StarHistory(id, starred)
}
func (a *App) ClearHistory() error { return a.store.ClearHistory() }

// ---------- 术语 ----------

func (a *App) ListGlossaries() ([]store.Glossary, error) { return a.store.ListGlossaries() }

func (a *App) SaveGlossary(g store.Glossary) (int64, error) {
	return a.store.SaveGlossary(g)
}

func (a *App) DeleteGlossary(id int64) error { return a.store.DeleteGlossary(id) }

func (a *App) ExportGlossaryCSV(id int64) (string, error) {
	gs, err := a.store.ListGlossaries()
	if err != nil {
		return "", err
	}
	for _, g := range gs {
		if g.ID == id {
			var b strings.Builder
			b.WriteString("term,translation\n")
			for _, it := range g.Items {
				t := strings.ReplaceAll(it.Term, `"`, `""`)
				tr := strings.ReplaceAll(it.Translation, `"`, `""`)
				b.WriteString(fmt.Sprintf(`"%s","%s"`+"\n", t, tr))
			}
			return b.String(), nil
		}
	}
	return "", fmt.Errorf("术语本 %d 不存在", id)
}

// ---------- 模型 ----------

func (a *App) ListModels() ([]modelmanager.ModelInfo, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.models.List(), nil
}

func (a *App) ListUnknownModels() ([]modelmanager.ModelInfo, error) {
	return a.models.ListUnknown(), nil
}

func (a *App) DownloadModel(id, quant string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	_, err := a.models.Download(modelmanager.ModelID(id), modelmanager.QuantKind(quant))
	return err
}

func (a *App) CancelDownload(id string) error { return a.models.CancelDownload(modelmanager.ModelID(id)) }

func (a *App) DeleteModel(id, quant string) error {
	return a.models.Delete(modelmanager.ModelID(id), modelmanager.QuantKind(quant))
}

func (a *App) SetActiveModel(id string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	if err := a.models.SetActive(modelmanager.ModelID(id)); err != nil {
		return err
	}
	a.cfg.ActiveModel = id
	_ = a.store.SetConfig("app", a.cfg)
	return nil
}

func (a *App) KeepAlive() { a.orch.KeepAlive() }

func (a *App) AssignUnknown(path, id, quant string) (modelmanager.ModelInfo, error) {
	return a.models.AssignUnknown(path, modelmanager.ModelID(id), modelmanager.QuantKind(quant))
}

// ---------- 状态 / 环境 ----------

// SystemStatus 状态栏聚合数据。
type SystemStatus struct {
	Orchestration string                 `json:"orchestration"`
	ActiveModel   string                 `json:"activeModel"`
	Port          int                    `json:"port"`
	GPU           envprobe.GPU           `json:"gpu"`
	IdleMinutes   int                    `json:"idleMinutes"`
	IdleSeconds   int                    `json:"idleSeconds"`
	ActiveTasks   int                    `json:"activeTasks"`
	Version       string                 `json:"version"`
	Offline       bool                   `json:"offline"`
	Models        []modelmanager.ModelInfo `json:"models"`
}

// GetSystemStatus 状态组（01 文档 §7.1）。
func (a *App) GetSystemStatus() (*SystemStatus, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	gpu, _ := envprobe.QueryVRAM()
	models := a.models.List()
	return &SystemStatus{
		Orchestration: string(a.orch.State()),
		ActiveModel:   a.cfg.ActiveModel,
		Port:          a.EndpointPort(),
		GPU:           gpu,
		IdleMinutes:   a.cfg.Resource.IdleUnloadMinutes,
		IdleSeconds:   a.orch.IdleSeconds(),
		ActiveTasks:   a.orch.ActiveTasks(),
		Version:       a.version,
		Offline:       false, // 模型就绪后零网络请求；离线徽标常显
		Models:        models,
	}, nil
}

// ProbeEnv 首次引导环境检测。
func (a *App) ProbeEnv() (*envprobe.EnvInfo, error) {
	info := envprobe.Probe()
	info.Sweep = envprobe.SweepResiduals()
	return info, nil
}

// ---------- 配置 ----------

func (a *App) GetConfig() config.Config { return a.cfg }

// SetConfig 补丁式更新（前端传部分字段需先 Get 再合并；此处全量替换）。
func (a *App) SetConfig(cfg config.Config) error {
	cfg.Normalize()
	a.cfg = cfg
	if !modelmanager.ValidModelID(a.cfg.ActiveModel) {
		a.cfg.ActiveModel = string(modelmanager.ModelTranslate)
	}
	return a.store.SetConfig("app", a.cfg)
}

// ---------- 字幕 ----------

// SubOpen 打开字幕文件对话框并解析。
func (a *App) SubOpen() (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "导入字幕",
		Filters: []runtime.FileFilter{
			{DisplayName: "字幕文件 (SRT/ASS/VTT/LRC)", Pattern: "*.srt;*.ass;*.ssa;*.vtt;*.lrc"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	return a.sub.Open(path)
}

// SubTranslate 启动翻译队列。
func (a *App) SubTranslate(docID string, opt subtitle.QueueOptions) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.sub.TranslateQueue(docID, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

func (a *App) SubPauseQueue(docID string) error  { return a.sub.PauseQueue(docID) }
func (a *App) SubResumeQueue(docID string) error { return a.sub.ResumeQueue(docID) }
func (a *App) SubCancelQueue(docID string)       { a.sub.CancelQueue(docID) }

func (a *App) SubRetryFailed(docID string, opt subtitle.QueueOptions) error {
	return a.sub.RetryFailed(docID, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

func (a *App) SubRetryCues(docID string, ids []int, opt subtitle.QueueOptions) error {
	return a.sub.RetryCues(docID, ids, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

// SubExport 导出（弹出保存对话框）。
func (a *App) SubExport(docID string, opt subtitle.ExportOptions) error {
	doc, err := a.sub.GetDoc(docID)
	if err != nil {
		return err
	}
	base := strings.TrimSuffix(filepath.Base(doc.Path), filepath.Ext(doc.Path))
	ext := string(opt.Format)
	suffix := ""
	if opt.Bilingual == subtitle.BilingualKeepOriginal {
		suffix = ".translated"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出字幕",
		DefaultFilename: base + suffix + "." + ext,
		Filters: []runtime.FileFilter{
			{DisplayName: strings.ToUpper(ext), Pattern: "*." + ext},
		},
	})
	if err != nil {
		return err
	}
	if path == "" {
		return nil
	}
	opt.OutPath = path
	if err := a.sub.Export(docID, opt); err != nil {
		return err
	}
	// keep-original：原文另存（02 文档 §5.4 三模式）
	if opt.Bilingual == subtitle.BilingualKeepOriginal {
		origOpt := opt
		origOpt.Bilingual = subtitle.BilingualTranslationOnly
		origOpt.OutPath = strings.TrimSuffix(path, filepath.Ext(path)) + ".orig." + ext
		// 双语导出中仅译文文件已写为译文；原文另存需原文内容
		return a.sub.ExportOriginal(docID, origOpt)
	}
	return nil
}

// ---------- 文档翻译（M5 预留） ----------

func (a *App) DocTranslate(_ map[string]any) (string, error) {
	return "", errors.New("文档翻译将于 M5 里程碑提供")
}
func (a *App) DocCancel(_ string) error   { return errors.New("文档翻译将于 M5 里程碑提供") }
func (a *App) DocExport(_ string, _ string) error {
	return errors.New("文档翻译将于 M5 里程碑提供")
}

// ---------- 应用 ----------

func (a *App) OpenModelsFolder() error {
	_ = paths.EnsureDirs()
	return openExplorer(paths.ModelsDir())
}

func (a *App) OpenLogsFolder() error {
	_ = paths.EnsureDirs()
	return openExplorer(paths.LogsDir())
}

func openExplorer(dir string) error {
	cmd := exec.Command("explorer", dir)
	return cmd.Start()
}

// CollectLogs 一键打包日志（zip 日志 + 脱敏配置，02 文档 §9 / F-24）。
func (a *App) CollectLogs() (string, error) {
	return a.collectLogsZip()
}

// PrepareExit 退出释放编排（01 文档 §7.1 应用组）。
// 返回释放摘要；前端随后调用 Quit()。
func (a *App) PrepareExit() error {
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return nil
	}
	a.closing = true
	a.mu.Unlock()
	a.log.Info("prepare exit: releasing resources")
	if err := a.orch.PrepareExit(); err != nil {
		a.log.Error("prepare exit failed", "err", err)
		return err
	}
	a.log.Info("prepare exit done")
	return nil
}

// Quit 退出程序。
func (a *App) Quit() {
	runtime.Quit(a.ctx)
}

// GetLanguages 语言清单（150 语言 + auto 由前端处理）。
func (a *App) GetLanguages() []translator.Lang { return translator.Languages }
