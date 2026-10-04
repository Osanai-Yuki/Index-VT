package translator

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ============================================================================
// OpenAI 兼容 chat 客户端（llama-server /v1/chat/completions）
// ============================================================================

// ChatMessage 单条消息。
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest 请求体（01 文档 §7.2 + 官方脚本参数画像）。
type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	TopP        float64       `json:"top_p,omitempty"`  // 0=省略
	TopK        int           `json:"top_k,omitempty"`  // 0=省略（Nailong -1 需显式发送，见 MarshalJSON）
	MinP        float64       `json:"min_p,omitempty"`
	Seed        int           `json:"seed,omitempty"`   // Nailong 42
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Stream      bool          `json:"stream"`
	// Nailong 终止符（llama-server OpenAI 扩展字段，冒烟验证 b11384 接受）
	StopTokenIDs []int `json:"stop_token_ids,omitempty"`
	// Qwen3.5 思考模式关闭（官方 chat_template_kwargs.enable_thinking=False）
	ChatTemplateKwargs map[string]any `json:"chat_template_kwargs,omitempty"`
	StreamOptions      *streamOptions `json:"stream_options,omitempty"`
}

type streamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

// MarshalJSON 保证 top_k=-1 / top_p 显式发送（omitempty 会吞掉 -1? 不会吞 -1，
// 但 top_p=0 需要区分"未设置"；这里显式控制字段输出）。
func (r ChatRequest) MarshalJSON() ([]byte, error) {
	type alias ChatRequest
	m := map[string]any{
		"model":       r.Model,
		"messages":    r.Messages,
		"temperature": r.Temperature,
		"stream":      r.Stream,
	}
	if r.TopP > 0 {
		m["top_p"] = r.TopP
	}
	if r.TopK != 0 {
		m["top_k"] = r.TopK
	}
	if r.MinP != 0 {
		m["min_p"] = r.MinP
	}
	if r.Seed != 0 {
		m["seed"] = r.Seed
	}
	if r.MaxTokens > 0 {
		m["max_tokens"] = r.MaxTokens
	}
	if len(r.StopTokenIDs) > 0 {
		m["stop_token_ids"] = r.StopTokenIDs
	}
	if r.ChatTemplateKwargs != nil {
		m["chat_template_kwargs"] = r.ChatTemplateKwargs
	}
	if r.StreamOptions != nil {
		m["stream_options"] = r.StreamOptions
	}
	return json.Marshal(m)
}

// chatChunk SSE 流式 chunk 解析结构。
type chatChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// chatClient 面向单个 llama-server 端点。
type chatClient struct {
	baseURL string
	http    *http.Client
}

func newChatClient(baseURL string) *chatClient {
	return &chatClient{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 0}, // 流式不限时；取消靠 ctx
	}
}

// Chat 非流式请求（字幕队列逐条使用，02 文档 §11.4）。
func (c *chatClient) Chat(ctx context.Context, req ChatRequest) (string, int, error) {
	req.Stream = false
	body, err := json.Marshal(req)
	if err != nil {
		return "", 0, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", 0, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", 0, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var cr chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return "", 0, err
	}
	if len(cr.Choices) == 0 {
		return "", 0, fmt.Errorf("无 choices 返回")
	}
	tokens := 0
	if cr.Usage != nil {
		tokens = cr.Usage.CompletionTokens
	}
	return stripThink(cr.Choices[0].Message.Content), tokens, nil
}

// ChatStream 流式请求（SSE）。onDelta 回调增量文本；返回（全文, 完成token数, 首token延迟, tokens/s, err）。
//
// SSE 解析按字节缓冲到完整事件（\n\n 边界）再 UTF-8 解码（02 文档 §7：
// 多字节 token 会被拆分，禁止按行直切）。
func (c *chatClient) ChatStream(ctx context.Context, req ChatRequest, onDelta func(string)) (result StreamResult, err error) {
	req.Stream = true
	req.StreamOptions = &streamOptions{IncludeUsage: true}
	body, err := json.Marshal(req)
	if err != nil {
		return result, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/chat/completions", bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	start := time.Now()
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return result, fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}

	var full strings.Builder
	var textBytes bytes.Buffer
	reader := bufio.NewReaderSize(resp.Body, 64<<10)
	var eventBuf bytes.Buffer
	firstToken := time.Duration(0)
	tokenCount := 0

	flushEvent := func(raw []byte) error {
		// raw 为一个完整 SSE 事件字节（去掉结尾 \n\n）
		line := strings.TrimSpace(string(raw))
		if line == "" || strings.HasPrefix(line, ":") {
			return nil
		}
		if !strings.HasPrefix(line, "data:") {
			return nil
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			return io.EOF
		}
		var chunk chatChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			// 单个坏 chunk 不终止流
			return nil
		}
		if chunk.Usage != nil && chunk.Usage.CompletionTokens > 0 {
			result.CompletionTokens = chunk.Usage.CompletionTokens
		}
		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta.Content
			if delta != "" {
				if firstToken == 0 {
					firstToken = time.Since(start)
				}
				textBytes.WriteString(delta) // 字节级缓冲（多字节安全）
				full.WriteString(delta)
				tokenCount++
				if onDelta != nil {
					onDelta(delta)
				}
			}
		}
		return nil
	}

	for {
		chunk, err := reader.ReadByte()
		if err != nil {
			if err == io.EOF {
				if eventBuf.Len() > 0 {
					_ = flushEvent(eventBuf.Bytes())
				}
				break
			}
			return result, err
		}
		eventBuf.WriteByte(chunk)
		// 事件边界：空行。兼容 "\n\n" 与 "\r\n\r\n"；逐 data: 行刷新亦是安全的
		//（llama-server 单行 JSON；字节缓冲保证多字节 token 不被拆分）。
		b := eventBuf.Bytes()
		if chunk == '\n' && len(b) >= 2 {
			prev := b[len(b)-2]
			if prev == '\n' || prev == '\r' {
				data := b[:len(b)-2]
				eventBuf.Reset()
				if ferr := flushEvent(data); ferr == io.EOF {
					break
				}
			}
		}
	}

	result.Text = stripThink(full.String())
	result.FirstTokenLatency = firstToken
	result.Chunks = tokenCount
	if result.CompletionTokens == 0 {
		result.CompletionTokens = tokenCount
	}
	if firstToken > 0 {
		elapsed := time.Since(start) - firstToken
		if result.CompletionTokens > 1 && elapsed > 0 {
			result.TokensPerSec = float64(result.CompletionTokens) / elapsed.Seconds()
		}
	}
	return result, nil
}

// StreamResult 流式结果统计。
type StreamResult struct {
	Text              string
	CompletionTokens  int
	Chunks            int
	FirstTokenLatency time.Duration
	TokensPerSec      float64
}

// stripThink 官方 strip_think 安全网：丢弃 <think>…</think> 块。
func stripThink(text string) string {
	if idx := strings.Index(text, "</think>"); idx >= 0 {
		text = text[idx+len("</think>"):]
	}
	text = strings.TrimSpace(text)
	text = strings.TrimPrefix(text, "<think>")
	return strings.TrimSpace(text)
}
