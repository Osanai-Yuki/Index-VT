// Package config 定义应用配置结构与默认值（01 文档 §6.4 设置页分组）。
// 持久化经 store 的 config 表（JSON 序列化，key="app"）。
package config

// CtxTier 上下文档位（02 文档 §3：UI 仅暴露 8K/16K/32K）。
type CtxTier string

const (
	Ctx8K  CtxTier = "8K"
	Ctx16K CtxTier = "16K"
	Ctx32K CtxTier = "32K"
)

func (t CtxTier) Tokens() int64 {
	switch t {
	case Ctx16K:
		return 16384
	case Ctx32K:
		return 32768
	default:
		return 8192
	}
}

// SourcePref 模型下载源偏好（ADR-005）。
type SourcePref string

const (
	SourceAuto       SourcePref = "auto"
	SourceHuggingPic SourcePref = "hf" // 优先 HuggingFace
	SourceModelScope SourcePref = "modelscope"
)

// CloseBehavior 关闭行为（ADR-006：托盘驻留为可选，M2 仅实现"退出即释放"）。
type CloseBehavior string

const (
	CloseExitRelease CloseBehavior = "exit-release"
	CloseTrayReside  CloseBehavior = "tray-reside" // 预留：托盘驻留（后续里程碑）
)

type Inference struct {
	NGLOverride int  `json:"nglOverride"` // -1=自动（GPU 99 / CPU 0），否则用户固定值
	CtxTier     CtxTier `json:"ctxTier"`  // llama-server -c
	CPUThreads  int  `json:"cpuThreads"`  // 0=自动（物理核心数）
	TempOverride bool `json:"tempOverride"` // 高级区温度覆盖开关（默认关：三模型默认参数已最优）
}

type Resource struct {
	IdleUnloadMinutes int          `json:"idleUnloadMinutes"` // 0=常驻；默认 5（02 文档 §6.1：1-30 或 0）
	CloseBehavior     CloseBehavior `json:"closeBehavior"`
}

type Download struct {
	SourcePref SourcePref `json:"sourcePref"`
}

type Appearance struct {
	Theme    string `json:"theme"`    // dark | light | system（M2 仅 dark 生效，设计 token 为暗色）
	FontSize string `json:"fontSize"` // small | standard | large
}

type HistoryConf struct {
	MaxEntries int `json:"maxEntries"` // 超上限自动清理最旧
}

type Config struct {
	Inference   Inference    `json:"inference"`
	Resource    Resource     `json:"resource"`
	Download    Download     `json:"download"`
	Appearance  Appearance   `json:"appearance"`
	History     HistoryConf  `json:"history"`
	Onboarded   bool         `json:"onboarded"`
	ActiveModel string       `json:"activeModel"` // translate | nailong | homura
}

// Default 返回设计默认值（01 文档 §5.1 启动参数 + §6.4 设置页）。
func Default() Config {
	return Config{
		Inference: Inference{
			NGLOverride:  -1,
			CtxTier:      Ctx8K,
			CPUThreads:   0,
			TempOverride: false,
		},
		Resource: Resource{
			IdleUnloadMinutes: 5,
			CloseBehavior:     CloseExitRelease,
		},
		Download:   Download{SourcePref: SourceAuto},
		Appearance: Appearance{Theme: "dark", FontSize: "standard"},
		History:    HistoryConf{MaxEntries: 2000},
		Onboarded:  false,
	}
}

// Normalize 约束取值范围（02 文档 §6.1 空闲 1-30 或 0 常驻等）。
func (c *Config) Normalize() {
	if c.Resource.IdleUnloadMinutes < 0 || c.Resource.IdleUnloadMinutes > 30 {
		c.Resource.IdleUnloadMinutes = 5
	}
	switch c.Inference.CtxTier {
	case Ctx8K, Ctx16K, Ctx32K:
	default:
		c.Inference.CtxTier = Ctx8K
	}
	if c.Inference.NGLOverride < -1 || c.Inference.NGLOverride > 999 {
		c.Inference.NGLOverride = -1
	}
	if c.Inference.CPUThreads < 0 {
		c.Inference.CPUThreads = 0
	}
	switch c.Download.SourcePref {
	case SourceAuto, SourceHuggingPic, SourceModelScope:
	default:
		c.Download.SourcePref = SourceAuto
	}
	if c.History.MaxEntries <= 0 {
		c.History.MaxEntries = 2000
	}
}
