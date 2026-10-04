// Package envprobe 启动自检（01 文档 §5.7）：GPU/显存、llama-server 存在性、
// WebView2 探测、CPU 信息，以及残留进程清扫（02 文档 §6.4 三重指纹）。
package envprobe

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"indexvt/internal/paths"
	"indexvt/internal/winproc"
)

type GPU struct {
	Present  bool   `json:"present"`
	Name     string `json:"name"`
	TotalMB  int    `json:"totalMB"`
	UsedMB   int    `json:"usedMB"`
	FreeMB   int    `json:"freeMB"`
	DriverOK bool   `json:"driverOK"`
}

type ResidualSweepResult struct {
	Cleaned []string `json:"cleaned"` // 已终止的残留进程描述
	Count   int      `json:"count"`
}

type EnvInfo struct {
	GPU             GPU                 `json:"gpu"`
	WebView2Present bool                `json:"webView2Present"`
	WebView2Version string              `json:"webView2Version"`
	LlamaServerPath string              `json:"llamaServerPath"`
	LlamaServerOK   bool                `json:"llamaServerOK"`
	ModelsDir       string              `json:"modelsDir"`
	CPULogicalCores int                 `json:"cpuLogicalCores"`
	CPUModel        string              `json:"cpuModel"`
	Sweep           ResidualSweepResult `json:"sweep"`
	ProbedAt        int64               `json:"probedAt"`
}

// runWithTimeout 用 LookPath 解析出的绝对路径执行，并施加超时。
// 直接用命令名会按 PATH 且含当前工作目录解析（可被同名 DLL/EXE 劫持），
// 且无超时时一个挂住的 nvidia-smi 会把调用它的 Wails 绑定永久阻塞（B25）。
func runWithTimeout(timeout time.Duration, name string, args ...string) ([]byte, error) {
	bin, err := exec.LookPath(name)
	if err != nil {
		return nil, fmt.Errorf("找不到可执行文件 %s: %w", name, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = filepath.Dir(bin) // 不让 cwd 参与后续子进程搜索
	out, err := cmd.Output()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, fmt.Errorf("%s 执行超时（%s）", name, timeout)
	}
	return out, err
}

// QueryVRAM 读取 nvidia-smi 当前显存数据（用于启动降档与状态栏）。
// 经 runWithTimeout（绝对路径 + 2s 超时）：挂起的 nvidia-smi 不再能永久
// 阻塞 Wails 绑定（B25）。
func QueryVRAM() (GPU, error) {
	var g GPU
	out, err := runWithTimeout(2*time.Second, "nvidia-smi",
		"--query-gpu=name,memory.total,memory.used,memory.free",
		"--format=csv,noheader,nounits")
	if err != nil {
		return g, fmt.Errorf("nvidia-smi 不可用: %w", err)
	}
	line := strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0]
	parts := strings.Split(line, ",")
	if len(parts) < 4 {
		return g, fmt.Errorf("nvidia-smi 输出格式异常: %q", line)
	}
	atoi := func(s string) int { n, _ := strconv.Atoi(strings.TrimSpace(s)); return n }
	g.Present = true
	g.Name = strings.TrimSpace(parts[0])
	g.TotalMB = atoi(parts[1])
	g.UsedMB = atoi(parts[2])
	g.FreeMB = atoi(parts[3])
	g.DriverOK = true
	return g, nil
}

// queryVRAMProbe 间接层：测试可替换为计数探针来验证 TTL 抑制（控制器裁定 R5），
// 生产路径恒为 QueryVRAM。
var queryVRAMProbe = QueryVRAM

type vramCache struct {
	mu       sync.Mutex
	at       time.Time
	val      GPU
	hasValue bool
}

var vramCacheState vramCache

// QueryVRAMCached 供状态栏 5s 轮询使用：TTL 内命中缓存则不 spawn 进程（B25）。
func QueryVRAMCached(ttl time.Duration) (GPU, error) {
	c := &vramCacheState
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hasValue && !c.at.IsZero() && time.Since(c.at) < ttl {
		return c.val, nil
	}
	g, err := queryVRAMProbe()
	if err != nil {
		return GPU{}, err
	}
	c.at, c.val, c.hasValue = time.Now(), g, true
	return g, nil
}

// PortPoolMin/Max llama-server 端口池（01 文档 §2.1）。
const (
	PortPoolMin = 8101
	PortPoolMax = 8110
)

// SweepResiduals 清扫残留 llama-server 子进程。
// 三重指纹（缺一不杀，避免误杀用户自己的 llama.cpp 实例）：
//  1. 进程名 == llama-server.exe
//  2. 命令行包含本机 models\ 绝对路径
//  3. 监听端口 ∈ 8101-8110
func SweepResiduals() ResidualSweepResult {
	res := ResidualSweepResult{Cleaned: []string{}}
	modelsDirAbs, err := filepath.Abs(paths.ModelsDir())
	if err != nil {
		return res
	}
	modelsFingerprint := strings.ToLower(modelsDirAbs)

	procs, err := winproc.List()
	if err != nil {
		return res
	}
	ports, err := winproc.ListenerPortsByPID()
	if err != nil {
		// 该分支有实际副作用（B25 Step 5 核对）：放弃本轮清扫并原样返回——三指纹
		// 缺一不杀，不降级为"双指纹 + 不校验端口"的猜测式清理。
		return res
	}
	for _, p := range procs {
		if !strings.EqualFold(p.Name, "llama-server.exe") {
			continue
		}
		if !strings.Contains(strings.ToLower(p.CmdLine), modelsFingerprint) {
			continue
		}
		port, ok := ports[p.PID]
		if !ok || int(port) < PortPoolMin || int(port) > PortPoolMax {
			continue
		}
		if killPID(p.PID, 5*time.Second) {
			desc := fmt.Sprintf("llama-server pid=%d port=%d", p.PID, port)
			res.Cleaned = append(res.Cleaned, desc)
			res.Count++
		}
	}
	return res
}

// killPID 优雅（CTRL_BREAK）→ 强杀（TerminateProcess）兜底。
func killPID(pid uint32, grace time.Duration) bool {
	h, err := windowsOpenProcess(pid)
	if err != nil {
		return false
	}
	defer windowsCloseHandle(h)
	_ = winproc.SendCtrlBreak(pid)
	if winproc.WaitForExit(h, grace) {
		return true
	}
	_ = winproc.TerminateProcess(h, 1)
	return winproc.WaitForExit(h, 2*time.Second)
}

// Probe 全量自检（首次引导第 1 步）。
func Probe() *EnvInfo {
	info := &EnvInfo{
		ModelsDir:       paths.ModelsDir(),
		CPULogicalCores: runtime.NumCPU(),
		CPUModel:        cpuModel(),
		ProbedAt:        time.Now().Unix(),
	}
	if g, err := QueryVRAM(); err == nil {
		info.GPU = g
	}
	lsPath := paths.LlamaServerPath()
	info.LlamaServerPath = lsPath
	if st, err := os.Stat(lsPath); err == nil && !st.IsDir() {
		info.LlamaServerOK = true
	}
	info.WebView2Present, info.WebView2Version = probeWebView2()
	return info
}

func cpuModel() string {
	out, err := runWithTimeout(1*time.Second, "reg", "query",
		`HKLM\HARDWARE\DESCRIPTION\System\CentralProcessor\0`, "/v", "ProcessorNameString")
	if err != nil {
		return ""
	}
	for _, ln := range strings.Split(string(out), "\n") {
		if strings.Contains(ln, "ProcessorNameString") {
			if i := strings.Index(ln, "REG_SZ"); i >= 0 {
				return strings.TrimSpace(ln[i+len("REG_SZ"):])
			}
		}
	}
	return ""
}

func probeWebView2() (bool, string) {
	keys := []string{
		`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
		`HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`,
	}
	for _, k := range keys {
		out, err := runWithTimeout(1*time.Second, "reg", "query", k, "/v", "pv")
		if err != nil {
			continue
		}
		for _, ln := range strings.Split(string(out), "\n") {
			if strings.Contains(ln, "pv") {
				if i := strings.Index(ln, "REG_SZ"); i >= 0 {
					return true, strings.TrimSpace(ln[i+len("REG_SZ"):])
				}
			}
		}
	}
	return false, ""
}
