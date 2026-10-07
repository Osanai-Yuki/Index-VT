// Package vramestimate 是"加载某个 ctx 档位需要多少显存"的唯一估算源。
//
// 为什么要单独成包：这个量有两个消费者，历史上它们各写一套公式并因此漂移——
//   - app.EstimateCtxVRAM：设置页的"预计占用 X GB"红线与超限二次确认
//   - orchestrator.resolveNGL：决定下发 -ngl 99（全上卡）还是 0（退回 CPU）
//
// 后者原先用「权重×1.1 + 固定 700 MiB」，**完全不看 ctx**；而实测非权重开销
// 随 ctx 线性增长（Nailong Q4_K_M：8K 时 326 MiB、32K 时 587、64K 时 1052）。
// 于是在"剩余显存刚好够小 ctx、不够大 ctx"的窗口里，它会误判为够 → llama-server 加载失败。
//
// 常数来源（2026-10-06 实测标定，非拍脑袋）：
// RTX 3050 Laptop 4GB / llama.cpp b11406 / `-fa on -ngl 99`，把上下文**真填满**到 90%
// （不是只预留 —— 只预留时 KV 不落盘，测出来是另一条斜率），
// 8K→128K 五点最小二乘得「非权重 = 243 + 93.7×(ctx/8192)」，逐点 ±2.6%。
// 这里取 KV=120、固定=260，即**单向偏保守**：对实测高报 3.5%～15.7%，绝不低报。
// 方向性是有意的——高报只是多弹一次确认框，低报会让用户选到起不来的档位。
// 数据与脚本原在 docs/superpowers/spikes/m5-longdoc-2026-10-06/（result_fill_all.json），
// 该目录按 .gitignore 不入库；所以上面五个拟合点已就地写进 vramestimate_test.go 的
// measured 表，本包不读任何外部文件。
package vramestimate

// KVPer8KMiB 每 8192 token 上下文的 KV cache 增量（实测拟合 93.7，取 120 留余量）。
const KVPer8KMiB = 120

// FixedMiB 计算缓冲等与 ctx 无关的固定开销（实测拟合截距 243，取 260）。
const FixedMiB = 260

// FallbackWeightsMiB 权重未知时的兜底：translate Q4_K_M 实测 1312164352 B。
const FallbackWeightsMiB = 1251

// Estimate 分项结果。TotalMiB 是"模型自身占用"，应与 nvidia-smi 的**空闲**显存比较，
// 不含桌面/DWM 基线（本机基线在 800–1050 MiB 间飘，混进来会误判）。
type Estimate struct {
	WeightsMiB  int
	KvMiB       int
	ActivateMiB int
	TotalMiB    int
}

// For 估算 tokens 上下文 + weightsMiB 权重的显存需求。
// weightsMiB <= 0 表示未知，落到 FallbackWeightsMiB。
//
// KV 必须按 tokens 比例算，不能 int(tokens/8192)*KVPer8K —— 那样 2K/4K 档的
// KV 项恒为 0，小档位被系统性低估。
func For(tokens int64, weightsMiB int) Estimate {
	if weightsMiB <= 0 {
		weightsMiB = FallbackWeightsMiB
	}
	kv := int(tokens * KVPer8KMiB / 8192)
	return Estimate{
		WeightsMiB:  weightsMiB,
		KvMiB:       kv,
		ActivateMiB: FixedMiB,
		TotalMiB:    weightsMiB + kv + FixedMiB,
	}
}
