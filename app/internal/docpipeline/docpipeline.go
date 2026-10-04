// Package docpipeline 长文档翻译（01 文档 §5.5）——M5 里程碑范围。
//
// M2 仅冻结接口扩展点（任务书：接口与状态机须为后续里程碑预留扩展点）。
// 实现前置依赖：Index-Nailong-2B 下载（modelmanager）、ctx 档位（8K/16K/32K，
// orchestrator -c 参数已就绪）、stop_token_ids 请求扩展（translator 已就绪）。
package docpipeline

import "context"

// Direction Nailong 固定方向模板。
type Direction string

const (
	DirZhEn Direction = "zh-en"
	DirEnZh Direction = "en-zh"
	DirZhJa Direction = "zh-ja"
	DirJaZh Direction = "ja-zh"
)

// CtxTier ctx 档位（02 文档 §3：UI 仅暴露 8K/16K/32K，M5 实装）。
type CtxTier string

const (
	Tier8K  CtxTier = "8K"
	Tier16K CtxTier = "16K"
	Tier32K CtxTier = "32K"
)

// DocRequest 长文档翻译请求。
type DocRequest struct {
	Path      string
	Direction Direction
	CtxTier   CtxTier
}

// DocProgress 文档翻译进度事件。
type DocProgress struct {
	DocID       string `json:"docId"`
	CharsDone   int    `json:"charsDone"`
	CharsTotal  int    `json:"charsTotal"`
	ETASeconds  int    `json:"etaSeconds"`
}

// ExportKind 导出类型。
type ExportKind string

const (
	ExportTranslation ExportKind = "translation"
	ExportBilingual   ExportKind = "bilingual"
)

// Pipeline 长文档管线接口（M5 实现）。
type Pipeline interface {
	Translate(ctx context.Context, req DocRequest, onProgress func(DocProgress)) error
	Export(docID string, kind ExportKind) error
	Cancel(docID string) error
}
