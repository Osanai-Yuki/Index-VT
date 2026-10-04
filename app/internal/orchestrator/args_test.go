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
