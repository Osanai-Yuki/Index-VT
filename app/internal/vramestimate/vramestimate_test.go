package vramestimate

import "testing"

// TestForNeverUnderPredictsMeasured 用实测显存占用单向钉住估算式。
// 数据：Nailong Q4_K_M（权重 1215 MiB）、RTX 3050 Laptop 4GB、`-fa on -ngl 99`，
// 上下文填满到 90% 后的「nvidia-smi 峰值 − 启动前桌面基线」。
// 原始产物 docs/superpowers/spikes/m5-longdoc-2026-10-06/result_fill_all.json 不入库
// （见 .gitignore），下面的 measured 表就是本测试唯一的真值来源。
//
// 两个方向都断言，但门槛不对称：
//
//	下界严格 —— 低估会让 resolveNGL 误判"够"从而下发一个起不来的 -ngl 99；
//	上界宽松（1.4×）—— 高报只是多一次确认框，但旧 875 斜率在 32K 上高估 2.95 倍，
//	那已经离谱到会误挡可用档位的程度，所以也要卡。
func TestForNeverUnderPredictsMeasured(t *testing.T) {
	const measuredWeightsMiB = 1215
	measured := []struct {
		tokens      int64
		footprintMB int
	}{
		{8192, 1541},
		{16384, 1650},
		{32768, 1802},
		{65536, 2267},
		{131072, 2935},
	}
	for _, m := range measured {
		e := For(m.tokens, measuredWeightsMiB)
		if e.TotalMiB < m.footprintMB {
			t.Fatalf("ctx %d：估算 %d MiB 低于实测 %d MiB，会误导到起不来的档位",
				m.tokens, e.TotalMiB, m.footprintMB)
		}
		if over := float64(e.TotalMiB) / float64(m.footprintMB); over > 1.4 {
			t.Fatalf("ctx %d：估算 %d MiB 是实测 %d MiB 的 %.2f 倍，过保守会误挡可用档位",
				m.tokens, e.TotalMiB, m.footprintMB, over)
		}
	}
}

// TestForKeepsKVProportional 锁住整除缺陷：2K/4K 档的 KV 项不得为 0。
func TestForKeepsKVProportional(t *testing.T) {
	for _, tc := range []struct {
		tokens int64
		wantKV int
	}{
		{2048, 30},
		{4096, 60},
		{8192, 120},
		{32768, 480},
	} {
		if e := For(tc.tokens, 1000); e.KvMiB != tc.wantKV {
			t.Fatalf("ctx %d：KV = %d MiB，期望 %d", tc.tokens, e.KvMiB, tc.wantKV)
		}
	}
}

// TestForFallsBackOnUnknownWeights 权重未知（0）时必须落到兜底值而不是算出 0。
func TestForFallsBackOnUnknownWeights(t *testing.T) {
	e := For(8192, 0)
	if e.WeightsMiB != FallbackWeightsMiB || e.TotalMiB != FallbackWeightsMiB+120+FixedMiB {
		t.Fatalf("weights=0 未走兜底：%+v", e)
	}
}
