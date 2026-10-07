package modelmanager

import "fmt"

// ModelID 三模型标识（01 文档 §3.1）。
type ModelID string

const (
	ModelTranslate ModelID = "translate"
	ModelNailong   ModelID = "nailong"
	ModelHomura    ModelID = "homura"
)

// QuantKind 支持的量化档位。
type QuantKind string

const (
	QuantQ4KM QuantKind = "Q4_K_M"
	QuantQ8   QuantKind = "Q8_0"
)

// AllQuants 全部可选档位（模型中心分段器）。
var AllQuants = []QuantKind{QuantQ4KM, QuantQ8}

// ModelSpec 模型档案（仓库/文件名/职责/采样参数——硬编码冻结注册表）。
type ModelSpec struct {
	ID          ModelID
	Name        string
	Repo        string // HF 仓库名（ModelScope 同名）
	Role        string
	Languages   string
	DefaultQuant QuantKind
	// 采样参数（01 文档 §3.1 / §4.5）
	Temperature float64
	TopP        float64       // 0 = 不发送（用服务端默认）
	TopK        int           // 0 = 不发送
	Seed        int           // 0 = 不发送；Nailong 42（官方脚本固定）
	StopTokenIDs []int        // Nailong [248044,248046]
	MaxTokens   int           // Translate 1024；Homura 动态；Nailong 0=服务端上限
	// 各档位文件（相对仓库根）
	Files map[QuantKind]string
	// 各档位约体积（字节，用于磁盘检查/展示；下载时以 HTTP 实际为准）
	ApproxSizes map[QuantKind]int64
}

// HF/ModelScope 文件名约定：Index-<Name>-2B.<QUANT>.gguf（2026-10-03 官方 GGUF 仓库实测）。
func ggufFile(name, quant string) string {
	return fmt.Sprintf("%s.%s.gguf", name, quant)
}// Registry 冻结的三模型注册表。
var Registry = []ModelSpec{
	{
		ID: ModelTranslate, Name: "Index-Translate-2B",
		Repo: "IndexTeam/Index-Translate-2B-GGUF",
		Role: "主翻译", Languages: "150 语言 + auto 检测 + 指令约束 + 字幕逐条",
		DefaultQuant: QuantQ4KM,
		Temperature:  0.0,
		MaxTokens:    1024,
		Files: map[QuantKind]string{
			QuantQ4KM: ggufFile("Index-Translate-2B", "Q4_K_M"),
			QuantQ8:   ggufFile("Index-Translate-2B", "Q8_0"),
		},
		ApproxSizes: map[QuantKind]int64{
			QuantQ4KM: 1312164352, // 官方 SHA256SUMS 对应实测体积
			QuantQ8:   2235000000,
		},
	},
	{
		ID: ModelNailong, Name: "Index-Nailong-2B",
		Repo: "IndexTeam/Index-Nailong-2B-GGUF",
		Role: "长文档翻译", Languages: "zh↔en / zh↔ja（固定方向模板）",
		DefaultQuant: QuantQ4KM,
		Temperature:  0.0,
		TopP:         1.0,
		TopK:         -1,
		Seed:         42,
		StopTokenIDs: []int{248044, 248046},
		MaxTokens:    0,
		Files: map[QuantKind]string{
			QuantQ4KM: ggufFile("Index-Nailong-2B", "Q4_K_M"),
			QuantQ8:   ggufFile("Index-Nailong-2B", "Q8_0"),
		},
		ApproxSizes: map[QuantKind]int64{
			QuantQ4KM: 1312000000,
			QuantQ8:   2235000000,
		},
	},
	{
		ID: ModelHomura, Name: "Index-Homura-2B",
		Repo: "IndexTeam/Index-Homura-2B-GGUF",
		Role: "配音模式", Languages: "音节预算控制（近似达标）",
		DefaultQuant: QuantQ4KM,
		Temperature:  0.3,
		MaxTokens:    0, // 动态：max(512, 3×字符数)
		Files: map[QuantKind]string{
			QuantQ4KM: ggufFile("Index-Homura-2B", "Q4_K_M"),
			QuantQ8:   ggufFile("Index-Homura-2B", "Q8_0"),
		},
		ApproxSizes: map[QuantKind]int64{
			QuantQ4KM: 1312000000,
			QuantQ8:   2235000000,
		},
	},
}

// SpecByID 查注册表。
func SpecByID(id ModelID) (ModelSpec, bool) {
	for _, s := range Registry {
		if s.ID == id {
			return s, true
		}
	}
	return ModelSpec{}, false
}

// ValidModelID 判断是否注册模型。
func ValidModelID(id string) bool {
	_, ok := SpecByID(ModelID(id))
	return ok
}
