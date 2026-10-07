package main

import (
	"testing"

	"indexvt/internal/envprobe"
	"indexvt/internal/vramestimate"
)

// estimateCtxVRAM 现在是 internal/vramestimate 的一层包装 —— 公式本体与"不许低估实测"
// 那条回归测试都在那个包里（因为 orchestrator 的 resolveNGL 也要用同一份，
// 而它导不了 package main）。本文件因此只测**包装层该负责的部分**：
// 分项映射进 CtxEstimate、Basis 文案、ExceedsFree 只在有 GPU 时才判。

func TestEstimateCtxVRAM(t *testing.T) {
	gpu4G := envprobe.GPU{Present: true, TotalMB: 4096, UsedMB: 900, FreeMB: 3196}
	noGPU := envprobe.GPU{}

	cases := []struct {
		name    string
		tokens  int64
		weights int
		wantKV  int
		wantTot int
		wantEx  bool
	}{
		{"2K 兜底权重（KV 必须按比例，不得为 0）", 2048, 0, 30, 1541, false},
		{"4K 兜底权重", 4096, 0, 60, 1571, false},
		{"8K 兜底权重", 8192, 0, 120, 1631, false},
		// 32K 在 4GB 卡上实测可跑（模型自身 1802 MiB）；旧 875 斜率算出 5351，误判超限
		{"32K 兜底权重（不再误判超限）", 32768, 0, 480, 1991, false},
		{"64K 兜底权重（产品钳位上限）", 65536, 0, 960, 2471, false},
		{"8K 实测权重优先于兜底", 8192, 2100, 120, 2480, false},
		{"Q8_0 + 64K 在 4GB 卡上确实超", 65536, 2100, 960, 3320, true},
	}
	for _, c := range cases {
		e := estimateCtxVRAM(c.tokens, c.weights, gpu4G)
		if e.KvMiB != c.wantKV || e.TotalMiB != c.wantTot {
			t.Fatalf("%s：kv/total = %d/%d，期望 %d/%d（%+v）", c.name, e.KvMiB, e.TotalMiB, c.wantKV, c.wantTot, e)
		}
		if e.ExceedsFree != c.wantEx {
			t.Fatalf("%s：ExceedsFree = %v，期望 %v（%+v）", c.name, e.ExceedsFree, c.wantEx, e)
		}
		if e.Tokens != c.tokens {
			t.Fatalf("%s：Tokens 回显错 %d ≠ %d", c.name, e.Tokens, c.tokens)
		}
	}

	// 兜底权重必须真的被用上（weights 传 0 的分支），且 Basis 要留依据给设置页
	if e := estimateCtxVRAM(8192, 0, gpu4G); e.WeightsMiB != vramestimate.FallbackWeightsMiB {
		t.Fatalf("weights=0 未走兜底：%+v", e)
	}

	// 无 GPU：不判超限，Basis 说明 CPU 模式
	e := estimateCtxVRAM(8192, 0, noGPU)
	if e.ExceedsFree || e.Basis == "" {
		t.Fatalf("无 GPU 分支错：%+v", e)
	}
}

// TestEstimateCtxVRAMSharesFormulaWithEstimator 防漂移锁：包装层与 vramestimate
// 必须给同一个总数。历史上这里有两套常数（875/600 与「权重×1.1+700」），
// 结果设置页说"放不下"、resolveNGL 却说"放得下"，两边对不上账。
func TestEstimateCtxVRAMSharesFormulaWithEstimator(t *testing.T) {
	for _, tok := range []int64{2048, 8192, 16384, 32768, 65536} {
		e := estimateCtxVRAM(tok, 1215, envprobe.GPU{Present: true, TotalMB: 4096, FreeMB: 3196})
		if want := vramestimate.For(tok, 1215).TotalMiB; e.TotalMiB != want {
			t.Fatalf("ctx %d：包装层 %d MiB ≠ vramestimate %d MiB（两处漂移）", tok, e.TotalMiB, want)
		}
	}
}
