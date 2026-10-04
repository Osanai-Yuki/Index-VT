// Package orchestrator 编排 llama-server 子进程生命周期（01 文档 §5.1）：
// 端口池 8101-8110、/health 探活、空闲自动卸载、退出全量释放、
// Job Object 崩溃兜底、指数退避重启、启动残留清扫。
//
// 并发不变量（02 文档 §6.1 锁序）：
//   - taskMu 保护 activeTasks 计数；任务路径先取 taskMu 递增，再走 EnsureRunning。
//   - 卸载路径：先取 taskMu 复核 activeTasks==0，再取 opMu 执行停止——
//     两处都持锁复核，杜绝"停止进行到一半新任务到达"的状态机错乱。
//   - opMu 串行化 start/stop；EnsureRunning 在 opMu 上轮询等待 Stopping 结束
//     （waitWhileStoppingLocked；cond 仅作防御性唤醒，见 setState）。
//
// 进程拉取安全：可执行文件白名单（仅分发目录内 llama-server.exe）+ 参数净化；
// CreateProcess 直传转义参数行，不经 shell（spawn_windows.go）。
package orchestrator

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"indexvt/internal/paths"
	"indexvt/internal/winproc"
)

type OrchestrationState string

const (
	StateIdle     OrchestrationState = "idle"     // 未运行（含休眠态的进程视角）
	StateStarting OrchestrationState = "starting" // 进程拉起 + /health 等待
	StateRunning  OrchestrationState = "running"
	StateStopping OrchestrationState = "stopping"
	StateCrashed  OrchestrationState = "crashed"
)

type Endpoint struct {
	Port    int    `json:"port"`
	BaseURL string `json:"baseURL"`
}

// Event 推送给前端的状态/提示事件。
type Event struct {
	Kind   string         `json:"kind"` // "state" | "notice" | "port"
	State  string         `json:"state,omitempty"`
	Reason string         `json:"reason,omitempty"`
	Text   string         `json:"text,omitempty"`
	Model  string         `json:"model,omitempty"`
	Extra  map[string]any `json:"extra,omitempty"`
}

// Settings 提供编排所需的用户设置视图（app 层实现，解耦 config）。
type Settings interface {
	NGLOverride() int  // -1=自动
	CtxTokens() int64  // -c
	CPUThreads() int   // 0=自动
	IdleMinutes() int  // 0=常驻
}

// Callbacks app 层注入的编排回调。
type Callbacks struct {
	// OnBeforeStop 在停止 llama-server 前调用：app 层取消所有进行中任务（断开 SSE）。
	OnBeforeStop func(reason string)
	// OnEvent 状态/通知事件（驱动前端徽标）。
	OnEvent func(Event)
}

type Orchestrator struct {
	set Settings
	cb  Callbacks
	log *slog.Logger

	opMu sync.Mutex
	cond *sync.Cond

	// 以下字段由 opMu 保护
	state      OrchestrationState
	procHandle winHandle
	job        winHandle
	exited     chan struct{}
	// watcherDone 由进程看护协程在退出路径末尾关闭（B24）。cleanupProcLocked
	// 必须确认 watcher 已退出才可 CloseHandle(procHandle)——它可能正阻塞在
	// WaitForSingleObject(procHandle) 上：提前关闭会让等待以 WAIT_FAILED 立即
	// 返回，更糟的是句柄值被系统复用后 watcher 会等在新进程的句柄上。
	watcherDone chan struct{}
	// pendingHandle：cleanupProcLocked 在 500ms 内等不到 watcherDone 时，把
	// procHandle 所有权移交 watcher，由其退出路径关闭。用 atomic 而非 opMu：
	// cleanup 持 opMu 等待 watcherDone，watcher 若需要 opMu 才能收尾就会死锁。
	pendingHandle atomic.Uintptr
	endpoint      Endpoint
	modelPath     string
	modelID       string
	port          int

	quit      chan struct{}
	closeOnce sync.Once
	started   bool

	taskMu       sync.Mutex
	activeTasks  int
	lastDoneNano atomic.Int64
}

func New(set Settings, cb Callbacks, log *slog.Logger) *Orchestrator {
	if log == nil {
		log = slog.Default()
	}
	o := &Orchestrator{
		set: set, cb: cb, log: log,
		state: StateIdle,
		quit:  make(chan struct{}),
	}
	o.cond = sync.NewCond(&o.opMu)
	return o
}

// Start 启动后台看护协程（空闲计时器）。
func (o *Orchestrator) Start() {
	o.opMu.Lock()
	if o.started {
		o.opMu.Unlock()
		return
	}
	o.started = true
	o.opMu.Unlock()
	go o.idleWatch()
}

func (o *Orchestrator) emit(ev Event) {
	if o.cb.OnEvent != nil {
		o.cb.OnEvent(ev)
	}
}

func (o *Orchestrator) setState(s OrchestrationState, reason string) {
	if o.state == s {
		return
	}
	o.state = s
	o.log.Info("orchestrator state", "state", s, "reason", reason, "model", o.modelID)
	// 不变量：任何 cond.Wait 必须有配对唤醒。改用轮询等待后仍保留 Broadcast，
	// 防止将来别处新增 Wait 又踩同一个坑（B12）。
	o.cond.Broadcast()
	o.emit(Event{Kind: "state", State: string(s), Reason: reason, Model: o.modelID})
}

// waitWhileStoppingLocked 在持有 opMu 时轮询等待卸载结束。
// 不用 sync.Cond 做等待：-race 不可用，唤醒方一旦漏写就是永久挂起（本次缺陷即如此）；
// 轮询无此风险。返回 false 表示超时，调用方必须放弃而非在卸载未完成时拉起新进程。
func (o *Orchestrator) waitWhileStoppingLocked(timeout time.Duration) bool {
	if o.state != StateStopping {
		return true
	}
	deadline := time.Now().Add(timeout)
	for o.state == StateStopping {
		o.opMu.Unlock() // 必须释放，否则 stopProcLocked 拿不到锁，永远等不到状态变化
		time.Sleep(20 * time.Millisecond)
		o.opMu.Lock()
		if time.Now().After(deadline) {
			o.log.Warn("等待模型释放超时", "timeout", timeout.String())
			return false
		}
	}
	return true
}

// ---------- 任务计数（02 文档 §6.1） ----------

// TaskBegin 任务到达：计数 +1 并确保推理进程就绪。
func (o *Orchestrator) TaskBegin(modelPath, modelID string) (Endpoint, error) {
	o.taskMu.Lock()
	o.activeTasks++
	o.taskMu.Unlock()
	ep, err := o.EnsureRunning(modelPath, modelID)
	if err != nil {
		o.TaskDone()
		return Endpoint{}, err
	}
	return ep, nil
}

func (o *Orchestrator) TaskDone() {
	o.taskMu.Lock()
	o.activeTasks--
	if o.activeTasks <= 0 {
		o.activeTasks = 0
		o.lastDoneNano.Store(time.Now().UnixNano())
	}
	o.taskMu.Unlock()
}

// ActiveTasks 当前进行中任务数。
func (o *Orchestrator) ActiveTasks() int {
	o.taskMu.Lock()
	defer o.taskMu.Unlock()
	return o.activeTasks
}

// IdleSeconds 运行中已空闲秒数（状态栏倒计时）。
func (o *Orchestrator) IdleSeconds() int {
	if o.State() != StateRunning {
		return 0
	}
	return int(time.Since(time.Unix(0, o.lastDoneNano.Load())).Seconds())
}

// KeepAlive 手动保持加载：重置空闲计时。
func (o *Orchestrator) KeepAlive() {
	o.lastDoneNano.Store(time.Now().UnixNano())
	o.emit(Event{Kind: "notice", Text: "idle-reset"})
}

// ---------- EnsureRunning / 停止 ----------

// EnsureRunning 幂等：未运行则启动；运行中同模型复用；不同模型热切换。
func (o *Orchestrator) EnsureRunning(modelPath, modelID string) (Endpoint, error) {
	o.opMu.Lock()
	defer o.opMu.Unlock()
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return Endpoint{}, fmt.Errorf("模型释放超时，请稍后重试")
	}
	if o.state == StateRunning && o.modelPath == modelPath {
		return o.endpoint, nil
	}
	if o.state == StateRunning || o.state == StateCrashed {
		// 热切换（ADR-003）：优雅停止旧进程
		o.stopProcLocked("hot-switch")
	}
	if err := o.startProcLocked(modelPath, modelID); err != nil {
		return Endpoint{}, err
	}
	return o.endpoint, nil
}

// Endpoint 当前运行端点。
func (o *Orchestrator) Endpoint() (Endpoint, bool) {
	o.opMu.Lock()
	defer o.opMu.Unlock()
	if o.state == StateRunning {
		return o.endpoint, true
	}
	return Endpoint{}, false
}

// State 当前编排状态。
func (o *Orchestrator) State() OrchestrationState {
	o.opMu.Lock()
	defer o.opMu.Unlock()
	return o.state
}

// CurrentModel 当前加载的模型 ID。
func (o *Orchestrator) CurrentModel() string {
	o.opMu.Lock()
	defer o.opMu.Unlock()
	return o.modelID
}

// Stop 优雅停止（gracefulTimeout 超时强杀）。
func (o *Orchestrator) Stop(gracefulTimeout time.Duration) error {
	o.opMu.Lock()
	defer o.opMu.Unlock()
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return fmt.Errorf("模型释放超时")
	}
	if o.state == StateIdle {
		return nil
	}
	return o.stopProcLocked("manual-stop", withGrace(gracefulTimeout))
}

type stopOpt struct{ grace time.Duration }

func withGrace(d time.Duration) stopOpt { return stopOpt{grace: d} }

// stopProcLocked 需持有 opMu。执行顺序（02 文档 §6.2/6.3）：
// 取消任务 SSE → CTRL_BREAK → 3s → TerminateProcess → Job Object 句柄确认。
func (o *Orchestrator) stopProcLocked(reason string, opts ...stopOpt) error {
	grace := 3 * time.Second
	if len(opts) > 0 && opts[0].grace > 0 {
		grace = opts[0].grace
	}
	if o.procHandle == 0 {
		o.setState(StateIdle, reason)
		return nil
	}
	o.setState(StateStopping, reason)
	if o.cb.OnBeforeStop != nil {
		o.cb.OnBeforeStop(reason) // app 层取消所有任务上下文（断开 SSE）
	}
	// 等 HTTP 连接关闭（02 文档 §6.3：≤1s）
	time.Sleep(300 * time.Millisecond)

	_ = winproc.SendCtrlBreak(o.pidLocked())
	if !winproc.WaitForExit(o.procHandle, grace) {
		o.log.Warn("graceful stop timeout, terminating", "pid", o.pidLocked())
		_ = winproc.TerminateProcess(o.procHandle, 1)
		winproc.WaitForExit(o.procHandle, 2*time.Second)
	}
	// Job Object 句柄确认（≤2s）：所有成员进程终止后 job 句柄 signaled
	winproc.WaitForExit(o.job, 2*time.Second)
	o.cleanupProcLocked()
	o.setState(StateIdle, reason)
	return nil
}

func (o *Orchestrator) pidLocked() uint32 {
	if o.procHandle == 0 {
		return 0
	}
	return winproc.PIDOf(o.procHandle)
}

func (o *Orchestrator) cleanupProcLocked() {
	if o.exited != nil {
		select {
		case <-o.exited:
		case <-time.After(1 * time.Second):
		}
	}
	if o.job != 0 {
		winproc.CloseJob(o.job)
		o.job = 0
	}
	if o.procHandle != 0 {
		// 只有 watcher 退出后才允许 CloseHandle：它可能正阻塞在
		// WaitForSingleObject(procHandle) 上，关句柄会让等待立即以 WAIT_FAILED
		// 返回、或更糟地句柄值被复用（B24）。
		if done := o.watcherDone; done != nil {
			select {
			case <-done:
			case <-time.After(500 * time.Millisecond):
				o.log.Warn("watcher 未在 500ms 内退出，把 handle 移交 watcher 自行关闭")
				o.pendingHandle.Store(uintptr(o.procHandle))
				o.procHandle = 0
				// 二次确认：watcher 可能恰在超时边界完成了尾部（先消费
				// pendingHandle 再关 done，且其"补消费"发生在 close(done) 之后）。
				// 观察到 done 关闭后若值仍在，说明直到 watcher 结束都无人消费，
				// 由本处收尾关闭（Swap 与 watcher 的 CAS 互斥，不会双重关闭）。
				select {
				case <-done:
					if h := o.pendingHandle.Swap(0); h != 0 {
						windowsCloseHandle(winHandle(h))
					}
				default:
				}
			}
		}
		if o.procHandle != 0 {
			windowsCloseHandle(o.procHandle)
			o.procHandle = 0
		}
	}
	o.watcherDone = nil
	o.exited = nil
	o.endpoint = Endpoint{}
	o.port = 0
	// modelPath/modelID 保留用于 UI"休眠"态显示
}

// PrepareExit 退出编排（02 文档 §6.3 时序）：由 app.PrepareExit 调用。
func (o *Orchestrator) PrepareExit() error {
	o.closeOnce.Do(func() { close(o.quit) })
	if o.cb.OnBeforeStop != nil {
		o.cb.OnBeforeStop("exit")
	}
	time.Sleep(500 * time.Millisecond) // 等 SSE 连接断开
	o.opMu.Lock()
	defer o.opMu.Unlock()
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return fmt.Errorf("模型释放超时")
	}
	if o.procHandle != 0 {
		return o.stopProcLocked("exit")
	}
	o.setState(StateIdle, "exit")
	return nil
}

// ---------- 启动进程 ----------

// validateExecutable 可执行文件白名单：仅允许分发目录内的 llama-server.exe。
func validateExecutable(exe string) error {
	base := filepath.Base(exe)
	if !strings.EqualFold(base, "llama-server.exe") {
		return fmt.Errorf("可执行文件白名单校验失败: %q", base)
	}
	absExe, err := filepath.Abs(exe)
	if err != nil {
		return err
	}
	baseDir, err := filepath.Abs(paths.BaseDir())
	if err != nil {
		return err
	}
	if !strings.HasPrefix(strings.ToLower(absExe), strings.ToLower(baseDir)+string(filepath.Separator)) {
		return fmt.Errorf("可执行文件不在分发目录内: %q", absExe)
	}
	st, err := os.Stat(absExe)
	if err != nil || st.IsDir() {
		return fmt.Errorf("llama-server.exe 不存在: %q", absExe)
	}
	return nil
}

// sanitizeArgs 参数净化：拒绝 NUL、控制字符与超长参数。
func sanitizeArgs(args []string) error {
	for i, a := range args {
		if a == "" {
			return fmt.Errorf("arg[%d] 为空", i)
		}
		if len(a) > 4096 {
			return fmt.Errorf("arg[%d] 超长", i)
		}
		for _, r := range a {
			if r == 0 || (r < 0x20 && r != '\t') {
				return fmt.Errorf("arg[%d] 含控制字符", i)
			}
		}
	}
	return nil
}

func (o *Orchestrator) startProcLocked(modelPath, modelID string) error {
	port, err := PickPort()
	if err != nil {
		o.setState(StateCrashed, "no-port")
		return fmt.Errorf("端口池 8101-8110 全部被占用: %w", err)
	}
	args, nglUsed, err := o.buildArgs(modelPath, port)
	if err != nil {
		return err
	}
	exe := paths.LlamaServerPath()
	if _, err := os.Stat(modelPath); err != nil {
		return fmt.Errorf("模型文件不存在: %w", err)
	}
	o.log.Info("starting llama-server", "port", port, "ngl", nglUsed, "model", filepath.Base(modelPath))

	job, err := winproc.CreateKillOnCloseJob()
	if err != nil {
		return fmt.Errorf("创建 Job Object 失败: %w", err)
	}
	handle, pid, err := spawnProc(exe, args, paths.BaseDir(), llamaLogPath(), job)
	if err != nil {
		winproc.CloseJob(job)
		return err
	}
	// job 分配已在 spawnProc 内、ResumeThread 之前完成（B24：消除孤儿窗口期），
	// 无需再在 CreateProcess 之后补 AssignToJob。
	o.log.Info("llama-server spawned", "pid", pid)
	o.procHandle = handle
	o.job = job
	o.port = port
	o.endpoint = Endpoint{Port: port, BaseURL: fmt.Sprintf("http://127.0.0.1:%d", port)}
	o.modelPath = modelPath
	o.modelID = modelID
	o.exited = make(chan struct{})
	o.watcherDone = make(chan struct{})
	o.emit(Event{Kind: "port", Extra: map[string]any{"port": port}})

	exited := o.exited
	watcherDone := o.watcherDone
	go func() {
		// 进程句柄等待；WAIT_FAILED（句柄异常）时轮询兜底，
		// 只有确认终止才关闭 exited（防止误判崩溃触发重启风暴）。
		// 使用真 INFINITE（B24）：旧常量 1<<31-1 被解释为 time.Duration(2.147s)，
		// 看护协程每 2.1s 假醒一次。
		for {
			if winproc.WaitForExitInfinite(handle) {
				break
			}
			// 未能确认：探活复核，仍存活则继续等
			if err := probeHealth(o.endpoint.BaseURL, 2*time.Second); err == nil {
				time.Sleep(5 * time.Second)
				continue
			}
			time.Sleep(1 * time.Second)
			if !winproc.WaitForExit(handle, 5*time.Second) && !winproc.WaitForExitInfinite(handle) {
				// 仍无法确认终止 → 以终止处理（句柄已不可信）
				break
			}
			break
		}
		// watcher 退出路径（B24）：cleanup 若超时已把 handle 所有权移交
		// （pendingHandle），必须由本协程关闭——它就是阻塞在该句柄上的等待者。
		// CAS 同时校验"值仍是本句柄"，与清理侧 Swap 互斥，双重关闭不可能发生。
		consumePending := func() {
			if o.pendingHandle.CompareAndSwap(uintptr(handle), 0) {
				windowsCloseHandle(handle)
			}
		}
		consumePending()
		close(exited)
		close(watcherDone)
		// 补一次：cleanup 的移交可能恰好落在上面 CAS 与 close(watcherDone) 之间
		// （cleanup 观察到 done 未关 -> 移交 -> 本协程此刻已错过第一个 CAS）。
		consumePending()
	}()
	o.setState(StateStarting, "spawn")

	// /health 轮询：500ms 间隔，15s 超时（02 文档 §5）
	if err := waitHealthy(o.endpoint.BaseURL, 15*time.Second); err != nil {
		o.log.Error("llama-server health check failed", "err", err)
		_ = winproc.TerminateProcess(handle, 1)
		winproc.WaitForExit(handle, 2*time.Second)
		winproc.WaitForExit(job, 2*time.Second)
		o.cleanupProcLocked()
		o.setState(StateIdle, "health-failed")
		return fmt.Errorf("llama-server 启动探活失败（15s）: %w", err)
	}
	o.setState(StateRunning, "healthy")
	o.lastDoneNano.Store(time.Now().UnixNano())

	go o.crashWatch(exited)
	go o.healthWatch()
	return nil
}

// 注：原 watchInfinite = 1<<31-1 常量已删除（B24）。它作为无类型常量传入
// winproc.WaitForExit(time.Duration) 后被解释为 2147483647ns ≈ 2.147s，
// 而非 WaitForSingleObject 的 INFINITE。现在使用 winproc.WaitForExitInfinite。

func llamaLogPath() string {
	return filepath.Join(paths.LogsDir(), "llama-server.out.log")
}

// crashWatch 运行中意外退出 → 指数退避重启（1s/2s/4s，3 次失败转 crashed）。
func (o *Orchestrator) crashWatch(exited chan struct{}) {
	select {
	case <-o.quit:
		return
	case <-exited:
	}
	o.opMu.Lock()
	defer o.opMu.Unlock()
	// 主动停止/热切换路径不走这里
	if o.state != StateRunning || o.procHandle == 0 || o.exited != exited {
		return
	}
	o.cleanupProcLocked()
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 4 * time.Second}
	nglLadder := []int{-1, 28, 0} // 重启逐次降层（02 文档 §2 OOM 对策）
	for i, d := range backoffs {
		o.log.Warn("llama-server crashed, restarting", "attempt", i+1, "backoff", d)
		select {
		case <-o.quit:
			return
		case <-time.After(d):
		}
		o.emit(Event{Kind: "notice", Text: "restart-attempt", Extra: map[string]any{"attempt": i + 1}})
		if err := o.startProcLocked(o.modelPath, o.modelID); err != nil {
			o.log.Error("restart failed", "attempt", i+1, "err", err)
			continue
		}
		if i > 0 {
			o.emit(Event{Kind: "notice", Text: "restart-ok", Extra: map[string]any{"ngl": nglLadder[i]}})
		}
		return
	}
	o.setState(StateCrashed, "restart-exhausted")
}

// healthWatch 运行期每 10s 探活 /health（2s 超时），连续 2 次失败判定崩溃。
func (o *Orchestrator) healthWatch() {
	fails := 0
	for {
		select {
		case <-o.quit:
			return
		case <-time.After(10 * time.Second):
		}
		o.opMu.Lock()
		st, ep := o.state, o.endpoint
		if st != StateRunning {
			o.opMu.Unlock()
			return
		}
		o.opMu.Unlock()
		if err := probeHealth(ep.BaseURL, 2*time.Second); err != nil {
			fails++
			o.log.Warn("runtime health probe failed", "count", fails, "err", err)
			if fails >= 2 {
				o.opMu.Lock()
				h := o.procHandle
				o.opMu.Unlock()
				if h != 0 {
					_ = winproc.TerminateProcess(h, 1) // 触发 crashWatch 重启
				}
				return
			}
		} else {
			fails = 0
		}
	}
}

// idleWatch 空闲自动卸载计时器（1s ticker，02 文档 §6.1）。
func (o *Orchestrator) idleWatch() {
	t := time.NewTicker(1 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-o.quit:
			return
		case <-t.C:
		}
		mins := o.set.IdleMinutes()
		if mins <= 0 {
			continue // 常驻
		}
		if o.State() != StateRunning {
			continue
		}
		idleFor := time.Since(time.Unix(0, o.lastDoneNano.Load()))
		if idleFor < time.Duration(mins)*time.Minute {
			continue
		}
		// 持 taskMu 复核（02 文档 §6.1 锁序）
		o.taskMu.Lock()
		if o.activeTasks != 0 {
			o.taskMu.Unlock()
			continue
		}
		o.taskMu.Unlock()
		// 取 opMu 后二次复核：TaskBegin 先计数后取 opMu，期间计数变化则放弃卸载。
		o.opMu.Lock()
		if o.state == StateRunning && o.countTasks() == 0 {
			o.log.Info("idle timeout, unloading model", "idleFor", idleFor.String())
			o.emit(Event{Kind: "notice", Text: "idle-unload", Extra: map[string]any{"idleForSec": int(idleFor.Seconds())}})
			_ = o.stopProcLocked("idle-timeout")
		}
		o.opMu.Unlock()
	}
}

func (o *Orchestrator) countTasks() int {
	o.taskMu.Lock()
	defer o.taskMu.Unlock()
	return o.activeTasks
}

// ---------- 健康检查 ----------

func probeHealth(baseURL string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/health", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health status %d", resp.StatusCode)
	}
	return nil
}

func waitHealthy(baseURL string, total time.Duration) error {
	deadline := time.Now().Add(total)
	for time.Now().Before(deadline) {
		if err := probeHealth(baseURL, 2*time.Second); err == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return errors.New("健康检查超时")
}

// ---------- 端口池 ----------

// PortPoolMin/Max llama-server 端口池（01 文档 §2.1）。
const (
	PortPoolMin = 8101
	PortPoolMax = 8110
)

// PickPort 端口池 8101-8110 TCP 探测（02 文档 §5 现象 A）。
func PickPort() (int, error) {
	for p := PortPoolMin; p <= PortPoolMax; p++ {
		ln, err := net.Listen("tcp4", fmt.Sprintf("127.0.0.1:%d", p))
		if err == nil {
			ln.Close()
			return p, nil
		}
	}
	return 0, errors.New("8101-8110 无可用端口")
}
