package translator

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
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

	prompt, maxTokens, temperature, extra := t.buildRequest(req)
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
	// 模型唤醒/加载中在此阻塞（EnsureRunning 语义），UI 前置显示"模型唤醒中"
	result, err = client.ChatStream(runCtx, httpReq, onDelta)
	if err != nil {
		if runCtx.Err() != nil || ctx.Err() != nil {
			return TranslateResult{Output: result.Text}, ErrCanceled
		}
		return TranslateResult{}, fmt.Errorf("推理请求失败: %w", err)
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
	prompt, maxTokens, temperature, extra := t.buildRequest(req)
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
func (t *Translator) buildRequest(req TranslateRequest) (prompt string, maxTokens int, temperature float64, extra requestExtra) {
	switch req.Mode {
	case ModeDubbing:
		// Homura：temp 0.3，max_tokens = max(512, 3×字符数)（官方）
		prompt = BuildHomuraPrompt(req.Text, req.TargetLang, req.Syllables, req.constraints().Glossary)
		return prompt, HomuraMaxTokens(req.Text), 0.3, requestExtra{}
	default:
		c := req.constraints()
		prompt = BuildTranslatePrompt(req.Text, req.SourceLang, req.TargetLang, c)
		return prompt, 1024, 0.0, requestExtra{} // Translate：greedy，1024 默认
	}
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
