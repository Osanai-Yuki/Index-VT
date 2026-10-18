// Wails 绑定层（01 文档 §7.1 API 契约）。
// 流式与进度类数据一律走 Wails Events（translate:delta / translate:done /
// model:progress / subtitle:cue / orch:state），避免轮询。
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"indexvt/internal/atomicfile"
	"indexvt/internal/config"
	"indexvt/internal/csvsanitizer"
	"indexvt/internal/docpipeline"
	"indexvt/internal/envprobe"
	"indexvt/internal/modelmanager"
	"indexvt/internal/orchestrator"
	"indexvt/internal/paths"
	"indexvt/internal/store"
	"indexvt/internal/subtitle"
	"indexvt/internal/translator"
	"indexvt/internal/vramestimate"
)

// App 绑定对象。
type App struct {
	ctx            context.Context
	log            *slog.Logger
	logClose       *func() error
	loggingEnabled bool       // 启动时快照；与应用日志及子进程日志保持一致
	logsMu         sync.Mutex // 串行化日志打包与清理
	cfg            config.Config
	cfgMu          sync.RWMutex // 保护 cfg。不变量：cfg 只能经 cfgSnapshot/withCfg 访问（B8）
	store          *store.Store
	orch           *orchestrator.Orchestrator
	models         *modelmanager.Manager
	tr             *translator.Translator
	sub            *subtitle.Engine
	docpipe        *docpipeline.Engine
	version        string
	ready          chan struct{} // OnStartup 装配完成后关闭（Wails OnStartup 晚于前端加载，需门禁）

	mu          sync.Mutex
	taskSeq     int
	deltas      map[string]*deltaBatcher
	closing     bool
	warmOnce    sync.Once
	warmErr     error
	workspace   map[string]bool // 前端仅报告三个工作台是否有会话内容；退出前提示先导出
	taskCancels map[string]context.CancelFunc
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

// cfgSnapshot 返回 cfg 的完整快照（RLock 下的值拷贝）。
// 已核验（Task 1.7 Step 4）：config.Config 及其全部嵌套结构（Inference/Resource/
// Download/Appearance/HistoryConf 与 CtxTier/SourcePref/CloseBehavior）只含
// int/bool/string 及其 string 别名，无 slice/map/指针字段 —— 一次值赋值即构成
// 完整快照，与 a.cfg 的后续写入互不影响，无需逐字段深拷贝。
func (a *App) cfgSnapshot() config.Config {
	a.cfgMu.RLock()
	defer a.cfgMu.RUnlock()
	return a.cfg
}

// withCfg 在写锁下修改 cfg。不变量（spec §3.3 B8）：
// a.cfg 的每次读写都必须经 cfgSnapshot/withCfg，其余任何位置不得直接触碰 a.cfg。
func (a *App) withCfg(mut func(c *config.Config)) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	mut(&a.cfg)
}

// deltaBatcher translate:delta 50ms 合并窗口（02 文档 §7 现象 A）。
// 顺序不变量：快照（b.mu）与 emit 必须成对串行 —— 所有 flushNow 只允许发生在唯一的
// ticker goroutine 内；close 只发停止信号并等待最终排空，不再自行 emit。
// 否则 ticker 与 close 并发时会「后快照的 chunk 先 emit」→ 前端 delta 乱序（1.1 遗留项）。
type deltaBatcher struct {
	mu       sync.Mutex
	buf      strings.Builder
	last     time.Time
	flush    func(text string)
	stop     chan struct{}
	stopOnce sync.Once
	done     chan struct{} // ticker goroutine 已退出（最终排空完成）
}

func newDeltaBatcher(flush func(string)) *deltaBatcher {
	b := &deltaBatcher{flush: flush, stop: make(chan struct{}), done: make(chan struct{})}
	go func() {
		defer close(b.done)
		t := time.NewTicker(50 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-b.stop:
				b.flushNow() // 最终排空在唯一 flusher 内完成，close 返回即已排空
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
// 并发/重复 close 都等待同一最终排空（done）：返回即代表缓冲已排空且顺序已定。
func (b *deltaBatcher) close() {
	b.stopOnce.Do(func() { close(b.stop) })
	<-b.done
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
	// 先在局部变量上装载/归一化，再一次性写入 cfg：装配窗口内 GetConfig 无门禁
	//（R2），必须保证 a.cfg 永不以“半个值”的形式被读到。
	cfg := config.Default()
	if ok, err := st.GetConfig("app", &cfg); err == nil && ok {
		cfg.Normalize()
	}
	if !modelmanager.ValidModelID(cfg.ActiveModel) {
		cfg.ActiveModel = string(modelmanager.ModelTranslate)
	}
	a.withCfg(func(c *config.Config) { *c = cfg })
	a.loggingEnabled = cfg.LoggingEnabled
	a.logClose = setupLogger(cfg.LoggingEnabled)
	log = slog.Default()
	a.log = log

	// 编排器
	a.orch = orchestrator.New(a, orchestrator.Callbacks{
		OnBeforeStop: func(reason string) {
			// EnsureRunning 仅在没有其他活跃任务时才允许热切换。
			// 此时新队列已注册，不能把触发加载的队列一并取消。
			if reason == "hot-switch" {
				return
			}
			// 回调在 orch.Start() 之后才会触发；仍做 nil 防护，因为装配顺序易被后续改动破坏。
			if a.tr != nil {
				a.tr.CancelAll() // 取消所有任务上下文（断开 SSE，02 文档 §6.2）
			}
			if a.sub != nil {
				a.sub.CancelAllQueues()
			}
			if a.docpipe != nil {
				a.docpipe.CancelAll()
			}
			a.mu.Lock()
			cancels := make([]context.CancelFunc, 0, len(a.taskCancels))
			for _, cancel := range a.taskCancels {
				cancels = append(cancels, cancel)
			}
			pending := make([]*deltaBatcher, 0, len(a.deltas))
			for id, b := range a.deltas {
				delete(a.deltas, id)
				pending = append(pending, b)
			}
			a.mu.Unlock()
			for _, cancel := range cancels {
				cancel()
			}
			// close 幂等（sync.Once）且 done 通道保证排空与顺序，与"在哪个 goroutine 等"无关。
			// 这里必须 go 出去：OnBeforeStop 由持 opMu 的 stopProcLocked 调用，而 close 会等到
			// 最终 flushNow → runtime.EventsEmit；同步等待即等于"持 opMu 期间跨 JS 桥 emit"，
			// 违反 spec §7 的「持锁期间不得调用回调或 EventsEmit」。
			for _, b := range pending {
				go b.close()
			}
		},
		OnEvent: func(ev orchestrator.Event) {
			runtime.EventsEmit(a.ctx, "orch:event", ev)
			if ev.Kind == "state" && ev.State == "running" && ev.Model != "" && a.models != nil {
				a.models.MarkRan(ev.Model)
			}
		},
	}, log)

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
	a.models.SetActiveID(a.cfgSnapshot().ActiveModel)
	a.models.ScanLocal()

	// 翻译器
	a.tr = translator.NewTranslator(translator.Deps{
		ResolveEndpoint: func(ctx context.Context, modelID string) (string, string, error) {
			path, _, err := a.models.ResolveModelPath(modelmanager.ModelID(modelID))
			if err != nil {
				return "", "", err
			}
			ep, err := a.orch.TaskBeginContext(ctx, path, modelID)
			if err != nil {
				if ctx.Err() != nil {
					return "", "", translator.ErrCanceled
				}
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
			return a.cfgSnapshot().ActiveModel
		},
		ModelName: func(modelID string) string {
			return "index-" + modelID + "-2b"
		},
		CtxTokens: func() int {
			return int(a.cfgSnapshot().EffectiveCtxTokens())
		},
		Log: log,
	}, log)

	// 字幕引擎（单条翻译桥接）
	subtitle.SetOffTargetChecker(translator.DetectOffTarget)
	a.sub = subtitle.NewEngine(func(ctx context.Context, text, sourceLang, targetLang string) (string, error) {
		terms := subtitle.GlossaryFromContext(ctx)
		glossary := make([]translator.GlossaryItem, len(terms))
		for i, it := range terms {
			glossary[i] = translator.GlossaryItem{Term: it.Term, Translation: it.Translation}
		}
		return a.tr.TranslateSync(ctx, translator.TranslateRequest{
			SourceLang:  sourceLang,
			TargetLang:  targetLang,
			Text:        text,
			Constraints: &translator.Constraints{Glossary: glossary},
		})
	})

	// 长文档管线（M5）：方向模板 + 术语注入在 docpipeline 组装，本层只桥接
	// Nailong 通道（模型激活/端口编排由 ResolveEndpoint 承担，与字幕同路）。
	a.docpipe = docpipeline.NewEngine(func(ctx context.Context, prompt string, maxTokens int) (string, error) {
		return a.tr.TranslateRawSync(ctx, string(modelmanager.ModelNailong), prompt, maxTokens)
	})

	// 编排看护协程最后启动：此时 store/cfg/models/tr/sub 均已赋值，
	// idleWatch 触发的 OnBeforeStop/OnEvent 才不会打到 nil 字段（回调另有 nil 防护兜底）。
	a.orch.Start()
	close(a.ready) // 装配完成，放行绑定调用
	return nil
}

func (a *App) shutdown() {
	a.mu.Lock()
	already := a.closing // PrepareExit 绑定已先置位时（前端 Ctrl+Q / 点 X 的 OnBeforeClose）不再重复释放编排
	a.closing = true
	orch, st := a.orch, a.store
	a.mu.Unlock()

	if !already && orch != nil {
		_ = orch.PrepareExit() // 兜底全量释放（正常路径走 PrepareExit 绑定）
	}
	if a.docpipe != nil {
		a.docpipe.CancelAll() // 长文档队列与字幕同语义：退出即取消，进程释放由 Job Object 兜底
	}
	// 必须无条件执行：PrepareExit 绑定（前端 Ctrl+Q 与点 X 的 OnBeforeClose）会先置 closing，
	// 若这里因 closing 提前返回，SQLite 句柄在两条退出路径上都不会被关闭，WAL 也不会 checkpoint。
	if st != nil {
		_ = st.Close() // 幂等：database/sql.DB.Close 对重复调用返回 nil（stdlib 显式保证）
	}
}

// sourcePref 读取配置的下载源偏好。经 cfgSnapshot 取一致快照；
// 该函数被 modelmanager 在装配期与下载期调用，不设 ensureReady 门禁（值类型配置恒可读）。
func (a *App) sourcePref() string { return string(a.cfgSnapshot().Download.SourcePref) }

// ---------- orchestrator.Settings / modelmanager.OrchestratorView 适配 ----------

// NGLOverride/CtxTokens/CPUThreads/IdleMinutes 是 orchestrator.Settings 适配方法，
// 由编排内部（args.go 的 buildArgs、idleWatch）调用，装配期也可能读取：
// 只做快照、不加 ensureReady 门禁 —— a.cfg 是值类型，零值即合法默认配置，
// 门禁反而会让编排协程空等 30s。
func (a *App) NGLOverride() int     { return a.cfgSnapshot().Inference.NGLOverride }
func (a *App) LoggingEnabled() bool { return a.loggingEnabled }
func (a *App) CtxTokens() int64     { return a.cfgSnapshot().EffectiveCtxTokens() }

// ---------- 上下文显存估算 ----------

// CtxEstimate 上下文显存的**估算**（非实测）：对 01 文档 §3.2 表校准的线性模型，
// 偏差 ±20% 量级（并发 slot / flash-attn / 驱动缓存都不在模型里）。单位一律 MiB，
// 与 nvidia-smi 口径一致。前端文案必须写"预计"。
type CtxEstimate struct {
	Tokens      int64        `json:"tokens"`
	WeightsMiB  int          `json:"weightsMiB"`
	KvMiB       int          `json:"kvMiB"`
	ActivateMiB int          `json:"activateMiB"`
	TotalMiB    int          `json:"totalMiB"`
	GPU         envprobe.GPU `json:"gpu"`
	ExceedsFree bool         `json:"exceedsFree"`
	Basis       string       `json:"basis"`
}

// estimateCtxVRAM 组装设置页要的结构化估算（纯函数，便于单测）。
// **公式本体在 internal/vramestimate**，与 orchestrator 的 resolveNGL 共用同一份，
// 避免两处各写一套常数而漂移（历史上就漂移过：见该包的文件头注释）。
// weightsMiB 传 0 表示未知 → 由该包落到兜底权重。
func estimateCtxVRAM(tokens int64, weightsMiB int, gpu envprobe.GPU) CtxEstimate {
	e0 := vramestimate.For(tokens, weightsMiB)
	basis := fmt.Sprintf("线性估算：权重 + ctx×%d/8192 + %d MiB（2026-10-06 实测标定，Nailong Q4_K_M 填满上下文拟合；单向偏保守 +3.5%%~15.7%%）",
		vramestimate.KVPer8KMiB, vramestimate.FixedMiB)
	if weightsMiB <= 0 {
		basis += "；权重取 translate Q4_K_M 兜底值"
	}
	e := CtxEstimate{
		Tokens:      tokens,
		WeightsMiB:  e0.WeightsMiB,
		KvMiB:       e0.KvMiB,
		ActivateMiB: e0.ActivateMiB,
		TotalMiB:    e0.TotalMiB,
		GPU:         gpu,
		Basis:       basis,
	}
	if !gpu.Present {
		e.Basis += "；CPU 模式：无显存可估"
		return e
	}
	e.ExceedsFree = e.TotalMiB > gpu.FreeMB
	return e
}

// activeModelWeightsMiB 当前 active 模型已就位档位的最大体积（MiB）；取不到返回 0。
func activeModelWeightsMiB(m *modelmanager.Manager) int {
	for _, mi := range m.List() {
		if !mi.Active {
			continue
		}
		var best int64
		for _, q := range mi.Quants {
			if q.Present && q.SizeBytes > best {
				best = q.SizeBytes
			}
		}
		return int(best / (1024 * 1024))
	}
	return 0
}

// EstimateCtxVRAM 估算给定上下文长度的显存占用（设置页自定义档用）。
func (a *App) EstimateCtxVRAM(tokens int64) (*CtxEstimate, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	if tokens < 2048 || tokens > 65536 {
		return nil, fmt.Errorf("上下文长度需在 2048–65536 之间（当前 %d）", tokens)
	}
	gpu, _ := envprobe.QueryVRAMCached(15 * time.Second) // 15s TTL：显存是粗粒度指标，容忍滞后
	e := estimateCtxVRAM(tokens, activeModelWeightsMiB(a.models), gpu)
	return &e, nil
}
func (a *App) CPUThreads() int  { return a.cfgSnapshot().Inference.CPUThreads }
func (a *App) IdleMinutes() int { return a.cfgSnapshot().Resource.IdleUnloadMinutes }

// State/CurrentModel/EndpointPort/IdleSeconds/ActiveTasks 同时是 Wails 绑定与
// modelmanager.OrchestratorView 的实现：装配完成前 a.orch 为 nil，故设 ensureReady 门禁
// （未就绪/超时返回零值）。CurrentModelPath 是预留常量、无 nil 依赖，无需门禁。
func (a *App) State() string {
	if a.ensureReady() != nil {
		return ""
	}
	return string(a.orch.State())
}

func (a *App) CurrentModel() string {
	if a.ensureReady() != nil {
		return ""
	}
	return a.orch.CurrentModel()
}

func (a *App) CurrentModelPath() string { return "" } // 预留：模型中心路径显示

func (a *App) EndpointPort() int {
	if a.ensureReady() != nil {
		return 0
	}
	ep, ok := a.orch.Endpoint()
	if !ok {
		return 0
	}
	return ep.Port
}

func (a *App) IdleSeconds() int {
	if a.ensureReady() != nil {
		return 0
	}
	return a.orch.IdleSeconds()
}

func (a *App) ActiveTasks() int {
	if a.ensureReady() != nil {
		return 0
	}
	return a.orch.ActiveTasks()
}

// ---------- 翻译 ----------

// TranslateRequestUI 前端翻译请求。
type TranslateRequestUI struct {
	SourceLang string `json:"sourceLang"` // "auto" 或语言码
	TargetLang string `json:"targetLang"`
	Text       string `json:"text"`
	Dubbing    bool   `json:"dubbing,omitempty"`
	Syllables  int    `json:"syllables,omitempty"`
	GlossaryID int64  `json:"glossaryId,omitempty"`
	// 约束抽屉五字段（Track C 接线；Hard/Soft 每行一条，Genre 空 = 后端默认"文本"）
	Hard         []string `json:"hard,omitempty"`
	Soft         []string `json:"soft,omitempty"`
	Genre        string   `json:"genre,omitempty"`
	JSONPreserve bool     `json:"jsonPreserve,omitempty"`
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

	glossary, err := a.loadGlossary(req.GlossaryID)
	if err != nil {
		return TaskHandle{}, err
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
	taskCtx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	if a.taskCancels == nil {
		a.taskCancels = map[string]context.CancelFunc{}
	}
	a.taskCancels[taskID] = cancel
	a.deltas[taskID] = batcher
	a.mu.Unlock()

	go func() {
		start := time.Now()
		// 任务 ctx 必须受应用生命周期约束。旧写法 context.Background() 意味着
		// 挂死的推理请求永远无法被回收，activeTasks 永久 >0 → 空闲卸载永不触发（B23）。
		defer cancel()

		// R17：累积已产出的部分译文——错误分支也要带给前端（error 态渲染部分译文 + 错误提示）
		var partial strings.Builder

		res, err := a.tr.Translate(taskCtx, translator.TranslateRequest{
			TaskID:      taskID,
			SourceLang:  source,
			TargetLang:  req.TargetLang,
			Text:        req.Text,
			Mode:        mode,
			Syllables:   req.Syllables,
			Constraints: &translator.Constraints{Glossary: glossary, Hard: req.Hard, Soft: req.Soft, Genre: req.Genre, JSONPreserve: req.JSONPreserve},
		}, func(delta string) {
			partial.WriteString(delta)
			batcher.append(delta)
		})
		batcher.close()
		a.mu.Lock()
		delete(a.deltas, taskID)
		delete(a.taskCancels, taskID)
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
			// R17：错误（含首字超时）前已流式产出的文本一并返回，前端不清空
			if p := partial.String(); p != "" {
				done["output"] = p
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
			_ = a.store.TrimHistory(a.cfgSnapshot().History.MaxEntries)
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
	a.mu.Lock()
	cancel := a.taskCancels[taskID]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
		return nil
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
func (a *App) DeleteHistory(id int64) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.store.DeleteHistory(id)
}

func (a *App) StarHistory(id int64, starred bool) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.store.StarHistory(id, starred)
}

func (a *App) ClearHistory() error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.store.ClearHistory()
}

// ---------- 术语 ----------

func (a *App) ListGlossaries() ([]store.Glossary, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.store.ListGlossaries()
}

func (a *App) SaveGlossary(g store.Glossary) (int64, error) {
	if err := a.ensureReady(); err != nil {
		return 0, err
	}
	return a.store.SaveGlossary(g)
}

func (a *App) DeleteGlossary(id int64) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.store.DeleteGlossary(id)
}

func (a *App) ExportGlossaryCSV(id int64) (string, error) {
	if err := a.ensureReady(); err != nil {
		return "", err
	}
	gs, err := a.store.ListGlossaries()
	if err != nil {
		return "", err
	}
	for _, g := range gs {
		if g.ID == id {
			var b strings.Builder
			b.WriteString("term,translation\n")
			for _, it := range g.Items {
				b.WriteString(csvsanitizer.Quote(it.Term) + "," + csvsanitizer.Quote(it.Translation) + "\n")
			}
			return b.String(), nil
		}
	}
	return "", fmt.Errorf("术语本 %d 不存在", id)
}

func (a *App) SaveGlossaryCSV(id int64) (string, error) {
	text, err := a.ExportGlossaryCSV(id)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "导出术语本", DefaultFilename: "glossary.csv", Filters: []runtime.FileFilter{{DisplayName: "CSV", Pattern: "*.csv"}}})
	if err != nil || path == "" {
		return "", err
	}
	if err := atomicfile.Write(path, []byte(text)); err != nil {
		return "", err
	}
	return path, nil
}

// ---------- 模型 ----------

func (a *App) ListModels() ([]modelmanager.ModelInfo, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.models.List(), nil
}

func (a *App) GetDownloadLocation() (modelmanager.DownloadLocation, error) {
	if err := a.ensureReady(); err != nil {
		return modelmanager.DownloadLocation{}, err
	}
	return modelmanager.GetDownloadLocation(), nil
}

func (a *App) ListUnknownModels() ([]modelmanager.ModelInfo, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.models.ListUnknown(), nil
}

func (a *App) DownloadModel(id, quant string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	_, err := a.models.Download(modelmanager.ModelID(id), modelmanager.QuantKind(quant))
	return err
}

func (a *App) CancelDownload(id string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.models.CancelDownload(modelmanager.ModelID(id))
}

func (a *App) DeleteModel(id, quant string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.models.Delete(modelmanager.ModelID(id), modelmanager.QuantKind(quant))
}

func (a *App) SetActiveModel(id string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	if a.sub.HasActiveQueue() || a.docpipe.HasActiveQueue() {
		return fmt.Errorf("请先结束字幕/文档任务，再切换模型")
	}
	if err := a.models.SetActive(modelmanager.ModelID(id)); err != nil {
		return err
	}
	// 锁内 read-modify-write：整体覆盖会与 SetConfig 互相丢字段（B9）。
	var stored config.Config
	a.withCfg(func(c *config.Config) {
		c.ActiveModel = id
		stored = *c
	})
	// 持久化在锁外进行：数据库 I/O 不得占用 cfgMu。
	return a.store.SetConfig("app", stored)
}

// KeepAlive 无返回值：未就绪时忽略（无副作用可丢，brief Step 6）。
func (a *App) KeepAlive() {
	if a.ensureReady() != nil {
		return
	}
	a.orch.KeepAlive()
}

// WarmDefaultModel 由前端就绪后调用：预加载保存的默认模型和上下文，不阻塞窗口创建。
// StrictMode 或重复桥接调用共享同一次预加载；退出后的 EnsureRunning 拒绝重启。
func (a *App) WarmDefaultModel() error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	a.warmOnce.Do(func() {
		cfg := a.cfgSnapshot()
		path, _, err := a.models.ResolveModelPath(modelmanager.ModelID(cfg.ActiveModel))
		if err != nil {
			a.warmErr = err
			return
		}
		_, a.warmErr = a.orch.TaskBegin(path, cfg.ActiveModel)
		if a.warmErr == nil {
			a.orch.TaskDone()
		}
	})
	return a.warmErr
}

func (a *App) AssignUnknown(path, id, quant string) (modelmanager.ModelInfo, error) {
	if err := a.ensureReady(); err != nil {
		return modelmanager.ModelInfo{}, err
	}
	return a.models.AssignUnknown(path, modelmanager.ModelID(id), modelmanager.QuantKind(quant))
}

// ---------- 状态 / 环境 ----------

// SystemStatus 状态栏聚合数据。
type SystemStatus struct {
	Orchestration      string                   `json:"orchestration"`
	ActiveModel        string                   `json:"activeModel"`
	RunningModel       string                   `json:"runningModel"`
	LoadedCtxTokens    int64                    `json:"loadedCtxTokens"`
	Port               int                      `json:"port"`
	GPU                envprobe.GPU             `json:"gpu"`
	IdleMinutes        int                      `json:"idleMinutes"`
	IdleSeconds        int                      `json:"idleSeconds"`
	IdleReleaseSeconds int                      `json:"idleReleaseSeconds"` // -1=未倒计时
	ActiveTasks        int                      `json:"activeTasks"`
	Version            string                   `json:"version"`
	Offline            bool                     `json:"offline"`
	Models             []modelmanager.ModelInfo `json:"models"`
}

// GetSystemStatus 状态组（01 文档 §7.1）。
func (a *App) GetSystemStatus() (*SystemStatus, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	// 15s TTL = 前端轮询周期（5000ms）的 3 倍：TTL 与轮询同频（原 5s）时几乎每次
	// 请求都落在缓存过期点上，每轮仍 spawn 一个 nvidia-smi，1.15 的缓存形同虚设（B25）；
	// 显存是粗粒度指标，容忍一两个周期的滞后。Probe() 一次性路径仍直调 QueryVRAM。
	gpu, _ := envprobe.QueryVRAMCached(15 * time.Second)
	models := a.models.List()
	c := a.cfgSnapshot()
	return &SystemStatus{
		Orchestration:      string(a.orch.State()),
		ActiveModel:        c.ActiveModel,
		RunningModel:       a.orch.CurrentModel(),
		LoadedCtxTokens:    a.orch.LoadedCtxTokens(),
		Port:               a.EndpointPort(),
		GPU:                gpu,
		IdleMinutes:        c.Resource.IdleUnloadMinutes,
		IdleSeconds:        a.orch.IdleSeconds(),
		IdleReleaseSeconds: a.orch.IdleReleaseSeconds(),
		ActiveTasks:        a.orch.ActiveTasks(),
		Version:            a.version,
		Offline:            false, // 模型就绪后零网络请求；离线徽标常显
		Models:             models,
	}, nil
}

// ProbeEnv 首次引导环境检测。
func (a *App) ProbeEnv() (*envprobe.EnvInfo, error) {
	info := envprobe.Probe()
	info.Sweep = envprobe.SweepResiduals()
	return info, nil
}

// ---------- 配置 ----------

// GetConfig 配置快照。不加 ensureReady 门禁（控制器裁定 R2）：仅在 RWMutex 下拷贝值，
// 不可能失败；装配期返回零值 Config 无害，而门禁会让设置页在启动期空白。
func (a *App) GetConfig() config.Config { return a.cfgSnapshot() }

// SetConfig 补丁式更新（前端传部分字段需先 Get 再合并；此处全量替换）。
func (a *App) SetConfig(cfg config.Config) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	cfg.Normalize()
	old := a.cfgSnapshot()
	if (cfg.Inference != old.Inference || cfg.ActiveModel != old.ActiveModel) && a.tasksBusy() {
		return fmt.Errorf("任务进行中，请结束任务后修改推理参数；外观设置仍可修改")
	}
	if !modelmanager.ValidModelID(cfg.ActiveModel) {
		cfg.ActiveModel = string(modelmanager.ModelTranslate)
	}
	a.withCfg(func(c *config.Config) { *c = cfg })
	// 持久化在锁外进行：数据库 I/O 不得占用 cfgMu。
	return a.store.SetConfig("app", cfg)
}

func (a *App) tasksBusy() bool {
	return (a.orch != nil && a.orch.ActiveTasks() > 0) || (a.sub != nil && a.sub.HasActiveQueue()) || (a.docpipe != nil && a.docpipe.HasActiveQueue())
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
	var err error
	opt, err = a.subtitleOptions(opt)
	if err != nil {
		return err
	}
	return a.sub.TranslateQueue(docID, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

func (a *App) SubPauseQueue(docID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.sub.PauseQueue(docID)
}

func (a *App) SubResumeQueue(docID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.sub.ResumeQueue(docID)
}

// SubCancelQueue 无返回值：未就绪时忽略（装配期不存在可取消的队列）。
func (a *App) SubCancelQueue(docID string) {
	if a.ensureReady() != nil {
		return
	}
	a.sub.CancelQueue(docID)
}

func (a *App) SubRetryFailed(docID string, opt subtitle.QueueOptions) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	var err error
	opt, err = a.subtitleOptions(opt)
	if err != nil {
		return err
	}
	return a.sub.RetryFailed(docID, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

func (a *App) SubRetryCues(docID string, ids []int, opt subtitle.QueueOptions) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	var err error
	opt, err = a.subtitleOptions(opt)
	if err != nil {
		return err
	}
	return a.sub.RetryCues(docID, ids, opt, func(p subtitle.CueProgress) {
		runtime.EventsEmit(a.ctx, "subtitle:cue", p)
	})
}

func (a *App) subtitleOptions(opt subtitle.QueueOptions) (subtitle.QueueOptions, error) {
	items, err := a.loadGlossary(opt.GlossaryID)
	if err != nil {
		return opt, err
	}
	opt.Terms = make([]subtitle.GlossaryTerm, len(items))
	for i, it := range items {
		opt.Terms[i] = subtitle.GlossaryTerm{Term: it.Term, Translation: it.Translation}
	}
	return opt, nil
}

// SubGetDoc 返回文档权威快照。用于：队列结束后一次性校准、事件丢包兜底、
// 以及 cue 表滚动到未订阅区间时的补全。
func (a *App) SubGetDoc(docID string) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.GetDoc(docID)
}

// SubExport 导出（弹出保存对话框）。
func (a *App) SubExport(docID string, opt subtitle.ExportOptions) (string, error) {
	if err := a.ensureReady(); err != nil {
		return "", err
	}
	doc, err := a.sub.GetDoc(docID)
	if err != nil {
		return "", err
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
		return "", err
	}
	if path == "" {
		return "", nil
	}
	opt.OutPath = path
	if opt.Bilingual == subtitle.BilingualKeepOriginal {
		secondary := strings.TrimSuffix(path, filepath.Ext(path)) + ".orig." + ext
		if _, err := os.Stat(secondary); err == nil {
			choice, err := runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "确认同时替换原文副本", Message: "另外的原文文件已存在：" + secondary + "。继续将同时替换两个导出文件。", Buttons: []string{"取消", "替换两个文件"}, DefaultButton: "取消", CancelButton: "取消"})
			if err != nil {
				return "", err
			}
			if choice != "替换两个文件" {
				return "", nil
			}
		}
	}
	if err := a.sub.ExportFiles(docID, opt); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) SubUndo(id string, redo bool) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.Undo(id, redo)
}

func (a *App) SubShiftCue(id string, index int, field string, delta int64) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.ShiftCue(id, index, field, delta)
}

// ---------- 字幕编辑（M4） ----------

// SubUpdateCue 行内编辑：改 index 对应 cue 的任意子集。不改序号。
func (a *App) SubUpdateCue(docID string, index int, patch subtitle.CuePatch) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.UpdateCue(docID, index, patch)
}

// SubSplitCue 拆分：atMs ∈ (start, end) 开区间。
func (a *App) SubSplitCue(docID string, index int, atMs int64) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.SplitCue(docID, index, atMs)
}

// SubMergeCues 合并连续区间 [from..to]（≥2 条）。
func (a *App) SubMergeCues(docID string, fromIndex, toIndex int) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.MergeCues(docID, fromIndex, toIndex)
}

// SubShiftAll 整体平移：全部条目 start/end += deltaMs。
func (a *App) SubShiftAll(docID string, deltaMs int64) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.ShiftAll(docID, deltaMs)
}

// SubCalibrate 两点校准：线性映射。
func (a *App) SubCalibrate(docID string, anchor1Idx, anchor2Idx int, anchor1Ms, anchor2Ms int64) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.Calibrate(docID, anchor1Idx, anchor2Idx, anchor1Ms, anchor2Ms)
}

// SubDeleteCues 删除选中条目，重排。
func (a *App) SubDeleteCues(docID string, indices []int) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.DeleteCues(docID, indices)
}

// SubInsertCue 在 afterIndex 后插一条 2s 空白 cue。
func (a *App) SubInsertCue(docID string, afterIndex int) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.InsertCue(docID, afterIndex)
}

// SubStyles 返回文档的样式库列表（结构化字段）。
func (a *App) SubStyles(docID string) ([]subtitle.StyleDef, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.Styles(docID)
}

// SubSetStyle 按 Name upsert 样式（存在则改，不存在则追加）。
func (a *App) SubSetStyle(docID string, style subtitle.StyleDef) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.SetStyle(docID, style)
}

// SubAssignStyle 按行指派样式（indices 为 1 起始序号列表）。
func (a *App) SubAssignStyle(docID string, indices []int, styleName string) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.AssignStyle(docID, indices, styleName)
}

// ---------- 文档翻译（M5） ----------

// DocMaxRunes 输入规模上限（M5 报告 §10 决策 5：v1 按 2 万字交付、5 万字封顶）。
const DocMaxRunes = 50000

// DocRequestUI 长文档翻译请求。
type DocRequestUI struct {
	Path       string `json:"path"`
	Direction  string `json:"direction"` // zh-en / en-zh / zh-ja / ja-zh
	GlossaryID int64  `json:"glossaryId,omitempty"`
}

// DocPickResult 文件预读结果（选择文件但不建任务，方向/术语本在页面确认后再 DocTranslate）。
type DocPickResult struct {
	Path        string `json:"path"`
	Chars       int    `json:"chars"`
	TooLong     bool   `json:"tooLong"`
	Unsupported bool   `json:"unsupported"`
}

// DocPick 弹出文件对话框（txt/md）并预读：返回路径与字数供页面确认，
// 超上限/空文件在此时就地标记，避免用户配置完方向才被拒绝。
func (a *App) DocPick() (*DocPickResult, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "导入长文档（txt / md）",
		Filters: []runtime.FileFilter{
			{DisplayName: "文本文档 (*.txt;*.md)", Pattern: "*.txt;*.md"},
		},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // 用户取消
	}
	raw, err := readDocument(path)
	if err != nil {
		return nil, err
	}
	text, _ := subtitle.DecodeText(raw)
	res := &DocPickResult{Path: path, Chars: len([]rune(text))}
	res.TooLong = res.Chars > DocMaxRunes
	res.Unsupported = strings.TrimSpace(text) == ""
	return res, nil
}

// DocTranslate 打开长文档（txt/md，编码识别复用 subtitle.DecodeText）并启动整卷翻译。
// 进度经 doc:progress 事件、终态经 doc:done 事件（含取消与覆盖率统计）。
func (a *App) DocTranslate(req DocRequestUI) (string, error) {
	if err := a.ensureReady(); err != nil {
		return "", err
	}
	dir := translator.NailongDirection(req.Direction)
	raw, err := readDocument(req.Path)
	if err != nil {
		return "", err
	}
	text, _ := subtitle.DecodeText(raw)
	glossary, err := a.loadGlossary(req.GlossaryID)
	if err != nil {
		return "", err
	}
	docID, err := a.docpipe.Open(req.Path, text, dir, glossary,
		int(a.cfgSnapshot().EffectiveCtxTokens()), DocMaxRunes)
	if err != nil {
		return "", err
	}
	if err := a.docRun(docID); err != nil {
		return "", err
	}
	return docID, nil
}

func readDocument(path string) ([]byte, error) {
	const maxBytes = 2 << 20
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxBytes {
		return nil, fmt.Errorf("文档文件超过2MiB或不是普通文件，请拆分为50000字以内的文本")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("读取时文件增大，请拆分后重新导入")
	}
	return data, nil
}

// DocResume 续跑：只重翻 pending/failed 块，done 保留（取消/失败后的恢复路径）。
func (a *App) DocResume(docID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.docRun(docID)
}

func (a *App) DocRestart(docID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	return a.docpipe.Restart(docID, func(p docpipeline.DocProgress) { runtime.EventsEmit(a.ctx, "doc:progress", p) }, func(r docpipeline.DocDone) { runtime.EventsEmit(a.ctx, "doc:done", r) })
}

// docRun 启动队列并把管线事件桥到 Wails 事件总线。
func (a *App) docRun(docID string) error {
	return a.docpipe.Run(docID,
		func(p docpipeline.DocProgress) {
			runtime.EventsEmit(a.ctx, "doc:progress", p)
		},
		func(r docpipeline.DocDone) {
			runtime.EventsEmit(a.ctx, "doc:done", r)
		},
	)
}

// DocCancel 取消整卷任务；已产出块保留，DocResume 可续跑。
func (a *App) DocCancel(docID string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	a.docpipe.Cancel(docID)
	return nil
}

// DocGetDoc 权威快照（进度条对账、事件丢包兜底）。
func (a *App) DocGetDoc(docID string) (*docpipeline.Doc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.docpipe.Get(docID)
}

// DocExport 导出（弹出保存对话框）。kind: translation | bilingual。
// 返回实际写入的路径；用户取消保存对话框时返回空串（前端据此不弹"已导出"）。
func (a *App) DocExport(docID string, kind string) (string, error) {
	if err := a.ensureReady(); err != nil {
		return "", err
	}
	doc, err := a.docpipe.Get(docID)
	if err != nil {
		return "", err
	}
	text, err := a.docpipe.ExportText(docID, docpipeline.ExportKind(kind))
	if err != nil {
		return "", err
	}
	base := strings.TrimSuffix(filepath.Base(doc.Path), filepath.Ext(doc.Path))
	suffix := ""
	if docpipeline.ExportKind(kind) == docpipeline.ExportBilingual {
		suffix = ".bilingual"
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "导出译文",
		DefaultFilename: base + suffix + ".txt",
		Filters:         []runtime.FileFilter{{DisplayName: "TXT", Pattern: "*.txt"}},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // 用户取消
	}
	if err := atomicfile.ProtectSource(doc.Path, path); err != nil {
		return "", err
	}
	if err := atomicfile.Write(path, []byte(text)); err != nil {
		return "", err
	}
	return path, nil
}

func (a *App) RevealFile(path string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("文件不存在或无法访问：%w", err)
	}
	return exec.Command("explorer.exe", "/select,", filepath.Clean(path)).Start()
}

func (a *App) NoteWorkspace(page string, dirty bool) {
	if a.ensureReady() != nil {
		return
	}
	if page != "translate" && page != "doc" && page != "subtitle" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.workspace == nil {
		a.workspace = map[string]bool{}
	}
	a.workspace[page] = dirty
}

func (a *App) ConfirmExit() (bool, error) {
	return a.confirmExit(runtime.MessageDialog)
}

func (a *App) confirmExit(showDialog func(context.Context, runtime.MessageDialogOptions) (string, error)) (bool, error) {
	if err := a.ensureReady(); err != nil {
		return false, err
	}
	a.mu.Lock()
	closing := a.closing
	unsaved := false
	for _, dirty := range a.workspace {
		unsaved = unsaved || dirty
	}
	a.mu.Unlock()
	if closing || !unsaved {
		return true, nil
	}
	// Windows QuestionDialog 忽略自定义按钮文案，只返回 "Yes" / "No"。
	// 同时使用原生支持的按钮值，确保默认焦点落在不退出的一项。
	button, err := showDialog(a.ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "关闭前请保存工作台内容", Message: "工作台草稿与字幕/文档会话在关闭后不会恢复。请先返回复制或导出需要保留的内容；历史记录不受影响。仍要退出吗？", Buttons: []string{"Yes", "No"}, DefaultButton: "No", CancelButton: "No"})
	return err == nil && button == "Yes", err
}

// loadGlossary 术语本加载（与主翻译台绑定共用 store 读取路径）。
func (a *App) loadGlossary(id int64) ([]translator.GlossaryItem, error) {
	if id <= 0 {
		return nil, nil
	}
	gs, err := a.store.ListGlossaries()
	if err != nil {
		return nil, err
	}
	for _, g := range gs {
		if g.ID == id {
			items := make([]translator.GlossaryItem, 0, len(g.Items))
			for _, it := range g.Items {
				items = append(items, translator.GlossaryItem{Term: it.Term, Translation: it.Translation})
			}
			return items, nil
		}
	}
	return nil, fmt.Errorf("术语本 %d 已不存在，请重新选择", id)
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
// 返回值为 zip 路径 + 说明文案，前端（Settings.tsx）直接展示该字符串。
// 推理日志 llama-server.out.log 默认不打包 —— 可能含提示词原文（logs.go 排除表）。
func (a *App) CollectLogs() (string, error) {
	a.logsMu.Lock()
	defer a.logsMu.Unlock()
	p, err := a.collectLogsZip()
	if err != nil {
		return "", err
	}
	return p + "（未包含推理日志）", nil
}

// PrepareExit 退出释放编排（01 文档 §7.1 应用组）。
// 前端在 Quit() 前调用；点 X 关窗路径由 main.go 的 OnBeforeClose 调用。
// 返回契约不变：非 nil 错误意为"释放失败"，前端仍会继续退出。
// 幂等：closing 置位后重复调用直接返回 nil。
// nil 防护：装配（OnStartup）完成前 a.log/a.orch 尚为 nil，此时也必须能走完并放行关闭。
func (a *App) PrepareExit() error {
	log := a.log
	if log == nil {
		log = slog.Default() // 装配尚未完成时也要能记录退出意图
	}
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return nil
	}
	a.closing = true
	orch := a.orch
	a.mu.Unlock()

	if orch == nil {
		return nil // 编排器还没起来，无可释放
	}
	log.Info("prepare exit: releasing resources")
	if err := orch.PrepareExit(); err != nil {
		log.Error("prepare exit failed", "err", err)
		return err
	}
	log.Info("prepare exit done")
	return nil
}

// Quit 退出程序。
func (a *App) Quit() {
	// OnStartup 前 a.ctx == nil：v2.16.0 的 runtime.Quit 对 nil ctx 走
	// log.Fatalf 直接杀进程（runtime.go:64），此时静默返回即可 —— 尚无窗口，无需退出序列。
	if a.ctx == nil {
		return
	}
	runtime.Quit(a.ctx)
}

// GetLanguages 语言清单（150 语言 + auto 由前端处理）。
func (a *App) GetLanguages() []translator.Lang { return translator.Languages }
