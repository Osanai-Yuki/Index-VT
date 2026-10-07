package translator

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"indexvt/internal/modelmanager"
)

// ModeKind 翻译模式（ADR-004：Normal→Translate-2B，Dubbing→Homura-2B）。
type ModeKind string

const (
	ModeNormal  ModeKind = "normal"
	ModeDubbing ModeKind = "dubbing"
)

// TranslateRequest 一次翻译请求（01 文档 §5.3）。
type TranslateRequest struct {
	TaskID      string
	SourceLang  string // "" 或 "auto" 表示自动检测
	TargetLang  string
	Text        string
	Constraints *Constraints
	Mode        ModeKind
	Syllables   int // 配音模式目标音节数
}

// TranslateResult 翻译结果。
type TranslateResult struct {
	Output           string
	OffTargetSuspect bool
	DetectedSource   string
	TargetSyllables  int
	ActualSyllables  int
	CompletionTokens int
	TokensPerSec     float64
	FirstTokenMs     int64
}

// ErrCanceled 任务被取消。
var ErrCanceled = errors.New("已取消")

// ErrFirstTokenTimeout 首字节看门狗：模型已连接但迟迟不产出首个增量，请求被主动中止。
var ErrFirstTokenTimeout = errors.New("模型未在预期时间内返回首字")

// firstTokenTimeout 首字节看门狗：模型已连接但迟迟不出字时中止，避免界面无限等。
// 是 var 而非 const —— 测试需要把它压到毫秒级。
var firstTokenTimeout = 60 * time.Second

// OrchestratorView translator 感知编排所需的最小接口。
type OrchestratorView interface {
	TaskBegin(modelPath, modelID string) (endpoint string, err error)
	TaskDone()
	CancelAll(reason string)
}

// Deps translator 依赖注入。
type Deps struct {
	// ResolveEndpoint 返回 (端点BaseURL, 模型本地路径, 错误)；由 app 层桥接 modelmanager+orchestrator。
	ResolveEndpoint func(ctx context.Context, modelID string) (baseURL, modelPath string, err error)
	// OnTaskFinish 任务结束（成功/失败/取消）回调：app 层用于 orchestrator.TaskDone()。
	OnTaskFinish func(modelID string)
	// ModelForMode 模式→模型 ID 映射（ADR-004）。
	ModelForMode func(mode ModeKind) string
	// ModelName 推理请求 model 字段值。
	ModelName func(modelID string) string
	// CtxTokens 生效上下文长度（llama-server -c，来自设置页 ctx 档位）；0 = 未知。
	// max_tokens 预算用它钳制：本服务端构建对 prompt+max_tokens 超限返回
	// HTTP 400（M5 报告 §7.6 实测 exceed_context_size_error），过大的 max_tokens
	// 会把今天能跑的请求弄挂，未知时回落注册表基值不放大。
	CtxTokens func() int
	Log       *slog.Logger
}

// Translator 翻译服务实现。
type Translator struct {
	deps Deps
	log  *slog.Logger

	mu     sync.Mutex
	tasks  map[string]context.CancelFunc
	client *chatClient
}

func NewTranslator(deps Deps, log *slog.Logger) *Translator {
	if log == nil {
		log = slog.Default()
	}
	return &Translator{deps: deps, log: log, tasks: map[string]context.CancelFunc{}}
}

var ErrEmptyText = errors.New("输入文本为空")

// Translate 执行翻译（流式）。
//
// onDelta 每个增量回调一次；调用方可自行合并。返回完整结果。
// ctx 取消 → 断开 HTTP 连接 → llama-server 中止生成释放槽位（02 文档 §7）。
func (t *Translator) Translate(ctx context.Context, req TranslateRequest, onDelta func(string)) (TranslateResult, error) {
	if strings.TrimSpace(req.Text) == "" {
		return TranslateResult{}, ErrEmptyText
	}
	modelID := t.deps.ModelForMode(req.Mode)
	baseURL, modelPath, err := t.deps.ResolveEndpoint(ctx, modelID)
	if err != nil {
		return TranslateResult{}, err
	}
	_ = modelPath
	// 任务结束（成功/失败/取消）通知编排器回收计数
	if t.deps.OnTaskFinish != nil {
		defer t.deps.OnTaskFinish(modelID)
	}

	// 可取消任务注册（Esc/按钮取消传播）
	runCtx, cancel := context.WithCancel(ctx)
	tid := req.TaskID
	t.mu.Lock()
	t.tasks[tid] = cancel
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.tasks, tid)
		t.mu.Unlock()
		cancel()
	}()

	prompt, maxTokens, temperature, extra := t.buildRequest(modelID, req)
	httpReq := ChatRequest{
		Model:       t.deps.ModelName(modelID),
		Messages:    []ChatMessage{{Role: "user", Content: prompt}},
		Temperature: temperature,
		MaxTokens:   maxTokens,
		ChatTemplateKwargs: map[string]any{
			"enable_thinking": false, // 官方 chat_template_kwargs
		},
	}
	applyExtra(&httpReq, extra)

	client := newChatClient(baseURL)
	var result StreamResult
	// 首字节看门狗：连接已建立但 runCtx 上迟迟没有首个增量时，主动取消 runCtx，
	// 让阻塞在 ReadByte 的流循环解锁。只约束「等首字」；流本身仍不限时
	//（http.Client.Timeout 保持 0，整体合法时可跑数分钟）。
	// firstDeltaSettled 由看门狗与首个 onDelta 通过同一 CAS 互斥认领：
	// 谁先认领谁赢，避免恰好压线时两边同时动作。
	var firstDeltaSettled atomic.Bool
	var watchdogFired atomic.Bool
	watchdog := time.AfterFunc(firstTokenTimeout, func() {
		if !firstDeltaSettled.CompareAndSwap(false, true) {
			return // 首字已到：看门狗不再生效
		}
		watchdogFired.Store(true)
		cancel()
	})
	defer watchdog.Stop()
	onFirstDelta := func(delta string) {
		if firstDeltaSettled.CompareAndSwap(false, true) {
			watchdog.Stop() // 首字到达即停表
		}
		if onDelta != nil {
			onDelta(delta)
		}
	}
	// 模型唤醒/加载中在此阻塞（EnsureRunning 语义），UI 前置显示"模型唤醒中"
	result, err = client.ChatStream(runCtx, httpReq, onFirstDelta)
	if err != nil {
		if watchdogFired.Load() {
			// 与用户取消区分：runCtx 是被看门狗取消的
			return TranslateResult{Output: result.Text}, fmt.Errorf("%w（%v 内无首个增量）", ErrFirstTokenTimeout, firstTokenTimeout)
		}
		if runCtx.Err() != nil || ctx.Err() != nil {
			return TranslateResult{Output: result.Text}, ErrCanceled
		}
		return TranslateResult{Output: result.Text}, fmt.Errorf("推理请求失败: %w", err)
	}

	out := TranslateResult{
		Output:           result.Text,
		OffTargetSuspect: DetectOffTarget(result.Text, req.TargetLang),
		TargetSyllables:  req.Syllables,
		ActualSyllables:  CountSyllables(result.Text, req.TargetLang),
		CompletionTokens: result.CompletionTokens,
		TokensPerSec:     result.TokensPerSec,
		FirstTokenMs:     result.FirstTokenLatency.Milliseconds(),
	}
	return out, nil
}

// TranslateSync 非流式（字幕逐条队列）。
func (t *Translator) TranslateSync(ctx context.Context, req TranslateRequest) (string, error) {
	if strings.TrimSpace(req.Text) == "" {
		return "", ErrEmptyText
	}
	modelID := t.deps.ModelForMode(ModeNormal)
	baseURL, _, err := t.deps.ResolveEndpoint(ctx, modelID)
	if err != nil {
		return "", err
	}
	if t.deps.OnTaskFinish != nil {
		defer t.deps.OnTaskFinish(modelID)
	}
	prompt, maxTokens, temperature, extra := t.buildRequest(modelID, req)
	httpReq := ChatRequest{
		Model:       t.deps.ModelName(modelID),
		Messages:    []ChatMessage{{Role: "user", Content: prompt}},
		Temperature: temperature,
		MaxTokens:   maxTokens,
		ChatTemplateKwargs: map[string]any{"enable_thinking": false},
	}
	applyExtra(&httpReq, extra)
	text, _, err := newChatClient(baseURL).Chat(ctx, httpReq)
	if err != nil {
		if ctx.Err() != nil {
			return "", ErrCanceled
		}
		return "", err
	}
	return text, nil
}

// requestExtra 额外参数（Nailong 终止符等）。
type requestExtra struct {
	stopTokenIDs []int
	topP         float64
	topK         int
	seed         int
}

func applyExtra(r *ChatRequest, e requestExtra) {
	r.StopTokenIDs = e.stopTokenIDs
	r.TopP = e.topP
	r.TopK = e.topK
	r.Seed = e.seed
}

// buildRequest prompt + 采样参数（01 文档 §4.5 参数映射表）。
//
// 采样额外项（stop_token_ids/top_k/top_p/seed）按 modelID 从冻结注册表合并：
// Translate-2B/Homura 的档案全零，合并后与历史行为逐字节一致；Nailong 的官方
// 参数（§7.9 实测本构建接受并正常收尾）由此真正进入请求——此前 sse.go 的发送
// 管道与 registry 的存储各自就位，但中间没有任何生产代码接线。
func (t *Translator) buildRequest(modelID string, req TranslateRequest) (prompt string, maxTokens int, temperature float64, extra requestExtra) {
	spec, _ := modelmanager.SpecByID(modelmanager.ModelID(modelID))
	switch req.Mode {
	case ModeDubbing:
		// Homura：temp 0.3，max_tokens = max(512, 3×字符数)（官方）
		prompt = BuildHomuraPrompt(req.Text, req.TargetLang, req.Syllables, req.constraints().Glossary)
		return prompt, HomuraMaxTokens(req.Text), 0.3, extraFromSpec(spec)
	default:
		c := req.constraints()
		prompt = BuildTranslatePrompt(req.Text, req.SourceLang, req.TargetLang, c)
		return prompt, t.translateMaxTokens(spec, req.Text), 0.0, extraFromSpec(spec)
	}
}

// extraFromSpec 注册表采样档案 → 请求额外项（零值字段经 omitempty 不发送）。
func extraFromSpec(spec modelmanager.ModelSpec) requestExtra {
	return requestExtra{
		stopTokenIDs: spec.StopTokenIDs,
		topP:         spec.TopP,
		topK:         spec.TopK,
		seed:         spec.Seed,
	}
}

// translateMaxTokens 翻译档 max_tokens 预算（M5 报告 §9 步 2）。
//
//  1. 基值取注册表（Translate 1024）；0 视同 1024 下限——短文本行为与历史逐字节一致。
//  2. 长文本按估算放大：实测 zh→en 输出 ≈0.893 token/源字（§7.3），估算取
//     输出 ≤ 2×源文 token + 128，双向留足余量。
//  3. 钳制到 ctx 余量：估算 prompt = 源文 token + 模板/约束头 768 + 估算误差 128。
//     本服务端构建对 prompt+max_tokens 超限返回 HTTP 400（§7.6），放大必须让位；
//     余量不足基值时维持基值（不比历史更差），ctx 未知（Deps 未接）时同样只保基值。
func (t *Translator) translateMaxTokens(spec modelmanager.ModelSpec, text string) int {
	base := spec.MaxTokens
	if base < 1024 {
		base = 1024
	}
	srcTok := estimateTokens(text)
	if ctx := t.ctxTokens(); ctx > 0 {
		if room := ctx - srcTok - 896; room > base {
			return max(base, min(2*srcTok+128, room))
		}
	}
	return base
}

func (t *Translator) ctxTokens() int {
	if t.deps.CtxTokens == nil {
		return 0
	}
	return t.deps.CtxTokens()
}

// estimateTokens 粗预算用 token 估算，不是分词器。
// 实测基准（M5 报告 §7.1）：中文小说 0.69–0.713 token/字，拉丁文 ≈0.25 token/字符。
// 预算方向取保守高估：非 ASCII 一律 1 token/字符，ASCII 0.5 token/字符。
// 只用于 max_tokens 预算；M5 步 1 的分块器按文体分档另行实现，不复用此处。
func estimateTokens(text string) int {
	ascii, wide := 0, 0
	for _, r := range text {
		if r < 0x80 {
			ascii++
		} else {
			wide++
		}
	}
	return ascii/2 + wide
}

func (r TranslateRequest) constraints() *Constraints {
	if r.Constraints != nil {
		return r.Constraints
	}
	return &Constraints{}
}

// CancelActive 取消进行中任务（01 文档 §5.3：前端 ≤100ms 反馈）。
func (t *Translator) CancelActive(taskID string) error {
	t.mu.Lock()
	cancel, ok := t.tasks[taskID]
	t.mu.Unlock()
	if !ok {
		return fmt.Errorf("任务 %s 不存在或已结束", taskID)
	}
	cancel()
	return nil
}

// CancelAll 取消全部任务（退出编排/空闲卸载前调用）。
func (t *Translator) CancelAll() {
	t.mu.Lock()
	defer t.mu.Unlock()
	for id, cancel := range t.tasks {
		t.log.Info("cancel task", "id", id)
		cancel()
	}
	t.tasks = map[string]context.CancelFunc{}
}

// CountSyllables 实测音节数（启发式，02 文档 §8：前端/后端均可，此处 Go 实现）：
// 英语按元音组（不含词尾 e）、日语按 mora（假名=1）、其他按字符近似。
func CountSyllables(text, lang string) int {
	lang = normalizeLangCode(lang)
	switch lang {
	case "ja":
		n := 0
		for _, r := range text {
			if (r >= 0x3040 && r <= 0x30FF) || r == 'ー' { // 平假名/片假名/长音
				n++
			}
		}
		if n > 0 {
			return n
		}
		return vowelGroupCount(text)
	case "zh", "yue_Hani", "yue_Hant":
		// 中文以字计（近似音节）
		n := 0
		for _, r := range text {
			if r >= 0x4E00 && r <= 0x9FFF {
				n++
			}
		}
		return n
	default:
		return vowelGroupCount(text)
	}
}

func normalizeLangCode(code string) string {
	if i := strings.Index(code, "_"); i > 0 && len(code) > i+1 && code[i+1] >= 'A' && code[i+1] <= 'Z' {
		return code[:i] // ukr_Cyrl → ukr 等按主语言处理
	}
	return code
}

// vowelGroupCount 英语元音组启发式（连续元音算 1，词尾静音 e 不计）。
func vowelGroupCount(text string) int {
	isVowel := func(r rune) bool {
		switch r {
		case 'a', 'e', 'i', 'o', 'u', 'y', 'A', 'E', 'I', 'O', 'U', 'Y':
			return true
		}
		return false
	}
	count, inGroup := 0, false
	runes := []rune(strings.TrimSpace(text))
	for _, r := range runes {
		v := isVowel(r)
		if v && !inGroup {
			count++
		}
		inGroup = v
	}
	// 词尾静音 e：文本以 e 结尾且前一字符非元音 → 减 1
	if n := len(runes); n > 2 {
		last := runes[n-1]
		if last == 'e' || last == 'E' {
			if !isVowel(runes[n-2]) {
				count--
			}
		}
	}
	if count < 1 && len(runes) > 0 {
		count = 1
	}
	return count
}
