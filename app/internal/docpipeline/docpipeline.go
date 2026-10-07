// Package docpipeline 长文档翻译（01 文档 §5.5）——M5 里程碑实现。
//
// 结构：chunker.go（token 预算分块）+ pipeline.go（块级状态机与队列）。
// prompt 由管线层按官方方向模板组装（translator.BuildNailongPromptWithGlossary，
// §7.11 (b') 术语注入），采样参数按 Nailong 注册表档合并（stop_token_ids/seed），
// max_tokens 每块经 translator.MaxTokensForBudget 与请求钳制同源（§11 对齐约定）。
// 生命周期与覆盖率口径见 M5 报告 §10 决策记录。
package docpipeline

// ExportKind 导出类型。
type ExportKind string

const (
	ExportTranslation ExportKind = "translation"
	ExportBilingual   ExportKind = "bilingual"
)

// DocProgress 文档翻译进度事件（01 文档 §5.5 冻结口径：按字符）。
// ChunkIndex/State 为增量标注（omitempty）：哪一块、进入什么状态，供 UI 高亮当前块。
type DocProgress struct {
	DocID      string `json:"docId"`
	CharsDone  int    `json:"charsDone"`
	CharsTotal int    `json:"charsTotal"`
	ETASeconds int    `json:"etaSeconds"`
	ChunkIndex int    `json:"chunkIndex,omitempty"`
	State      string `json:"state,omitempty"`
}
