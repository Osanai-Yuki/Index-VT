package config

import "testing"

func TestNormalizeCtxTokensOverride(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, 0},         // 0 = 跟随预设档，不动
		{-5, 0},        // 负值判为无效 → 跟随预设档
		{1, 2048},      // 小于下限 → 夹到 2048
		{2048, 2048},   // 边界原样
		{3000, 3072},   // 就近对齐 1024
		{3072, 3072},   // 已对齐原样
		{65024, 65536}, // 向上对齐后仍在上限内
		{65536, 65536}, // 上限原样
		{70000, 65536}, // 超上限 → 夹到 65536
	}
	for _, c := range cases {
		cfg := Config{}
		cfg.Inference.CtxTokensOverride = c.in
		cfg.Normalize()
		if got := cfg.Inference.CtxTokensOverride; got != c.want {
			t.Errorf("override %d → %d，期望 %d", c.in, got, c.want)
		}
	}
}

func TestEffectiveCtxTokens(t *testing.T) {
	cfg := Config{}
	cfg.Normalize()
	if got := cfg.EffectiveCtxTokens(); got != 8192 {
		t.Fatalf("默认应为 8192（8K 档），得 %d", got)
	}
	cfg.Inference.CtxTier = Ctx32K
	if got := cfg.EffectiveCtxTokens(); got != 32768 {
		t.Fatalf("32K 档应为 32768，得 %d", got)
	}
	cfg.Inference.CtxTokensOverride = 12288
	if got := cfg.EffectiveCtxTokens(); got != 12288 {
		t.Fatalf("覆盖值应优先，得 %d", got)
	}
	cfg.Inference.CtxTokensOverride = 0
	if got := cfg.EffectiveCtxTokens(); got != 32768 {
		t.Fatalf("清零后应回落 32K，得 %d", got)
	}
}
