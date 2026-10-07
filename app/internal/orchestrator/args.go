package orchestrator

import (
	"os"
	"path/filepath"
	"strconv"

	"indexvt/internal/envprobe"
	"indexvt/internal/paths"
	"indexvt/internal/vramestimate"
)

// buildArgs 合成 llama-server 启动参数（01 文档 §5.1 + 02 文档 §2 降级）。
//
// llama.cpp b11406（vendored 构建，`llama-server --version` 可核）语法注意：
// -fa 需要显式值（on|off|auto），非布尔开关；--parallel 1 固定单 slot
// （02 文档 §11.4：多 slot 会均分 KV 且 2B 吞吐无收益）。
//
// 加速项取舍来自 2026-10-06 的实测 A/B（原始 result_accel.json 不入库，结论与数字已就地列在下面；
// ctx 32K、prompt 填满 29561 token）：
//   - `-fa on` **保留**：相对 -fa off，prefill +39.8%、decode +46.4%、显存 −29%。
//     与上游默认值 auto 在本机等价（差 <1%，属噪声），但 on 明确锁定，不随构建改默认而漂。
//   - `-b/-ub` 加大 **不加**：prefill 无变化（2658 vs 2673 tok/s，噪声内），反多占 320 MiB。
//   - `-ctk/-ctv q8_0` **不加**：省 208 MiB 但 decode −7.7%；4GB 卡在 64K 档仍有富余，
//     不值得换质量与速率。留给未来"≤2GB 卡"选项。
//   - `-t/-tb` **不加**：全层上卡后 CPU 线程数无差异（73.48 vs 73.80）。
//   - `-lm mlock` **不加**：加载 2.0s vs 2.1s，稳态无差异，默认 mmap 更好。
//   - `--warmup` 上游默认已开，无需显式下发。
//   - `--n-cpu-mem`（KV 放系统内存）在此构建**不存在**，不能依赖它扩上下文。
func (o *Orchestrator) buildArgs(modelPath string, port int) ([]string, int, error) {
	// 模型路径进入 argv 前的最后一道关（防误传可执行文件等）
	if err := sanitizeGGUFPath(modelPath); err != nil {
		return nil, 0, err
	}
	args := []string{
		"-m", modelPath,
		"--host", "127.0.0.1",
		"--port", strconv.Itoa(port),
		"-c", strconv.FormatInt(o.set.CtxTokens(), 10),
		"-fa", "on",
		"--no-webui",
		"--parallel", "1",
	}
	ngl := o.resolveNGL(modelPath)
	args = append(args, "-ngl", strconv.Itoa(ngl))
	if t := o.set.CPUThreads(); t > 0 {
		args = append(args, "-t", strconv.Itoa(t))
	}
	return args, ngl, nil
}

// resolveNGL 决定 GPU 卸载层数：
// 用户固定值 → 直接使用；自动（-1）→ 有 GPU 且空闲显存充足则 99，否则 0（CPU 模式）。
//
// 需求值走 internal/vramestimate，与设置页的 EstimateCtxVRAM 共用同一估算式。
// **必须含 ctx**：非权重开销随上下文线性增长（实测 Nailong Q4_K_M：8K 时 326 MiB、
// 32K 时 587、64K 时 1052），而旧写法用「权重×1.1 + 固定 700」完全不看 ctx，
// 在 64K 档低估约 231 MiB —— 剩余显存落在 [2036, 2267] 这个窗口时会误判为"够"，
// 于是下发 -ngl 99 然后加载失败。产品钳位就是 64K，所以这个窗口是真实可及的。
func (o *Orchestrator) resolveNGL(modelPath string) int {
	if v := o.set.NGLOverride(); v >= 0 {
		return v
	}
	gpu, err := envprobe.QueryVRAM()
	if err != nil || !gpu.Present {
		return 0
	}
	weightsMiB := 0 // 取不到体积时由该包落到 translate Q4_K_M 兜底权重
	if st, err := os.Stat(modelPath); err == nil {
		weightsMiB = int(st.Size() / (1 << 20))
	}
	ngl, need := decideNGL(gpu.FreeMB, o.set.CtxTokens(), weightsMiB)
	if ngl == 0 {
		o.log.Warn("显存不足，自动降为 CPU 模式（可在设置中调整）",
			"freeMB", gpu.FreeMB, "needMB", need, "ctxTokens", o.set.CtxTokens())
	}
	return ngl
}

// decideNGL 纯函数：空闲显存够不够把「权重 + 该 ctx 的 KV 与缓冲」整份放上卡。
// 单独拆出来是为了能测那个窗口 —— resolveNGL 要查真实显卡，测试碰不到它
// （见 orchestrator_conc_test.go 的注释）。
func decideNGL(freeMB int, ctxTokens int64, weightsMiB int) (ngl int, needMB int) {
	needMB = vramestimate.For(ctxTokens, weightsMiB).TotalMiB
	if freeMB >= needMB {
		return 99, needMB
	}
	return 0, needMB
}

// sanitizeGGUFPath 委托给 paths 包，避免与模型管理侧的两套校验漂移（B17）。
func sanitizeGGUFPath(p string) error {
	return paths.ValidateGGUFName(filepath.Base(p))
}
