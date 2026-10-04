package orchestrator

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"indexvt/internal/envprobe"
)

// buildArgs 合成 llama-server 启动参数（01 文档 §5.1 + 02 文档 §2 降级）。
//
// llama.cpp b11384 语法注意：-fa 需要显式值（on|off|auto），非布尔开关；
// --parallel 1 固定单 slot（02 文档 §11.4：多 slot 会均分 KV 且 2B 吞吐无收益）。
func (o *Orchestrator) buildArgs(modelPath string, port int) ([]string, int) {
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
	return args, ngl
}

// resolveNGL 决定 GPU 卸载层数：
// 用户固定值 → 直接使用；自动（-1）→ 有 GPU 且空闲显存充足则 99，否则 0（CPU 模式）。
func (o *Orchestrator) resolveNGL(modelPath string) int {
	if v := o.set.NGLOverride(); v >= 0 {
		return v
	}
	gpu, err := envprobe.QueryVRAM()
	if err != nil || !gpu.Present {
		return 0
	}
	// 预估占用 ≈ 权重 ×1.1 + CUDA 上下文/KV ≈ 700MB（Q4 2B @ 8K ctx 量级）
	weightMB := int64(0)
	if st, err := os.Stat(modelPath); err == nil {
		weightMB = st.Size() / (1 << 20)
	}
	need := weightMB*110/100 + 700
	if int64(gpu.FreeMB) >= need {
		return 99
	}
	o.log.Warn("显存不足，自动降为 CPU 模式（可在设置中调整）",
		"freeMB", gpu.FreeMB, "needMB", need)
	return 0
}

// sanitizeGGUFPath 二次校验模型路径扩展名（防误传可执行文件等）。
func sanitizeGGUFPath(p string) error {
	if !strings.HasSuffix(strings.ToLower(p), ".gguf") {
		return fmt.Errorf("仅支持 .gguf 模型文件: %q", p)
	}
	return nil
}
