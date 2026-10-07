package orchestrator

import "testing"

// TestBuildArgsRejectsNonGGUFPath B17 回归锁：模型路径进入 argv 前必须过
// sanitizeGGUFPath（历史缺陷：sanitizeGGUFPath 声明后从未被调用，是死代码，
// 两套校验因此漂移）。非 .gguf 路径必须拒绝，合法路径原样进入 -m。
func TestBuildArgsRejectsNonGGUFPath(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)

	if _, _, err := o.buildArgs(`C:\models\evil.exe`, 8101); err == nil {
		t.Fatal("非 .gguf 路径必须被拒绝，不得进入 -m 参数")
	}
	args, _, err := o.buildArgs(`C:\models\Index-Translate-2B.Q4_K_M.gguf`, 8101)
	if err != nil {
		t.Fatalf("合法 .gguf 路径被误拒: %v", err)
	}
	if len(args) < 2 || args[0] != "-m" || args[1] != `C:\models\Index-Translate-2B.Q4_K_M.gguf` {
		t.Fatalf("argv 前缀异常: %v", args)
	}
}

// TestDecideNGLAccountsForCtx 锁住修复：旧 resolveNGL 用「权重×1.1 + 固定 700 MiB」，
// **完全不看 ctx**，于是在"剩余显存够小 ctx、不够大 ctx"的窗口里会误判为够，
// 下发 -ngl 99 后 llama-server 加载失败。
//
// 以 Nailong Q4_K_M（权重 1215 MiB）+ 64K 为例：
//
//	旧式需求 = 1215×1.1 + 700 = 2036 MiB
//	实测占用 = 2267 MiB（原始 result_fill_all.json 不入库，数字已就地留存）
//	新式需求 = 1215 + 960 + 260 = 2435 MiB（偏保守，方向正确）
//	→ free ∈ [2036, 2435) 这个窗口，旧式判 99（会炸），新式判 0（退回 CPU）。
func TestDecideNGLAccountsForCtx(t *testing.T) {
	const nailongMiB = 1215

	cases := []struct {
		name    string
		free    int
		ctx     int64
		wantNGL int
	}{
		{"8K / 宽裕 → 全上卡", 3196, 8192, 99},
		{"32K / 4GB 卡实测可跑（实测占 1802）", 3196, 32768, 99},
		{"64K / 4GB 卡富余（实测占 2267）", 3196, 65536, 99},
		{"64K / 落在旧式会误判的窗口", 2200, 65536, 0},
		{"64K / 刚好到新式需求线", 2435, 65536, 99},
		{"8K / 只剩 1GB → 退回 CPU", 1024, 8192, 0},
	}
	for _, c := range cases {
		ngl, need := decideNGL(c.free, c.ctx, nailongMiB)
		if ngl != c.wantNGL {
			t.Fatalf("%s：ngl = %d，期望 %d（need=%d MiB）", c.name, ngl, c.wantNGL, need)
		}
	}

	// 需求必须随 ctx 单调上升 —— 这正是旧式做不到的那一点
	lo := 0
	for _, ctx := range []int64{2048, 8192, 32768, 65536} {
		_, need := decideNGL(999999, ctx, nailongMiB)
		if need <= lo {
			t.Fatalf("ctx %d 的需求 %d MiB 未超过上一档 %d MiB（说明没把 ctx 算进去）", ctx, need, lo)
		}
		lo = need
	}
}

// TestDecideNGLOnUnknownWeights 模型文件 stat 不到时（weights=0）必须走兜底权重，
// 不能算出"只需要 380 MiB"这种荒谬值而放行。
func TestDecideNGLOnUnknownWeights(t *testing.T) {
	ngl, need := decideNGL(1400, 8192, 0)
	if need != 1251+120+260 {
		t.Fatalf("兜底权重未生效：need = %d MiB", need)
	}
	if ngl != 0 {
		t.Fatalf("free 1400 MiB < need %d MiB 却仍判全上卡", need)
	}
}
