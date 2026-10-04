# Track A 后端止血 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除会崩溃、死锁、丢数据、破安全边界的后端缺陷，并补齐字幕事件契约（`Translated` 字段），使前端第一次能真实呈现批量翻译结果。

**Architecture:** 只改 `app/` 内既有包的并发边界、校验边界与事件负载。不改 SQL schema、不新增产品能力、不动 `frontend/`。本计划是 spec 批次 1 的全部内容与批次 3 的后端前置（B1–B7、B26–B31）。

**Tech Stack:** Go 1.27，`CGO_ENABLED=0`，Windows-only，module `indexvt`，Wails v2 绑定层。测试用标准 `testing` + `net/http/httptest` + `archive/zip`。

**Spec:** `docs/superpowers/specs/2026-10-04-gui-redesign-and-defect-fixes-design.md`（B1–B32 清单、§7 并发不变量、§8 验证矩阵）
**需求与验收:** `spark-output/prd/sujian-gui-redesign.md`（PRD S3 / S6 / S9 的 GWT）
**姊妹计划:** Track B 前端地基（`2026-10-04-sujian-track-b-frontend-foundation.md`）—— 本计划完成后另出。spec §3.3 的 **B32（`tsconfig.json` 打开 `noUnusedLocals`/`noUnusedParameters`）属于 Track B**，不在本计划范围内。本计划覆盖 **B1–B31**。

## Global Constraints

- `cd app && go build ./...`、`go vet ./...`、`go test ./...` 现状**全绿**（`modelmanager` / `subtitle` / `translator` 三包有测试）。这是回归基线，每个 Task 结束时必须仍全绿。
- `CGO_ENABLED=0`（ADR-001）→ **`go test -race` 不可用**。禁止在任何完成报告中出现「race detector 通过」这类表述；竞态类修复只能用确定性并发测试 + 手工验证，并如实说明覆盖局限。
- **锁顺序不变量**（spec §7，违反即缺陷）：`orchestrator.opMu` → `modelmanager.m.mu` → `App.mu` → `App.cfgMu` → `subtitle.Engine.mu` → store。永不反向。**持锁期间不得调用 `EventsEmit`、`onProgress` 或任何回调。**
- 不新增运行时依赖。不新增产品能力：cue 编辑、字幕页术语选择器、`allowUnverified` 风险放行出口一律不做（`verifyIntegrity` 错误文案指向既有的「从本地导入」路径）。
- 每个 Step 标注「按实际代码调整」的地方，**必须先读源码确认真实签名/常量名/字段名再改**；不得凭本文档的示例名硬套。
- Task 1.0 决定是否启用 git。若无版本控制，跳过所有 Step 的 commit 并在报告首行声明。

## spec B 编号 → Task 映射（逐条可追溯）

| spec | 缺陷 | Task | | spec | 缺陷 | Task |
|---|---|---|---|---|---|---|
| B1 | `CueProgress` 缺 `Translated` | 1.9 | | B17 | `AssignUnknown` 任意文件移动 | 1.6 |
| B2 | `done++` 在 emit 之后 | 1.9 | | B18 | 校验 fail-open / 无上限 / http | 1.5 |
| B3 | 缺 `SubGetDoc` 绑定 | 1.10 | | B19 | CSV 公式注入 | 1.11 |
| B4 | 非终态事件被丢弃 | 1.9 | | B20 | `SaveGlossary` 无事务 | 1.8 |
| B5 | `RetryCues` 预清空丢原译文 | 1.10 | | B21 | `ListHistory` offset 溢出 | 1.8 |
| B6 | 队列 ctx 泄漏 | 1.9 | | B22 | SSE 取消丢文本 / 缓冲无上限 / **首字节 60s 看门狗** | 1.4 + 最终修复波次 |
| B7 | 解锁后读 `cue` | 1.9 | | B23 | `Translate` 不可取消 ctx | 1.18 |
| B8 | `a.cfg` 无锁共享 | 1.7 | | B24 | 假 INFINITE / handle 生命周期 | 1.13 |
| B9 | `SetActiveModel` 互相覆盖 | 1.7 | | B24 | `CREATE_NO_WINDOW` 致强杀 | 1.14 |
| B10 | `deltaBatcher` 双重 close | 1.1 | | B25 | `nvidia-smi` 每轮 spawn 无超时 | 1.15 |
| B11 | 绑定缺 `ensureReady` | 1.7 | | B26 | ASS `\N` / SSA Format 行 | 1.16 |
| B12 | `cond.Wait` 无 Broadcast | 1.2 | | B27 | UTF-16 BE / UTF-32 识别 | 1.16 |
| B13 | AB-BA 死锁 | 1.3 | | B28 | LRC 负时间戳 / 双语分支 | 1.16 |
| B14 | `CommandLine` 越界 | 1.13 | | B29 | 文件上限 / docs 淘汰 / 快照 | 1.17 |
| B15 | 单实例锁 fail-closed | 1.12 | | B30 | BackgroundColour / OnBeforeClose | 1.19 |
| B16 | `Delete` 误删 models 目录 | 1.6 | | B31 | 日志包脱敏 | 1.20 |

**B32（`tsconfig` 开 `noUnusedLocals`/`noUnusedParameters`）属 Track B，不在本计划。** 本计划覆盖 B1–B31 全部 31 项。

## 文件结构

```
新建（测试）
  app/deltabatcher_test.go                    1.1
  app/appgate_test.go                         1.7
  app/logs_test.go                            1.20
  app/internal/orchestrator/orchestrator_conc_test.go   1.2
  app/internal/modelmanager/safety_test.go    1.3 1.5 1.6
  app/internal/store/glossary_tx_test.go      1.8
  app/internal/subtitle/cueevent_test.go      1.9 1.10 1.17
  app/internal/csvsanitizer/csvsanitizer.go   1.11
  app/internal/csvsanitizer/csvsanitizer_test.go 1.11
  app/internal/paths/containment.go           1.6
  app/internal/paths/containment_test.go      1.6
新建（实现）
  （无新包；全部落在既有文件的修改中）
修改
  app/app.go  app/main.go  app/logs.go
  app/internal/orchestrator/orchestrator.go  spawn_windows.go  args.go
  app/internal/modelmanager/manager.go  download.go
  app/internal/translator/sse.go  translator.go
  app/internal/store/store.go
  app/internal/winproc/process_windows.go  console_windows.go
  app/internal/subtitle/engine.go  queue.go  astisub.go  encoding.go  lrc.go  roundtrip_test.go
  app/internal/envprobe/envprobe.go
```

---

## Task 1.0: 建立版本控制回滚点

**Files:** 无代码改动，仅仓库初始化

- [ ] **Step 1: 征得用户同意后才执行 `git init`**

用户已声明「已手动备份」。若不同意初始化仓库 → 跳过本 Task 全部步骤，并**删除后续每个 Task 的 commit Step**，最终报告首行写明「无版本控制，回滚依赖用户手动备份」。

- [ ] **Step 2: 写 `.gitignore`（必须排除 4.4GB 二进制）**

```gitignore
# 依赖与构建产物
frontend/node_modules/
frontend/dist/
frontend/package.json.md5
app/frontenddist/
app/build/bin/

# 大二进制与模型（thirdparty 2.9G + models 1.3G）
thirdparty/
models/
*.gguf
*.dll
*.exe

# 运行时产物
logs/
.smoke/
.playwright-mcp/
.tmp-*
*.log

# 工具私有目录（用户资产，不纳入版本控制，也不删除）
.mimosa/
.archcore/
.trae/
```

- [ ] **Step 3: 初始化并提交基线**

```bash
cd "E:/Code_Projects/Go/Index-VT_GUI"
git init
git add .gitignore app frontend docs spark-output
git status
git commit -m "chore: baseline before sujian gui redesign"
```
Expected: `git status` 中**没有** `models/`、`thirdparty/`、`node_modules/` 条目；`git commit` 输出对象体积 < 2MB。看到 `.gguf`/`.dll`/`.exe` 立即停手修 `.gitignore`。

---

## Task 1.1: `deltaBatcher` 双重 close 导致 panic 杀进程

**Files:**
- Modify: `app/app.go:59-104`（`deltaBatcher` 类型与 `close`）
- Test: `app/deltabatcher_test.go`（新建）

**Interfaces:**
- Consumes: 无
- Produces: `(*deltaBatcher) close()` 变为**幂等**；`newDeltaBatcher(flush func(string)) *deltaBatcher` 签名不变

**根因**：`app.go:139` 在 `OnBeforeStop` 里对每个 batcher 执行 `go b.close()`；`app.go:316` 翻译 goroutine 结束时也调 `batcher.close()`。模型热切换（普通↔配音走不同模型，`translator.go` 的 `ModelForMode` → `orchestrator.go:201` `stopProcLocked("hot-switch")` → `OnBeforeStop`）时两条路径必然相撞 → `close of closed channel`。该 panic 发生在非 Wails dispatcher 协程，不被 recover → 进程死亡。

- [ ] **Step 1: 写失败测试**

`app/deltabatcher_test.go`：

```go
package main

import (
	"sync"
	"testing"
)

// 并发 close 不得 panic（B10）。无 -race，用屏障 + 200 轮提高命中概率。
func TestDeltaBatcherConcurrentCloseDoesNotPanic(t *testing.T) {
	for iter := 0; iter < 200; iter++ {
		b := newDeltaBatcher(func(string) {})
		var start, done sync.WaitGroup
		start.Add(1)
		done.Add(4)
		for i := 0; i < 4; i++ {
			go func() {
				defer done.Done()
				start.Wait()
				b.close()
			}()
		}
		start.Done()
		done.Wait()
	}
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test -run TestDeltaBatcherConcurrentClose -count=1 .`
Expected: FAIL，输出含 `panic: close of closed channel`

- [ ] **Step 3: 用 `sync.Once` 使 close 幂等**

`app/app.go` 的 struct 加 `stopOnce sync.Once` 字段（放在 `stop chan struct{}` 之后），`close` 改为：

```go
func (b *deltaBatcher) close() {
	b.stopOnce.Do(func() { close(b.stop) })
	b.flushNow()
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `cd app && go test -run TestDeltaBatcherConcurrentClose -count=5 .`
Expected: PASS，5 次连跑稳定

- [ ] **Step 5: 回归**

Run: `cd app && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add app/app.go app/deltabatcher_test.go
git commit -m "fix(app): make deltaBatcher.close idempotent to stop double-close panic"
```

---

## Task 1.2: `cond.Wait()` 无唤醒方 → 任务静默永久挂起

**Files:**
- Modify: `app/internal/orchestrator/orchestrator.go:132-139`（`setState`）、`:193-195`、`:237-239`、`:318-320`（三处等待）
- Test: `app/internal/orchestrator/orchestrator_conc_test.go`（新建）

**Interfaces:**
- Consumes: `o.opMu sync.Mutex`、`o.state OrchestrationState`（同包测试可直接访问）
- Produces: `(*Orchestrator) waitWhileStoppingLocked(timeout time.Duration) bool` — 三个等待点统一改用；返回 `false` 表示超时，调用方须返回错误

**根因（已核实）**：`grep -rn "cond\." internal/orchestrator/` 确认只有 `:194 :238 :319` 三处 `o.cond.Wait()`，**全仓库零处 `Broadcast`/`Signal`**。`stopProcLocked`（`:261`）持 `opMu` 时 `setState(StateStopping, …)`；此后进到 `for o.state == StateStopping { o.cond.Wait() }` 的调用者永久沉睡。`cond.Wait()` 会释放 `opMu`，所以状态栏绑定仍工作 —— **症状是「那一次任务无限转圈、`Translate` 的 `defer OnTaskFinish` 永不执行、`activeTasks` 泄漏、空闲卸载永不触发」**，不是界面卡死。这比初版审计描述的「所有 UI 绑定一起死锁」更窄，但同样严重且完全静默。

- [ ] **Step 1: 读真实接口，写失败测试**

```bash
cd app && sed -n '30,100p' internal/orchestrator/orchestrator.go
```
按读到的 `Settings` 接口方法集与 `Orchestrator` 字段名写测试。`app/internal/orchestrator/orchestrator_conc_test.go`：

```go
package orchestrator

import (
	"testing"
	"time"
)

// state 停在 Stopping 时 EnsureRunning 必须在超时后返回，而不是永久挂起（B12）。
func TestEnsureRunningDoesNotHangWhileStopping(t *testing.T) {
	o := New(stubSettings{}, Callbacks{}, nil)
	o.opMu.Lock()
	o.state = StateStopping
	o.opMu.Unlock()

	done := make(chan error, 1)
	go func() {
		_, err := o.EnsureRunning(`C:\nonexistent.gguf`, "translate")
		done <- err
	}()

	select {
	case <-done: // 返回错误也算没挂死
	case <-time.After(5 * time.Second):
		t.Fatal("EnsureRunning 在 state=stopping 时永久挂起：cond.Wait 无唤醒方")
	}
}
```

Step 1b：`stubSettings{}` 必须实现 Step 1 读到的 `Settings` 接口全部方法。已知候选（以代码为准逐个核对，缺哪个补哪个）：

```go
type stubSettings struct{}

func (stubSettings) NGLOverride() int     { return -1 }
func (stubSettings) CtxTokens() int64     { return 8192 }
func (stubSettings) CPUThreads() int      { return 0 }
func (stubSettings) IdleMinutes() int     { return 5 }
func (stubSettings) State() string        { return "idle" }
func (stubSettings) CurrentModel() string { return "" }
func (stubSettings) EndpointPort() int    { return 0 }
func (stubSettings) IdleSeconds() int     { return 0 }
func (stubSettings) ActiveTasks() int     { return 0 }
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test -run TestEnsureRunningDoesNotHang -count=1 ./internal/orchestrator/`
Expected: FAIL，`EnsureRunning 在 state=stopping 时永久挂起：cond.Wait 无唤醒方`

- [ ] **Step 3: `setState` 加 Broadcast（防御），等待点改轮询**

`setState`（`:132-139`）—— 保留原有两行不动，只在 `o.log.Info(...)` 与 `o.emit(...)` 之间插入 `o.cond.Broadcast()`：

```go
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
```
Step 3b：`slog` 的键值对顺序、`Event` 的字段名以现状为准 —— 本 Step **只插入 `o.cond.Broadcast()` 一行 + 上面两行注释**，其余逐字保留原样。

新增辅助方法（紧跟 `setState` 之后）：

```go
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
```

三处等待点替换：

```go
// EnsureRunning（原 :193-195）
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return Endpoint{}, fmt.Errorf("模型释放超时，请稍后重试")
	}

// Stop（原 :237-239）
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return fmt.Errorf("模型释放超时")
	}

// PrepareExit（原 :318-320）
	if !o.waitWhileStoppingLocked(30 * time.Second) {
		return fmt.Errorf("模型释放超时")
	}
```

Step 3c：`grep -n "o.cond" internal/orchestrator/orchestrator.go` 确认替换后仅剩 `setState` 的 `Broadcast` 与 `New` 里的 `sync.NewCond`。两者都保留。

- [ ] **Step 4: 运行**

Run: `cd app && go test -run TestEnsureRunning -count=3 ./internal/orchestrator/ && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add app/internal/orchestrator/
git commit -m "fix(orchestrator): replace never-signalled cond.Wait with bounded polling"
```

---

## Task 1.3: `List()` × `MarkRan()` 的 AB-BA 死锁

**Files:**
- Modify: `app/internal/modelmanager/manager.go`（`List`，约 `:240-260`）
- Test: `app/internal/modelmanager/safety_test.go`（新建）

**Interfaces:**
- Consumes: Manager 持有的 orch 接口字段（`State()`/`CurrentModel()`/`ActiveTasks()`/`EndpointPort()`，均在 `opMu` 下取锁）
- Produces: `(*Manager) List() []ModelInfo` 签名不变；新不变量：**不得在持 `m.mu` 时调用任何 `m.orch.*`**

**根因**：`List()` 持 `m.mu` → 调 `m.orch.State()` 取 `opMu`；而 `Orchestrator.setState`（持 `opMu`）→ `emit` → `app.go:146` `a.models.MarkRan()` 取 `m.mu`。锁顺序相反 → AB-BA。

- [ ] **Step 1: 读实际代码**

```bash
cd app && grep -n "func (m \*Manager) List\|func (m \*Manager) MarkRan\|orch \|m\.mu\.Lock" internal/modelmanager/manager.go | head -20
sed -n '235,275p' internal/modelmanager/manager.go
```
记下：① `List` 内每一处 `m.orch.*` 的行号；② `MarkRan` 是否持 `m.mu`；③ orch 依赖的字段名与接口类型名（供 Step 2 的 fake 实现）；④ Manager 的构造函数签名。

- [ ] **Step 2: 写失败测试**

`app/internal/modelmanager/safety_test.go`（fake 的方法集按 Step 1 读到的接口写，**多一个方法都编译不过**）：

```go
package modelmanager

import (
	"sync"
	"testing"
	"time"
)

// deadlockOrch 的 State() 反向触发 MarkRan，构造 AB-BA：
// List 持 m.mu 取 opMu；MarkRan 被 setState 在持 opMu 时调用并取 m.mu。
// 必须实现 OrchestratorView 的全部 7 个方法（见 Step 2b 的接口定义）。
type deadlockOrch struct{ m *Manager }

func (f *deadlockOrch) State() string {
	_ = f.m.MarkRan("translate") // 模拟 orchestrator.setState 持 opMu 期间回调
	return "idle"
}
func (f *deadlockOrch) CurrentModel() string      { return "" }
func (f *deadlockOrch) CurrentModelPath() string  { return "" }
func (f *deadlockOrch) EndpointPort() int         { return 0 }
func (f *deadlockOrch) ActiveTasks() int          { return 0 }
func (f *deadlockOrch) IdleSeconds() int          { return 0 }
func (f *deadlockOrch) KeepAlive()                {}

// stubOrchView 是 Task 1.6 用的无害版本（不制造环路）。
type stubOrchView struct{}

func (stubOrchView) State() string                { return "idle" }
func (stubOrchView) CurrentModel() string         { return "" }
func (stubOrchView) CurrentModelPath() string     { return "" }
func (stubOrchView) EndpointPort() int            { return 0 }
func (stubOrchView) ActiveTasks() int             { return 0 }
func (stubOrchView) IdleSeconds() int             { return 0 }
func (stubOrchView) KeepAlive()                   {}

func TestListAndMarkRanDoNotDeadlock(t *testing.T) {
	m := newManagerForTest(t, &deadlockOrch{}) // deadlockOrch 持有一个 *Manager，见 Step 2b
	m.orch.(*deadlockOrch).m = m               // 回填，构造 AB-BA 环路

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(2)
		go func() { defer wg.Done(); _ = m.List() }()
		go func() { defer wg.Done(); _ = m.MarkRan("translate") }()
	}
	finished := make(chan struct{})
	go func() { wg.Wait(); close(finished) }()

	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("List × MarkRan 死锁（AB-BA：m.mu ↔ opMu）")
	}
}
```

Step 2b：已核实的真实依赖形态（无需再猜）——

```go
// internal/modelmanager/manager.go:64 —— fake 必须实现全部 7 个方法
type OrchestratorView interface {
	State() string
	CurrentModel() string
	CurrentModelPath() string
	EndpointPort() int
	ActiveTasks() int
	IdleSeconds() int
	KeepAlive()
}

// internal/modelmanager/manager.go:98 —— 构造签名
func New(st *store.Store, orch OrchestratorView, log *slog.Logger,
	sourcePrefFn func() string,
	onProgress func(DownloadProgress), onModels func()) *Manager
```

据此把 `deadlockOrch` 补全为 7 个方法（`CurrentModelPath()`、`IdleSeconds()`、`KeepAlive()` 各返回零值即可），并加测试夹具：

```go
func newManagerForTest(t *testing.T, orch OrchestratorView) *Manager {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, orch, nil, nil, nil, nil)
}
```
`m.orch = &deadlockOrch{m: m}` 的同包直接赋值成立（`orch` 是 `Manager` 的小写字段）。注意 `New` 的 `log` 传 nil 会被兜成 `slog.Default()`，`sourcePrefFn` 传 nil 有默认实现 —— 两者都无需构造。

- [ ] **Step 3: 运行，确认失败**

Run: `cd app && go test -run TestListAndMarkRanDoNotDeadlock -count=1 ./internal/modelmanager/`
Expected: FAIL，`List × MarkRan 死锁（AB-BA：m.mu ↔ opMu）`

- [ ] **Step 4: 先取编排态快照，再持 `m.mu`**

把 `List` 改成「编排态在锁外读，锁内只组装」：

```go
func (m *Manager) List() []ModelInfo {
	// 不变量：绝不在持 m.mu 时调用 m.orch.*（锁顺序 opMu → m.mu）。
	// 先在锁外把编排态读成快照，锁内只做纯计算。
	orchState := m.orch.State()
	currentModel := m.orch.CurrentModel()
	tasks := m.orch.ActiveTasks()
	port := 0
	if tasks > 0 {
		port = m.orch.EndpointPort()
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	// …… 原有遍历逻辑保留，但其中所有 m.orch.X() 调用改为使用上面四个快照变量
}
```

Step 4b：遍历体内若需要 `activeID`/`ranMap` 等 `m` 字段，照原样用（已在锁内）。若 `List` 里的状态推导函数本身也调 `m.orch.*`，把它改成接收快照参数的纯函数（`deriveState(mi *ModelInfo, orchState, current string, port int)`），**不得**留任何 `m.orch.*` 在锁内。

- [ ] **Step 5: 运行**

Run: `cd app && go test -run TestListAndMarkRan -count=3 ./internal/modelmanager/ && go build ./... && go vet ./... && go test ./...`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add app/internal/modelmanager/
git commit -m "fix(modelmanager): snapshot orchestration state before taking m.mu"
```

---

## Task 1.4: SSE 取消丢弃全部已流式文本 + 缓冲无上限

**Files:**
- Modify: `app/internal/translator/sse.go:189-273`（`ChatStream`）
- Modify: `app/internal/translator/translator.go:130-140`（取消分支，通常无需改，验证即可）
- Test: `app/internal/translator/cancel_test.go`（新建）

**Interfaces:**
- Consumes: `StreamResult`（`Text`/`FirstTokenLatency`/`Chunks`/`TokensPerSec`/`CompletionTokens`）
- Produces: `ChatStream` 在**所有返回路径**（含 error）保证 `result.Text` 为已累积文本；新增 `ErrStreamBufferOverflow`

**根因（已核实）**：`sse.go:261` 只在 `for` 正常结束后才 `result.Text = stripThink(full.String())`；取消或读错误时从 `:243 return result, err` 返回，`result.Text` 是零值 → `translator.go:135` 的 `TranslateResult{Output: result.Text}` 拿到空串。**界面上已经流出来的文字与后端返回值不一致，取消即丢全部译文。**

**同时澄清（修正初版审计的错误归因）**：取消**不会**杀掉 `llama-server` —— `translator.go:221 CancelActive` 只取消任务 ctx，不触碰 `orchestrator` 的任何 `stopProc` 路径。真正会永久占住 `activeTasks` 的是「请求挂死永不返回」，由 Task 1.18 修。

- [ ] **Step 1: 读结构，写失败测试**

```bash
cd app && sed -n '60,100p' internal/translator/sse.go   # ChatRequest / StreamResult 定义
```

`app/internal/translator/cancel_test.go`：

```go
package translator

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// 取消时也必须拿到已流式产出的文本（B22①）。
func TestChatStreamCancelKeepsPartialText(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fl, _ := w.(http.Flusher)
		for i := 0; i < 200; i++ {
			if _, err := fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"字%d \"}}]}\n\n", i); err != nil {
				return
			}
			if fl != nil {
				fl.Flush()
			}
			select {
			case <-r.Context().Done():
				return
			case <-time.After(40 * time.Millisecond):
			}
		}
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan StreamResult, 1)
	go func() {
		res, _ := newChatClient(srv.URL).ChatStream(ctx, chatRequestForTest(), nil)
		got <- res
	}()
	time.Sleep(250 * time.Millisecond)
	cancel()

	select {
	case res := <-got:
		if res.Text == "" {
			t.Fatalf("取消后已流式文本被丢弃：Text=%q（应非空）", res.Text)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("取消后 ChatStream 未返回")
	}
}

func chatRequestForTest() ChatRequest {
	return ChatRequest{
		Model:    "index-translate-2b",
		Messages: []ChatMessage{{Role: "user", Content: "你好"}},
	}
}
```

Step 1b：`ChatRequest` / `ChatMessage` 的字段名以 Step 1 读到的为准调整 `chatRequestForTest`；若还有 `MaxTokens` 等必填项按类型零值即可（不填不影响）。

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test -run TestChatStreamCancelKeepsPartialText -count=1 ./internal/translator/`
Expected: FAIL，`取消后已流式文本被丢弃：Text=""`

- [ ] **Step 3: 加缓冲上限哨兵**

在 `sse.go` 包级 var 区（`ErrCanceled` 附近，若无则加 `var` 块）：

```go
// ErrStreamBufferOverflow：服务器迟迟不发事件边界，拒绝继续缓冲（B22②）。
var ErrStreamBufferOverflow = errors.New("推理响应数据异常（SSE 事件缓冲超限）")

// maxEventBuf 单条 SSE 事件上限 1MB；正常 data: 行远小于此。
const maxEventBuf = 1 << 20
```

Step 3b：确认 `sse.go` 已 import `errors`；没有则加。

- [ ] **Step 4: 错误路径固化文本 + 溢出检查**

循环体 `eventBuf.WriteByte(chunk)` 之后插入：

```go
			eventBuf.WriteByte(chunk)
			if eventBuf.Len() > maxEventBuf {
				result.Text = stripThink(full.String()) // 已收到的部分仍返回
				result.FirstTokenLatency = firstToken
				result.Chunks = tokenCount
				return result, fmt.Errorf("%w：超过 %d 字节", ErrStreamBufferOverflow, maxEventBuf)
			}
```

`reader.ReadByte()` 的错误分支（原 `:235-244`）改为：

```go
		chunk, err := reader.ReadByte()
		if err != nil {
			if err == io.EOF {
				if eventBuf.Len() > 0 {
					_ = flushEvent(eventBuf.Bytes())
				}
				break
			}
			// 取消/读错误：已流式文本必须保留（旧实现在此丢失全部输出，B22①）
			result.Text = stripThink(full.String())
			result.FirstTokenLatency = firstToken
			result.Chunks = tokenCount
			return result, err
		}
```

- [ ] **Step 5: 消除统计逻辑三份重复**

`:261-272` 的收尾统计与上面两处有重复赋值。抽成单 helper 并三处共用：

```go
// finalizeStream 统一固化统计，供正常/取消/溢出三个返回点复用。
func finalizeStream(r *StreamResult, full string, firstToken time.Duration, tokenCount int, completionTokens int, start time.Time) {
	r.Text = stripThink(full)
	r.FirstTokenLatency = firstToken
	r.Chunks = tokenCount
	if r.CompletionTokens == 0 {
		r.CompletionTokens = completionTokens
	}
	if r.CompletionTokens == 0 {
		r.CompletionTokens = tokenCount
	}
	if firstToken > 0 && r.CompletionTokens > 1 {
		elapsed := time.Since(start) - firstToken
		if elapsed > 0 {
			r.TokensPerSec = float64(r.CompletionTokens) / elapsed.Seconds()
		}
	}
}
```
三处调用分别替换原有代码；`completionTokens` 从 `result.CompletionTokens`（已在 `flushEvent` 里被 usage chunk 写入）传入。

Step 5b：helper 里 `r.CompletionTokens` 既作输入又作输出容易读错——改成显式：调用前确保 `result.CompletionTokens` 已被 flushEvent 设过，helper 内只做「为 0 则回落到 tokenCount」。**不要为减少参数把逻辑藏进闭包。**

- [ ] **Step 6: 运行（含既有测试不回归）**

Run: `cd app && go test ./internal/translator/ -count=1 && go build ./... && go vet ./... && go test ./...`
Expected: 全绿（`sse_test.go` 既有断言不得被削弱）

- [ ] **Step 7: Commit**

```bash
git add app/internal/translator/
git commit -m "fix(translator): keep partial streamed text on cancel/error; cap SSE buffer"
```

---

## Task 1.5: 模型下载安全边界（fail-open 校验 / 无体积上限 / 允许 http）

**Files:**
- Modify: `app/internal/modelmanager/download.go`（`isAllowedURL` `:63`、体积与校验 `:380-415`、新增 `verifyIntegrity`）
- Test: `app/internal/modelmanager/safety_test.go`（追加）

**Interfaces:**
- Produces: `verifyIntegrity(official string, officialErr error, got string) error`；`const maxDownloadBytes int64 = 4 << 30`

**根因（已核实）**：① 拒绝条件写成 `if offErr == nil && official != "" && official != got` —— 官方校验和**取不到时只 `log.Warn` 然后照样 `os.Rename` 落盘**，随后被 `llama-server` 解析执行；② `if total > 0 && done != total` —— 无 `Content-Length` 时 `total==0`，体积检查整个跳过（审计实测到 764MB）；③ `isAllowedURL` 的 `u.Scheme != "https" && u.Scheme != "http"` 让明文 `http:` 通过。

- [ ] **Step 1: 写三条失败测试**（追加到 `safety_test.go`）

```go
func TestIsAllowedURLRejectsPlainHTTP(t *testing.T) {
	bad, _ := url.Parse("http://huggingface.co/x/y.gguf")
	if isAllowedURL(bad) {
		t.Fatal("http:// 不应被允许（仅 https）")
	}
	good, _ := url.Parse("https://huggingface.co/x/y.gguf")
	if !isAllowedURL(good) {
		t.Fatal("https://huggingface.co 应被允许")
	}
	lan, _ := url.Parse("https://169.254.169.254/latest/meta-data")
	if isAllowedURL(lan) {
		t.Fatal("链路本地地址不应被允许")
	}
}

// 官方校验和不可用 / 缺条目 / 不一致 → 全部拒绝；一致 → 放行（B18①）。
func TestVerifyIntegrityFailClosed(t *testing.T) {
	if err := verifyIntegrity("", errors.New("SHA256SUMS 不可达"), "aaaa"); err == nil {
		t.Fatal("官方校验和取不到时应拒绝，不得放行未校验文件")
	}
	if err := verifyIntegrity("", nil, "aaaa"); err == nil {
		t.Fatal("SHA256SUMS 缺该条目时应拒绝")
	}
	if err := verifyIntegrity("bbbb", nil, "aaaa"); err == nil {
		t.Fatal("校验不一致必须拒绝")
	}
	if err := verifyIntegrity("AAAA", nil, "aaaa"); err != nil {
		t.Fatalf("校验一致却失败: %v", err)
	}
}
```
Step 1b：`url` / `errors` import 补齐。若 `isAllowedURL` 当前允许列表里没有链路本地段（`169.254.0.0/16`），第三段断言会先失败 —— **那也是真缺陷**（DNS rebinding 之外的直接 SSRF 面），在 Step 3 一并补：拒绝 `169.254.`、`10.`、`127.`、`192.168.`、`172.16.`–`172.31.`、`::1`、`0.0.0.0` 开头的 host（用 `net.ParseIP` + `IsPrivate`/`IsLoopback`/`IsLinkLocal`，比字符串前缀可靠）。

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test -run "TestIsAllowedURLRejectsPlainHTTP|TestVerifyIntegrityFailClosed" -count=1 ./internal/modelmanager/`
Expected: FAIL（`verifyIntegrity undefined` 编译错误也算正确失败态；scheme 断言报 `http:// 不应被允许`）

- [ ] **Step 3: 收紧 scheme + 私有地址**

```go
func isAllowedURL(u *url.URL) bool {
	if u.Scheme != "https" { // B18③：模型完整性不能靠明文传输兜底
		return false
	}
	host := strings.ToLower(u.Hostname())
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
			return false
		}
	}
	if host == "localhost" {
		return false
	}
	for _, s := range allowedHostSuffixes {
		if strings.HasSuffix(host, s) || host == strings.TrimPrefix(s, ".") {
			return true
		}
	}
	return false
}
```
Step 3b：`allowedHostSuffixes` 与循环体尾部以现状为准；上面只是把 scheme 与 IP 策略插进去，**不要顺手改写既有的后缀匹配逻辑**（它在 DNS pin 那里有配套行为）。

- [ ] **Step 4: `verifyIntegrity` 实现（fail-closed）**

```go
// verifyIntegrity 判定下载完整性。fail-closed：拿不到官方校验和即拒绝。
// 理由：落盘文件随后会被 llama-server 解析执行，恶意/损坏 GGUF 经张量解析
// 即构成以用户权限执行代码的路径。缺失校验和时指向既有的「从本地导入」路径，
// 本版不提供 allowUnverified 风险放行开关（属新增能力，PRD R-7 决定不做）。
func verifyIntegrity(official string, officialErr error, got string) error {
	if officialErr != nil {
		return fmt.Errorf("无法获取官方 SHA256SUMS，拒绝安装未校验模型；可先把文件放入 models/ 再用「从本地导入」: %w", officialErr)
	}
	if official == "" {
		return fmt.Errorf("官方 SHA256SUMS 缺少该文件条目，拒绝安装未校验模型")
	}
	if !strings.EqualFold(official, got) {
		return fmt.Errorf("SHA256 校验失败：期望 %s，实际 %s", official, got)
	}
	return nil
}
```

替换 `:398-410` 三段判定：

```go
	official, offErr := fetchOfficialSHA256(ctx, spec.Repo, file, chosen)
	got, err := sha256File(partFile)
	if err != nil {
		return fail("SHA256 计算失败: " + err.Error())
	}
	if verr := verifyIntegrity(official, offErr, got); verr != nil {
		_ = os.Remove(partFile)
		_ = os.Remove(metaFile)
		return fail(verr.Error())
	}
```
（原来 `offErr != nil` 时那句 `m.log.Warn(...)` 删除 —— 它正是 fail-open 的伪装。）

- [ ] **Step 5: 无 Content-Length 时的硬上限**

包级：

```go
// maxDownloadBytes 无 Content-Length 时的熔断上限（4GB，覆盖三模型最大档位）。
// 修 B18②：total==0 时旧代码的 `if total > 0 && done != total` 整个跳过体积检查。
const maxDownloadBytes int64 = 4 << 30
```

写循环内每累计 `done` 之后（在既有错误检查之前）：

```go
			if done > maxDownloadBytes {
				out.Close()
				return fail(fmt.Sprintf("已下载 %d 字节超过上限 %d，连接已切断（.part 已保留）", done, maxDownloadBytes))
			}
```

- [ ] **Step 6: 运行 + Commit**

```bash
cd app && go test ./internal/modelmanager/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/modelmanager/
git commit -m "fix(modelmanager): fail-closed integrity check, hard size cap, https-only"
```

---

## Task 1.6: 文件路径安全（`Delete` 误删目录 / `AssignUnknown` 任意文件移动）

**Files:**
- Create: `app/internal/paths/containment.go` + `app/internal/paths/containment_test.go`
- Modify: `app/internal/modelmanager/manager.go`（`AssignUnknown`、`Delete`）、`app/internal/orchestrator/args.go:59`（激活 `sanitizeGGUFPath`）
- Test: `safety_test.go`（追加一条）

**Interfaces:**
- Consumes: `paths.ModelsDir() string`（既有）
- Produces: `paths.Contains(base, target string) (string, error)`、`paths.ValidateGGUFName(name string) error`

**根因（已核实并修正影响范围）**：`spec.Files[quant]` 未命中返回 `""` → `filepath.Join(ModelsDir(), "")` = **models 目录本身**。`Delete` 里 `os.Remove(目录)` 在目录**非空**时返回错误 → 报错了（侥幸安全）；**目录为空时会真的删掉 `models/`**。`AssignUnknown` 对调用方给的任意 `path` 直接 `os.Rename(path, dst)`，无归拢检查、无 `.gguf` 检查（对比 `ImportGGUF` 有），且 `dst` 可能是目录 → 任意文件可被搬进 `models/`。`sanitizeGGUFPath` 声明了却从未被调用。

- [ ] **Step 1: 写失败测试**

`app/internal/paths/containment_test.go`：

```go
package paths

import (
	"os"
	"path/filepath"
	"testing"
)

func TestValidateGGUFName(t *testing.T) {
	for _, n := range []string{"Index-Translate-2B.Q4_K_M.gguf", "my model.gguf", "x.YY.GGUF"} {
		if err := ValidateGGUFName(n); err != nil {
			t.Fatalf("%q 应合法，却报错 %v", n, err)
		}
	}
	for _, n := range []string{"", ".gguf", "..", "../../etc/passwd", `sub\x.gguf`, "x.GGUF.exe", "x.txt", "/abs/x.gguf"} {
		if err := ValidateGGUFName(n); err == nil {
			t.Fatalf("%q 应被拒绝", n)
		}
	}
}

func TestContainsRejectsDirAndEscape(t *testing.T) {
	base := t.TempDir()
	if _, err := os.Create(filepath.Join(base, "ok.gguf")); err != nil {
		t.Fatal(err)
	}
	if _, err := Contains(base, filepath.Join(base, "ok.gguf")); err != nil {
		t.Fatalf("目录内合法文件被拒: %v", err)
	}
	if _, err := Contains(base, base); err == nil {
		t.Fatal("目录本身必须被拒绝（Delete 正是栽在这里）")
	}
	if _, err := Contains(base, filepath.Join(base, "..", "..", "x.gguf")); err == nil {
		t.Fatal(".. 逃逸必须被拒绝")
	}
	outside := filepath.Join(filepath.Dir(base), "x.gguf")
	if _, err := Contains(base, outside); err == nil {
		t.Fatal("目录外绝对路径必须被拒绝")
	}
}
```

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test ./internal/paths/ -count=1`
Expected: FAIL，`undefined: ValidateGGUFName` / `undefined: Contains`

- [ ] **Step 3: 实现归拢校验**

`app/internal/paths/containment.go`：

```go
package paths

import (
	"fmt"
	"path/filepath"
	"strings"
)

// Contains 返回 target 的绝对净化路径；若它不是 base 目录内的真实文件则报错。
// 用途：AssignUnknown / Delete 等「路径来自前端」的绑定必须过此关（spec B16/B17）。
// 只比较路径、不跟随符号链接：models/ 位于用户自有目录，软链逃逸面不在此威胁模型内。
func Contains(base, target string) (string, error) {
	absBase, err := filepath.Abs(filepath.Clean(base))
	if err != nil {
		return "", err
	}
	absT, err := filepath.Abs(filepath.Clean(target))
	if err != nil {
		return "", err
	}
	if absT == absBase {
		return "", fmt.Errorf("路径必须是文件而非目录: %s", target)
	}
	prefix := absBase + string(filepath.Separator)
	if !strings.HasPrefix(strings.ToLower(absT), strings.ToLower(prefix)) {
		return "", fmt.Errorf("路径越界：不在 %s 内", absBase)
	}
	return absT, nil
}

// ValidateGGUFName 校验文件名：不含路径分隔符、不含 ..、必须 .gguf 后缀。
// Windows 大小写不敏感，后缀比较用 ToLower。
func ValidateGGUFName(name string) error {
	if name == "" {
		return fmt.Errorf("文件名为空")
	}
	if filepath.Base(name) != name {
		return fmt.Errorf("文件名不得包含路径: %s", name)
	}
	if strings.Contains(name, "..") {
		return fmt.Errorf("文件名不得包含 ..: %s", name)
	}
	if !strings.HasSuffix(strings.ToLower(name), ".gguf") || len(name) <= len(".gguf") {
		return fmt.Errorf("仅接受 .gguf 文件: %s", name)
	}
	return nil
}
```
Step 3b：`paths` 包名与 `ModelsDir` 所在文件已确认（`internal/paths/paths.go`）。若该包已有同名 `Contains` 则改名 `WithinModelsDir`，并同步改所有引用。

- [ ] **Step 4: 接到 `Delete`**

```go
func (m *Manager) Delete(id ModelID, quant QuantKind) error {
	spec, ok := SpecByID(id)
	if !ok {
		return fmt.Errorf("未知模型 %s", id)
	}
	name, ok := spec.Files[quant]
	if !ok || name == "" { // B16：档位未命中直接拒绝，绝不 Join 出目录本身
		return fmt.Errorf("模型 %s 不支持量化档位 %s", id, quant)
	}
	if err := paths.ValidateGGUFName(name); err != nil {
		return err
	}
	if m.orch.CurrentModel() == string(id) && m.orch.State() == "running" {
		return fmt.Errorf("模型运行中，无法删除；请先切换模型或等待空闲释放")
	}
	target, err := paths.Contains(paths.ModelsDir(), filepath.Join(paths.ModelsDir(), name))
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	_ = m.store.DeleteModelFileByPath(target)
	m.notify()
	return nil
}
```
Step 4b：`spec.Files` 的类型（`map[QuantKind]string`？）与 `m.notify`、`m.store.DeleteModelFileByPath` 的名字先 `grep -n "Files \|notify()\|DeleteModelFileByPath" internal/modelmanager/manager.go internal/store/store.go` 核对，按实际调整。

- [ ] **Step 5: 接到 `AssignUnknown`**

```go
func (m *Manager) AssignUnknown(path string, id ModelID, quant QuantKind) (ModelInfo, error) {
	// B17：path 完全来自前端，必须先归拢在 models/ 内且是 .gguf，
	// 否则 os.Rename 就是任意文件移动原语。
	abs, err := paths.Contains(paths.ModelsDir(), path)
	if err != nil {
		return ModelInfo{}, err
	}
	if err := paths.ValidateGGUFName(filepath.Base(abs)); err != nil {
		return ModelInfo{}, err
	}
	meta, err := ReadGGUFMeta(abs)
	if err != nil {
		return ModelInfo{}, fmt.Errorf("GGUF 头解析失败: %w", err)
	}
	_ = meta
	spec, ok := SpecByID(id)
	if !ok {
		return ModelInfo{}, fmt.Errorf("未知模型 %s", id)
	}
	name, ok := spec.Files[quant]
	if !ok || name == "" {
		return ModelInfo{}, fmt.Errorf("模型 %s 不支持量化档位 %s", id, quant)
	}
	dst, err := paths.Contains(paths.ModelsDir(), filepath.Join(paths.ModelsDir(), name))
	if err != nil {
		return ModelInfo{}, err
	}
	if !strings.EqualFold(abs, dst) {
		if err := os.Rename(abs, dst); err != nil {
			return ModelInfo{}, err
		}
	}
	return m.registerExisting(dst, id, quant)
}
```

- [ ] **Step 6: 激活 `sanitizeGGUFPath`，避免两套校验漂移**

`app/internal/orchestrator/args.go:59`：

```go
// sanitizeGGUFPath 委托给 paths 包，避免与模型管理侧的两套校验漂移（B17）。
func sanitizeGGUFPath(p string) error {
	return paths.ValidateGGUFName(filepath.Base(p))
}
```
并在 `buildArgs` 拼 `-m` 参数的入口处调用它（先 `grep -n "buildArgs\|\"-m\"" internal/orchestrator/args.go` 定位）。`app/internal/paths` 若未被 `orchestrator` 包 import 过，加 import；确认无循环依赖（`paths` 不依赖 `orchestrator`）。

- [ ] **Step 7: 补目录误删与越界回归测试**（追加 `safety_test.go`）

已核实 `paths.BaseDir()` 优先读环境变量 `INDEXVT_ROOT`（`internal/paths/paths.go:15-18`），因此测试可用 `t.Setenv` 把 `models/` 指到临时目录，无需 `os.Chdir`：

```go
// newManagerWithModelsDir：用 INDEXVT_ROOT 把 models/ 隔离到临时目录
func newManagerWithModelsDir(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("INDEXVT_ROOT", root)
	if err := paths.EnsureDirs(); err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(root, "m.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st, &stubOrchView{}, nil, nil, nil, nil), paths.ModelsDir()
}

func TestDeleteUnknownQuantKeepsModelsDir(t *testing.T) {
	m, modelsDir := newManagerWithModelsDir(t)
	if err := m.Delete(ModelID("translate"), QuantKind("NOPE")); err == nil {
		t.Fatal("未知档位应报错")
	}
	if _, err := os.Stat(modelsDir); err != nil {
		t.Fatalf("models 目录被误删: %v", err)
	}
}

func TestAssignUnknownRejectsPathOutsideModels(t *testing.T) {
	m, _ := newManagerWithModelsDir(t)
	outside := filepath.Join(t.TempDir(), "hosts")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AssignUnknown(outside, ModelID("translate"), QuantKind("Q4_K_M")); err == nil {
		t.Fatal("models/ 外的路径必须被拒绝（否则就是任意文件移动原语）")
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("文件被移走了: %v", err)
	}
}
```
Step 7b：`stubOrchView{}` 复用 Task 1.3 Step 2b 的 7 方法实现（同包共享一个即可，命名统一为 `stubOrchView`；Task 1.3 的 `deadlockOrch` 是它的变体，两者都实现 `OrchestratorView`）。`QuantKind("Q4_K_M")` 的实际常量名从 `registry.go` 的 `Files` map 键里取（`grep -n "Q4_K_M\|QuantKind(" internal/modelmanager/registry.go`），不要用本文档的猜测值。

- [ ] **Step 8: 运行 + Commit**

```bash
cd app && go test ./internal/paths/ ./internal/modelmanager/ ./internal/orchestrator/ -count=1
cd app && go build ./... && go vet ./... && go test ./...
git add app/internal/paths/ app/internal/modelmanager/ app/internal/orchestrator/args.go
git commit -m "fix(paths): add containment + gguf-name validation, enforce in Delete/AssignUnknown"
```

---

## Task 1.7: `a.cfg` 无锁共享 + 绑定缺 `ensureReady` 门禁

**Files:**
- Modify: `app/app.go`（结构体 `:30-46`、`sourcePref` `:220`、编排适配器 `:224-240`、`ModelForMode` `:181-186`、`Translate` `:287`/`:345`、`SetActiveModel` `:444-454`、`GetConfig` `:508`、`SetConfig` `:511-518`、`GetSystemStatus` `:479-497`）
- Test: `app/appgate_test.go`（新建）

**Interfaces:**
- Produces: `(*App) cfgSnapshot() config.Config`、`(*App) withCfg(func(*config.Config))`；`GetConfig() (config.Config, error)` **签名变更**（Track B 的 `lib/wails.ts` 同步消费）

**根因**：`a.cfg` 是值类型结构体但被多线程读写：前端线程 `SetConfig`/`SetActiveModel` 写，`idleWatch`/`buildArgs`（`args.go:21,26`）、`sourcePref`（`manager.go:136` 经 `a.sourcePref`）、`ModelForMode`（`app.go:185`）读。`a.mu` 只保护 `taskSeq/deltas/closing`。string header 撕裂 → `-c` 等参数取错，或直接 crash。另：spec §3.3 B11 列出的 20 余处绑定无 `ensureReady`，`Wails OnStartup` 晚于前端加载，装配窗口内调用即 nil 解引用（`DisablePanicRecovery` 未设 → 被 recover 成 JS 错误，功能静默失效）。

- [ ] **Step 1: 先枚举全部直接访问点**

```bash
cd app && grep -n "a\.cfg\." app.go
cd app && grep -n "func (a \*App)" app.go | wc -l
cd app && grep -n "ensureReady" app.go
```
把三类输出留档：① `a.cfg.` 全部行号；② 绑定方法总数；③ 已有门禁的方法。**Step 5 的改动清单来自这三条命令的真实输出，不来自本文档的列举。**

- [ ] **Step 2: 写撕裂测试**

`app/appgate_test.go`：

```go
package main

import (
	"sync"
	"testing"
	"time"

	"indexvt/internal/config"
)

// 前端线程写、编排线程读：无锁会撕裂 string header（B8）。
// 无 -race，用"读到的值只能是两个写入值之一"这一不变量来暴露。
func TestConfigSnapshotNeverTears(t *testing.T) {
	a := &App{}
	a.cfg = config.Default()
	const aVal, bVal = "AAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBB"
	a.cfg.ActiveModel = aVal

	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(2)
	go func() {
		defer wg.Done()
		i := 0
		for {
			select {
			case <-stop:
				return
			default:
			}
			want := aVal
			if i%2 == 0 {
				want = bVal
			}
			v := want
			a.withCfg(func(c *config.Config) { c.ActiveModel = v })
			i++
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			got := a.cfgSnapshot().ActiveModel
			if got != aVal && got != bVal {
				t.Errorf("配置撕裂: %q", got)
				return
			}
		}
	}()
	time.Sleep(2 * time.Second)
	close(stop)
	wg.Wait()
}
```
Expected 失败态：`a.withCfg`/`a.cfgSnapshot` 未定义 → 编译错误。

- [ ] **Step 3: 加 `cfgMu` + 两个访问器**

```go
type App struct {
	…
	cfgMu sync.RWMutex // 保护 cfg。不变量：cfg 只能通过 cfgSnapshot/withCfg 访问（spec §7.3）
	…
}

func (a *App) cfgSnapshot() config.Config {
	a.cfgMu.RLock()
	defer a.cfgMu.RUnlock()
	return a.cfg // config.Config 全为值类型与 string（Step 4 核验）→ 拷贝即快照
}

func (a *App) withCfg(mut func(c *config.Config)) {
	a.cfgMu.Lock()
	defer a.cfgMu.Unlock()
	mut(&a.cfg)
}
```

Step 4（**核验，不能略**）：`sed -n '1,120p' internal/config/config.go` 确认 `Config` 及其嵌套结构**没有任何 slice/map/指针字段**。若存在（如未来加了 `[]string AllowedOrigins`），`cfgSnapshot` 必须逐字段深拷贝，并把「引用型字段需深拷贝」写进函数注释。**禁止在未核验的情况下让 `return a.cfg` 蒙混过关。**

- [ ] **Step 5: 把 Step 1 输出的每个 `a.cfg.X` 换成快照/改写**

规则：只读 → `c := a.cfgSnapshot()` 后用 `c.X`；写 → `a.withCfg(func(c *config.Config) { … })`。

`GetConfig` 签名变更：

```go
func (a *App) GetConfig() (config.Config, error) {
	return a.cfgSnapshot(), nil
}
```

`SetConfig` 与 `SetActiveModel`（B8 + B9）：

```go
func (a *App) SetConfig(cfg config.Config) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	cfg.Normalize()
	a.cfgMu.Lock()
	if !modelmanager.ValidModelID(cfg.ActiveModel) {
		cfg.ActiveModel = string(modelmanager.ModelTranslate)
	}
	a.cfg = cfg
	stored := a.cfg
	a.cfgMu.Unlock()
	return a.store.SetConfig("app", stored)
}

// SetActiveModel 在锁内 read-modify-write：整体覆盖会与 SetConfig 互相丢字段（B9）。
func (a *App) SetActiveModel(id string) error {
	if err := a.ensureReady(); err != nil {
		return err
	}
	if err := a.models.SetActive(modelmanager.ModelID(id)); err != nil {
		return err
	}
	a.cfgMu.Lock()
	a.cfg.ActiveModel = id
	stored := a.cfg
	a.cfgMu.Unlock()
	return a.store.SetConfig("app", stored)
}
```

- [ ] **Step 6: 补齐全部 `ensureReady` 门禁**

对 Step 1 输出中**没有** `ensureReady` 的每个绑定加门禁。返回类型不同，写法相应调整：

```go
// 返回 error only
if err := a.ensureReady(); err != nil { return err }
// 返回 (T, error)
if err := a.ensureReady(); err != nil { return nil, err }   // 或零值
// 无返回值（如 KeepAlive / SubCancelQueue）
func (a *App) KeepAlive() {
	if a.ensureReady() != nil { return }  // 未就绪时忽略即可，无副作用可丢
	a.orch.KeepAlive()
}
```

- [ ] **Step 7: `startup` 回调改惰性解引用 + 下移 `orch.Start()`**

现状 `app.go:131-149` 注册的 `Callbacks` 早于 `a.models`(`:153`)/`a.tr`(`:166`)/`a.sub`(`:195`) 赋值，且 `a.orch.Start()` 在 `:150` —— 一旦 `idleWatch` 在赋值前触发 `OnBeforeStop`，就是 nil 解引用。

```go
	OnBeforeStop: func(reason string) {
		// 回调在 orch.Start() 之后才会触发；仍做 nil 防护，因为装配顺序易被后续改动破坏。
		if a.tr != nil {
			a.tr.CancelAll()
		}
		if a.sub != nil {
			a.sub.CancelAllQueues()
		}
		a.mu.Lock()
		pending := make([]*deltaBatcher, 0, len(a.deltas))
		for id, b := range a.deltas {
			delete(a.deltas, id)
			pending = append(pending, b)
		}
		a.mu.Unlock()
		// close 已幂等（Task 1.1），锁外同步关闭即可，不再 fire-and-forget
		for _, b := range pending {
			b.close()
		}
	},
```
并把 `a.orch.Start()` 从 `:150` **下移到 `close(a.ready)` 之前**（所有依赖对象都已赋值后）。`OnEvent` 回调体里的 `a.models.MarkRan` 同样加 nil 防护。

- [ ] **Step 8: 运行 + Commit**

```bash
cd app && go test -run TestConfigSnapshot -count=3 . && go build ./... && go vet ./... && go test ./...
git add app/app.go app/appgate_test.go
git commit -m "fix(app): guard cfg with RWMutex, gate every binding on ensureReady"
```

---

## Task 1.8: store 事务与分页溢出

**Files:**
- Modify: `app/internal/store/store.go`（`SaveGlossary` `:289-317`、`ListHistory` `:160-175`）
- Test: `app/internal/store/glossary_tx_test.go`（新建）

**Interfaces:**
- Produces: `SaveGlossary` 签名不变，语义变为全有或全无；`ListHistory(page, pageSize int, starredOnly bool)` 对非法页码钳制而非产出负 OFFSET

- [ ] **Step 1: 读构造方式，写失败测试**

```bash
cd app && grep -n "func Open\|func (s \*Store) migrate\|user_version" internal/store/store.go | head
```

`app/internal/store/glossary_tx_test.go`：

```go
package store

import (
	"path/filepath"
	"testing"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// 词条写入中途失败时，原有术语本必须保持完整（B20）。
func TestSaveGlossaryRollsBackOnItemFailure(t *testing.T) {
	s := newTestStore(t)
	id, err := s.SaveGlossary(Glossary{Name: "FF14", Items: []GlossaryItem{
		{Term: "a", Translation: "A"}, {Term: "b", Translation: "B"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	// 用触发器阻断后续 INSERT
	if _, err := s.db.Exec(`CREATE TRIGGER trg AFTER INSERT ON glossary_items BEGIN SELECT RAISE(ABORT,'boom'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveGlossary(Glossary{ID: id, Name: "FF14改", Items: []GlossaryItem{{Term: "c", Translation: "C"}}}); err == nil {
		t.Fatal("插入被触发器阻断，应返回错误")
	}
	gs, err := s.ListGlossaries()
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range gs {
		if g.ID != id {
			continue
		}
		if len(g.Items) != 2 {
			t.Fatalf("未回滚：词条数=%d，期望仍是原来的 2 条", len(g.Items))
		}
		if g.Name != "FF14" {
			t.Fatalf("名称也被改了：%q（应整体回滚）", g.Name)
		}
		return
	}
	t.Fatal("术语本整个不见了")
}

func TestListHistoryIllegalPage(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.ListHistory(-5, 50, false); err != nil {
		t.Fatalf("负页码应被钳制而非报错: %v", err)
	}
	if _, err := s.ListHistory(1<<40, 50, false); err != nil {
		t.Fatalf("超大页码 offset 溢出成负数: %v", err)
	}
}
```

Step 1b：`Glossary`/`GlossaryItem` 字段名、`s.db` 字段名、表名 `glossary_items` 与列名，全部先 `sed -n '100,160p;280,320p' internal/store/store.go` 核对后对齐。若驱动不支持 `CREATE TRIGGER`（纯 Go SQLite 驱动通常支持），改用「插入一条超长 term 触发约束错误」来制造中途失败。

- [ ] **Step 2: 运行，确认失败**

Run: `cd app && go test ./internal/store/ -count=1`
Expected: FAIL，`未回滚：词条数=0，期望仍是原来的 2 条`

- [ ] **Step 3: `SaveGlossary` 包进事务**

```go
func (s *Store) SaveGlossary(g Glossary) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }() // Commit 成功后 Rollback 返回 ErrTxDone，忽略即可

	if g.ID == 0 {
		res, err := tx.Exec(`INSERT INTO glossaries(name) VALUES(?)`, g.Name)
		if err != nil {
			return 0, err
		}
		g.ID, err = res.LastInsertId()
		if err != nil {
			return 0, err
		}
	} else {
		if _, err := tx.Exec(`UPDATE glossaries SET name = ? WHERE id = ?`, g.Name, g.ID); err != nil {
			return 0, err
		}
		if _, err := tx.Exec(`DELETE FROM glossary_items WHERE glossary_id = ?`, g.ID); err != nil {
			return 0, err
		}
	}
	for _, it := range g.Items {
		if it.Term == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO glossary_items(glossary_id, term, translation) VALUES(?,?,?)`,
			g.ID, it.Term, it.Translation); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return g.ID, nil
}
```
（表名/列名按 Step 1b 核对结果替换。逻辑结构不变：**全部语句在同一个 tx 内，且不再有裸 `s.db.Exec`。**）

- [ ] **Step 4: `ListHistory` offset 钳制**

```go
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 50
	}
	// int64 计算，避免 (page-1)*pageSize 在 32 位溢出下变成负 OFFSET（B21）
	offset := int64(page-1) * int64(pageSize)
	if offset < 0 || offset > 1<<40 {
		offset, page = 0, 1
	}
```
Step 4b：确认 offset 当前是**参数化**还是**拼进 SQL 串**。若拼串，顺手改成参数化（这是 `LIMIT ? OFFSET ?` 的常规写法，也是审计确认「SQL 全参数化」的一个例外点）。

- [ ] **Step 5: 顺带核验 `migrate` 的建表跳过问题**

```bash
cd app && sed -n '/func.*migrate/,/^}/p' internal/store/store.go
```
若确实是 `if user_version == 1 { return nil }` 这类早退 → 改为「版本低于目标才建表」，并在 `glossary_tx_test.go` 加一条断言：全新空库调用 `Open` 后 `glossary_items` 表必须存在。

```go
func TestMigrateCreatesAllTables(t *testing.T) {
	s := newTestStore(t)
	for _, tbl := range []string{"history", "config", "glossaries", "glossary_items", "model_files"} {
		var n int
		if err := s.db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Errorf("表 %s 未创建", tbl)
		}
	}
}
```
Step 5b：表清单以 Step 5a 读到的 `migrate` 实际建表语句为准；**若 `migrate` 本就没有早退问题（审计可能误判），跳过本 Step 的修改，只保留这条表存在性测试作为回归锁。**

- [ ] **Step 6: 运行 + Commit**

```bash
cd app && go test ./internal/store/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/store/
git commit -m "fix(store): transactional SaveGlossary, clamp history offset in int64"
```

---

## Task 1.9: 字幕事件契约（`Translated` / 计数差一 / 解锁读 / ctx 泄漏 / 节流丢弃）

**Files:**
- Modify: `app/internal/subtitle/engine.go:93-101`（`CueProgress`）、`app/internal/subtitle/queue.go:55-148`
- Test: `app/internal/subtitle/cueevent_test.go`（新建）

**Interfaces:**
- Consumes: `e.translate(ctx, clean, "auto", opt.TargetLang)`（`queue.go:119`，签名不变 —— **注意它不传术语，故字幕页术语选择器本版不做**）
- Produces: `CueProgress{ DocID, CueIndex, State, Done, Total, OffTarget, NeedsCheck, Translated string \`json:"translated,omitempty"\` }`

- [ ] **Step 1: 读构造与常量名**

```bash
cd app && sed -n '1,60p' internal/subtitle/engine.go        # Cue/Format 常量/NewEngine
cd app && grep -n "func NewEngine\|FormatSRT\|CuePending\|queueCancel" internal/subtitle/*.go
```

- [ ] **Step 2: 写失败测试**

`app/internal/subtitle/cueevent_test.go`：

```go
package subtitle

import (
	"context"
	"strings"
	"testing"
	"time"
)

func newDocForTest(n int) *SubtitleDoc {
	cues := make([]Cue, 0, n)
	for i := 0; i < n; i++ {
		cues = append(cues, Cue{
			Index: i + 1, StartMs: int64(i * 1000), EndMs: int64(i*1000+900),
			Original: "原文", State: CuePending,
		})
	}
	return &SubtitleDoc{ID: "d1", Path: "x.srt", Encoding: "utf-8", Cues: cues}
}

func waitQueueDone(t *testing.T, e *Engine, docID string) {
	t.Helper()
	for i := 0; i < 400; i++ {
		e.mu.Lock()
		_, busy := e.queueCancel[docID]
		e.mu.Unlock()
		if !busy {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("队列 10s 内未结束")
}

// 终态事件必须带译文，且最后一行 Done == Total（B1/B2）。
func TestQueueEmitsTranslatedAndCorrectCount(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "译文:" + text, nil
	})
	doc := newDocForTest(3)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	var events []CueProgress
	done := make(chan struct{})
	err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, func(p CueProgress) {
		events = append(events, p)
		if p.State == CueDone && p.Done == p.Total {
			select {
			case <-done:
			default:
				close(done)
			}
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)

	var lastDone CueProgress
	for _, p := range events {
		if p.State == CueDone {
			lastDone = p
		}
		if p.State == CueDone && !strings.HasPrefix(p.Translated, "译文:") {
			t.Fatalf("终态事件缺译文: %+v", p)
		}
		if p.DocID != doc.ID {
			t.Fatalf("DocID 未填: %q", p.DocID)
		}
	}
	if lastDone.Done != lastDone.Total {
		t.Fatalf("计数差一：Done=%d Total=%d（应相等）", lastDone.Done, lastDone.Total)
	}
	if lastDone.Total != 3 {
		t.Fatalf("Total=%d，期望 3", lastDone.Total)
	}
}
```

Step 2b：`TranslateQueue` 是**同步返回 + 后台 goroutine**（现状 `queue.go:55` 起 `go func(){…}()`），所以上面用 `waitQueueDone` 轮询 `queueCancel` 是正确的等待方式。`NewEngine` 的参数顺序与 `QueueOptions` 字段名按 Step 1 读到的签名调整。`events` 切片在 `onProgress` 回调里被 append —— 该回调由队列 goroutine 调用，**测试里的读取必须等到 `waitQueueDone` 之后**（上面已如此），否则会引入测试自身的竞争。若要把断言做成实时检查，回调内需自加 `sync.Mutex`。

- [ ] **Step 3: 运行，确认失败**

Run: `cd app && go test ./internal/subtitle/ -run TestQueueEmitsTranslated -count=1`
Expected: FAIL，`p.Translated undefined`（编译错误）

- [ ] **Step 4: `CueProgress` 加字段**

```go
type CueProgress struct {
	DocID      string   `json:"docId"`
	CueIndex   int      `json:"cueIndex"`
	State      CueState `json:"state"`
	Done       int      `json:"done"`
	Total      int      `json:"total"`
	OffTarget  bool     `json:"offTarget,omitempty"`
	NeedsCheck bool     `json:"needsCheck,omitempty"`
	// Translated 是终态事件的译文文本（B1）。前端「译文」列的唯一实时来源；
	// 缺失时批量翻译的结果在界面上永远不可见 —— 这正是重构前的实际症状。
	Translated string `json:"translated,omitempty"`
}
```

- [ ] **Step 5: 锁内取值 → 解锁 emit → `done++` 提前**

`queue.go` 主循环收尾（原 `:127-145`）改为：

```go
			e.mu.Lock()
			cue = &doc.Cues[idx]
			if err != nil {
				cue.State = CueFailed
			} else {
				back, needsCheck := ReinsertOverrideTags(translated, tags)
				cue.Translated = back
				cue.State = CueDone
				cue.OffTarget = offTargetCheck(back, opt.TargetLang)
				cue.NeedsCheck = needsCheck
			}
			// 不变量（spec §7.2）：持锁期间不 emit。所需值先在锁内拷成局部值。
			p := CueProgress{
				CueIndex:   cue.Index,
				State:      cue.State,
				OffTarget:  cue.OffTarget,
				NeedsCheck: cue.NeedsCheck,
				Translated: cue.Translated,
			}
			e.mu.Unlock()

			done++ // B2：先计数再 emit，最后一行 Done == Total
			emit(p)
```
并删除原 `:139-145` 的 if/else 分支 emit 与末尾多余的 `done++`。Step 5b：`skipped` 分支（原 `:96`）也调 `emit`，同样确认其 `done++` 顺序 —— 该分支是 `done++; continue`，把 `emit(...)` 移到 `done++` 之后：

```go
				cue.State = CueSkipped
				e.mu.Unlock()
				done++
				emit(CueProgress{CueIndex: cue.Index, State: CueSkipped})
				continue
```

- [ ] **Step 6: 非终态事件合并发出而非丢弃**

`emit`（原 `:64-77`）改为：

```go
			var pending *CueProgress
			flushPending := func() {
				if pending == nil {
					return
				}
				q := *pending
				q.DocID, q.Total, q.Done = docID, total, done
				pending = nil
				onProgress(q)
			}
			emit := func(p CueProgress) {
				if onProgress == nil {
					return
				}
				// B4：终态立即推（并先冲掉挂起的非终态）；非终态只保留最新一条，
				// 到点合并发出。旧实现整条丢弃 → 行看起来卡在 pending。
				if p.State == CueDone || p.State == CueFailed {
					flushPending()
					p.DocID, p.Total, p.Done = docID, total, done
					lastEmit = time.Now()
					onProgress(p)
					return
				}
				if time.Since(lastEmit) < 100*time.Millisecond {
					cp := p
					pending = &cp
					return
				}
				p.DocID, p.Total, p.Done = docID, total, done
				lastEmit = time.Now()
				onProgress(p)
			}
			defer flushPending()
```
Step 6b：`defer flushPending()` 必须注册在 `go func(){…}()` 体内（这样队列结束时最后一条 `translating` 也会被冲出），位置紧随 `emit` 定义之后。`total`/`done` 是闭包捕获的循环变量，`flushPending` 读取的是**调用时刻**的 `done` —— 这正是我们要的语义，注释里写清楚，避免后人误以为该快照。

- [ ] **Step 7: 队列结束释放 context**

`queue.go:56-60` 的 defer：

```go
		defer func() {
			cancel() // B6：正常结束也必须释放，否则每跑一次队列泄漏一个 ctx
			e.mu.Lock()
			delete(e.queueCancel, docID)
			e.mu.Unlock()
		}()
```
Step 7b：确认 `cancel` 在该 goroutine 作用域内可见（`:37` 的 `ctx, cancel := context.WithCancel(…)` 在 `TranslateQueue` 函数体内，goroutine 闭包可捕获 —— 是的）。

- [ ] **Step 8: 运行 + Commit**

```bash
cd app && go test ./internal/subtitle/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/subtitle/
git commit -m "feat(subtitle): carry Translated in cue events; fix count, drop-lock emit, ctx leak"
```

---

## Task 1.10: `SubGetDoc` 绑定 + `RetryCues` 不预清空

**Files:**
- Modify: `app/app.go`（字幕组）、`app/internal/subtitle/queue.go:242-259`（`RetryCues`）、`app/internal/subtitle/engine.go:175`（`GetDoc` 快照，与 Task 1.17 协同）
- Test: `cueevent_test.go`（追加）

**Interfaces:**
- Produces: `(*App) SubGetDoc(docID string) (*subtitle.SubtitleDoc, error)`

- [ ] **Step 1: 写失败测试**

```go
// 重译失败时原有译文必须保留（B5）。旧实现先清空再重译，失败即永久丢失。
func TestRetryCuesKeepsOldTranslationOnFailure(t *testing.T) {
	var shouldFail bool
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		if shouldFail {
			return "", context.DeadlineExceeded
		}
		return "第一次", nil
	})
	doc := newDocForTest(2)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)
	if doc.Cues[0].Translated != "第一次" {
		t.Fatalf("前置条件不成立：%q", doc.Cues[0].Translated)
	}

	shouldFail = true
	if err := e.RetryCues(doc.ID, []int{1}, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	waitQueueDone(t, e, doc.ID)

	if doc.Cues[0].Translated != "第一次" {
		t.Fatalf("重译失败导致原译文丢失：%q（用户会永久失去这行结果）", doc.Cues[0].Translated)
	}
	if doc.Cues[0].State != CueFailed {
		t.Fatalf("状态应为 failed，实际 %v", doc.Cues[0].State)
	}
}
```

- [ ] **Step 2: 运行，确认失败** → `cd app && go test ./internal/subtitle/ -run TestRetryCuesKeepsOld -count=1`
Expected: FAIL，`重译失败导致原译文丢失：""`

- [ ] **Step 3: 去掉预清空**

```go
	for _, i := range cueIdx {
		for j := range doc.Cues {
			if doc.Cues[j].Index == i {
				doc.Cues[j].State = CuePending
				// 不清空 Translated：重译失败时用户仍能看到上一版结果（B5）。
				// 成功路径（queue.go 的 else 分支）会自然覆盖。
			}
		}
	}
```

- [ ] **Step 4: 新增绑定**

```go
// SubGetDoc 返回文档权威快照。用于：队列结束后一次性校准、事件丢包兜底、
// 以及 cue 表滚动到未订阅区间时的补全。
func (a *App) SubGetDoc(docID string) (*subtitle.SubtitleDoc, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	return a.sub.GetDoc(docID)
}
```

- [ ] **Step 5: `GetDoc` 返回隔离快照**

`engine.go:175` 的 `GetDoc` 当前返回活指针 → 前端持有期间与队列写竞争。改为深拷贝（拷贝实现在 Task 1.17 Step 2 的 `snapshotLocked`，本 Step 先就地实现最小版本，Task 1.17 再统一收敛）：

```go
func (e *Engine) GetDoc(id string) (*SubtitleDoc, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	doc, ok := e.docs[id]
	if !ok {
		return nil, fmt.Errorf("文档 %s 不存在", id)
	}
	return e.snapshotLocked(doc), nil
}
```
Step 5b：若 `snapshotLocked` 尚未实现（Task 1.17 才加），在本 Task 内先把它加到 `engine.go`（实现见 Task 1.17 Step 2），避免两处各自演化。**两 Task 任一先做都行，但只能有一份 `snapshotLocked`。**

- [ ] **Step 6: 运行 + Commit**

```bash
cd app && go test ./internal/subtitle/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/app.go app/internal/subtitle/
git commit -m "feat(app): expose SubGetDoc; keep prior translation when retry fails"
```

---

## Task 1.11: CSV 公式注入中和

**Files:**
- Create: `app/internal/csvsanitizer/csvsanitizer.go` + `csvsanitizer_test.go`
- Modify: `app/app.go:397-415`（`ExportGlossaryCSV`）

**Interfaces:**
- Produces: `csvsanitizer.Cell(s string) string`、`csvsanitizer.Quote(s string) string`

**根因**：现状只做 RFC4180 的双引号转义（`strings.ReplaceAll(it.Term, "\"", "\"\"")`），未处理以 `=` `+` `-` `@` 开头的内容 —— 导出文件被 Excel/WPS 打开时会被当公式执行。术语本的 term/translation 常常来自不受信来源（网上扒的对照表），构成真实注入面。

- [ ] **Step 1: 写失败测试**

```go
package csvsanitizer

import "testing"

func TestCellNeutralizesFormulas(t *testing.T) {
	cases := []struct{ in, want string }{
		{"=SUM(A1:A9)", "'=SUM(A1:A9)"},
		{"+1", "'+1"},
		{"-1", "'-1"},
		{"@SUM(A1)", "'@SUM(A1)"},
		{"\t=1", "'\t=1"},
		{"普通术语", "普通术语"},
		{"a=b", "a=b"},              // 非前导 = 不中和
		{`带"引号"`, `带"引号"`},     // 转义由 Quote 负责，Cell 不碰
		{"", ""},
	}
	for _, c := range cases {
		if got := Cell(c.in); got != c.want {
			t.Errorf("Cell(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestQuoteEscapesAndNeutralizes(t *testing.T) {
	if got := Quote(`=cmd`); got != `"'=cmd"` {
		t.Errorf("Quote(=cmd) = %q", got)
	}
	if got := Quote(`a"b`); got != `"a""b"` {
		t.Errorf("Quote(a\"b) = %q", got)
	}
}
```

- [ ] **Step 2: 运行，确认失败** → `cd app && go test ./internal/csvsanitizer/ -count=1`
Expected: FAIL，`undefined: Cell`

- [ ] **Step 3: 实现**

```go
// Package csvsanitizer 中和 CSV 单元格里的公式注入：导出的术语本
// 常被 Excel / WPS 打开，以 = + - @ 开头的内容会被当作公式执行。
package csvsanitizer

import "strings"

// Cell 对以 = + - @ 或制表/回车开头的内容前置单引号，阻断公式解析。
func Cell(s string) string {
	if s == "" {
		return s
	}
	switch s[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + s
	}
	return s
}

// Quote 先做注入中和，再做 RFC4180 双引号包裹与转义。
func Quote(s string) string {
	return `"` + strings.ReplaceAll(Cell(s), `"`, `""`) + `"`
}
```

- [ ] **Step 4: 接到 `ExportGlossaryCSV`**

```go
			var b strings.Builder
			b.WriteString("term,translation\n")
			for _, it := range g.Items {
				b.WriteString(csvsanitizer.Quote(it.Term) + "," + csvsanitizer.Quote(it.Translation) + "\n")
			}
			return b.String(), nil
```
并加 import `"indexvt/internal/csvsanitizer"`。删除原 `t := strings.ReplaceAll(...)` 两行。

- [ ] **Step 5: 运行 + Commit**

```bash
cd app && go test ./internal/csvsanitizer/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/csvsanitizer/ app/app.go
git commit -m "fix(csv): neutralize formula injection in glossary export"
```

---

## Task 1.12: 单实例锁 fail-closed → 程序根本起不来

**Files:**
- Modify: `app/main.go:57-67`、`app/internal/winproc/process_windows.go`（`TryCreateMutex`）

**Interfaces:**
- Produces: `TryCreateMutex(name string) (handle uintptr, acquired bool, err error)` —— **语义澄清**：`err != nil` 表示锁状态未知（不是「已有实例」）；仅 `ERROR_ALREADY_EXISTS` 时 `acquired == false, err == nil`

- [ ] **Step 1: 读现状**

```bash
cd app && grep -n "TryCreateMutex" -A 25 internal/winproc/process_windows.go
cd app && grep -n "func ReleaseMutex" -A 8 internal/winproc/*.go
```
确认 `acquired` 当前是怎么算出来的（审计结论：任何 `CreateMutex` 错误都走「已有实例」分支）。

- [ ] **Step 2: 分离「创建失败」与「已有实例」**

```go
	nameP, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return 0, false, err
	}
	// GetLastError 必须紧邻 CreateMutexW，中间不得插入其他 syscall
	r, _, lastErr := procCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(nameP)))
	if r == 0 {
		// 真正的创建失败：不能当成"已有实例在跑"，调用方应照常启动
		return 0, false, fmt.Errorf("CreateMutex: %w", lastErr)
	}
	alreadyRunning := lastErr == windows.ERROR_ALREADY_EXISTS
	return r, !alreadyRunning, nil
```
Step 2b：`procCreateMutexW` / `windows.ERROR_ALREADY_EXISTS` 的名字以 Step 1 读到的为准；若现有代码用手写的错误码常量，保留并加注释 `// ERROR_ALREADY_EXISTS`。

- [ ] **Step 3: `main.go` 改判定（fail-open + 注释写明理由）**

```go
	mh, acquired, err := winproc.TryCreateMutex(mutexName)
	switch {
	case err != nil:
		// 锁创建失败 ≠ 已有实例。此处必须 fail-open：若当成"已有实例"，
		// 任何 CreateMutex 异常（权限、策略、Global\ 命名空间限制）都会让
		// 程序去激活一个不存在的窗口然后退出，看起来像"双击没反应"（B15）。
		slog.Error("单实例锁创建失败，继续启动", "err", err)
	case !acquired:
		slog.Info("已有实例在运行，激活其窗口后退出")
		winproc.ActivateExistingWindow(windowTitle)
		return
	default:
		defer winproc.ReleaseMutex(mh)
	}
```

- [ ] **Step 4: 写可测部分的测试**

`app/internal/winproc/mutex_test.go`：

```go
package winproc

import "testing"

// 正常路径：第二次调用必须报"已有实例"，而不是 error。
func TestTryCreateMutexSecondCallReportsAlreadyRunning(t *testing.T) {
	name := `Local\IndexVT-MutexTest-` + t.Name()
	h1, acquired, err := TryCreateMutex(name)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("首次创建应获得实例权")
	}
	defer ReleaseMutex(h1)

	h2, acquired2, err2 := TryCreateMutex(name)
	if err2 != nil {
		t.Fatalf("第二次调用应是 alreadyRunning 而非错误: %v", err2)
	}
	if acquired2 {
		t.Fatal("第二次调用 acquired 必须为 false")
	}
	ReleaseMutex(h2)
}
```
Step 4b：**「`CreateMutex` 返回错误 → 仍继续启动」这条无法在单测里构造**（要真实权限/策略异常）。不为可测性引入 fake syscall 层（YAGNI）。该路径靠 Step 3 的 `switch` 结构保证，并在手工验收里检查「以管理员启动过一次后，普通权限再启动仍能起来」。

- [ ] **Step 5: 运行 + Commit**

```bash
cd app && go test ./internal/winproc/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/main.go app/internal/winproc/
git commit -m "fix(main): only ERROR_ALREADY_EXISTS means second instance"
```

---

## Task 1.13: `winproc` 缓冲区越界 / 假 INFINITE / handle 生命周期

**Files:**
- Modify: `app/internal/winproc/process_windows.go`（`CommandLine` `:70-90`、`ListenerPortsByPID` 附近的同类读取、`cleanupProcLocked` `:295-305`、watcher `:440-455`）

**Interfaces:**
- Produces: `CommandLine` 在缓冲区不足时返回 error 而非 panic

**根因（已核实并收窄）**：`CommandLine` 现有 `if int(usLen) > len(buf)-dataOff { usLen = uint16(len(buf)-dataOff) }` 会 clamp，但 `len(buf) < 16` 时 `len(buf)-dataOff` 为负 → `uint16(负数)` 回绕成巨值 → clamp 条件为假 → 随后 `&buf[16]` **索引越界 panic**（`buf` 只有 <16 字节）。触发条件是 `NtQueryInformationProcess` 返回畸形长度 —— 不是「遍历所有 PID 必崩」（收窄初版审计的说法），但在无 recover 的启动早期发生就是启动即崩。

- [ ] **Step 1: 长度前置校验**

```go
	const usLenOff = 0
	const dataOff = 16 // UNICODE_STRING 头大小（x64 对齐后）
	// 必须早于任何 &buf[dataOff]：缓冲区不足时 len(buf)-dataOff 为负，
	// uint16 回绕会让下面的 clamp 变成"无需 clamp"，然后索引越界 panic。
	if len(buf) < dataOff {
		return "", fmt.Errorf("NtQueryInformationProcess: 返回 %d 字节，不足以容纳 UNICODE_STRING 头", len(buf))
	}
	usLen := *(*uint16)(unsafe.Pointer(&buf[usLenOff]))
	if int(usLen) > len(buf)-dataOff {
		usLen = uint16(len(buf) - dataOff)
	}
	if int(usLen)%2 != 0 { // WCHAR 数组必须偶数字节
		usLen--
	}
	u16 := unsafe.Slice((*uint16)(unsafe.Pointer(&buf[dataOff])), int(usLen)/2)
	return windows.UTF16ToString(u16), nil
```
Step 1b：`dataOff`/`usLenOff` 现在声明在 clamp 之后，需上移到校验之前（即把它们提到 `if len(buf) < dataOff` 之前）。`buf` 的分配与 `retLen` 的两次赋值按现状保留。

- [ ] **Step 2: 用真实 INFINITE 替换被当 `time.Duration` 传的值**

```bash
cd app && grep -n "watchInfinite\|WaitForSingleObject" -B3 -A6 internal/winproc/process_windows.go internal/orchestrator/*.go
```
把等待时长改为常量：

```go
// winproc: WaitForSingleObject 的 INFINITE。旧写法把"无限"表达成 time.Duration
// 再转 uint32，得到 2147（毫秒）而非 INFINITE，看护线程每 2.1s 空转一次（B24）。
const infiniteWait = uint32(0xFFFFFFFF)
```
并把调用点 `procWaitForSingleObject.Call(h, uintptr(d))` 的 `d` 换成 `infiniteWait`（或该调用点本意就是超时的，保留显式超时并注释区分）。

- [ ] **Step 3: handle 必须等 watcher 退出后再关**

`cleanupProcLocked`（约 `:300`）里 `CloseHandle(o.procHandle)` 与 watcher goroutine 可能仍阻塞在同一 handle 上冲突。加同步：

```go
	// 只有 watcher 退出后才允许 CloseHandle：它可能正阻塞在 WaitForSingleObject(h) 上，
	// 关句柄会让等待立即以错误返回、或更糟地句柄值被复用（B24）。
	if o.watcherDone != nil {
		select {
		case <-o.watcherDone:
		case <-time.After(500 * time.Millisecond):
			o.log.Warn("watcher 未在 500ms 内退出，把 handle 移交 watcher 自行关闭")
			o.pendingHandle = o.procHandle
			o.procHandle = 0
			return nil // 不在此处 CloseHandle
		}
	}
```
watcher 退出路径末尾：

```go
		if o.pendingHandle != 0 {
			_ = windows.CloseHandle(windows.Handle(o.pendingHandle))
		}
		close(o.watcherDone)
```
Step 3b：`Orchestrator` 需要新增字段 `watcherDone chan struct{}`、`pendingHandle uintptr`；`startProcLocked` 里创建 `o.watcherDone = make(chan struct{})` 并在启动 watcher 前赋值。若现状 watcher 是 `os/exec` 的 `cmd.Wait()` 而非裸 `WaitForSingleObject`，**则不存在 handle 竞争，本 Step 改为只做 Step 2**，并把结论写进注释。先读再改。

- [ ] **Step 4: 手工验证（无法自动化）**

```bash
cd app && go build -o build/bin/Index-VT.exe . && ./build/bin/Index-VT.exe
# 反复「启动翻译 → 立即取消 → 停止模型」10 次；观察无 panic、无 llama-server 残留
```

- [ ] **Step 5: 运行 + Commit**

```bash
cd app && go build ./... && go vet ./... && go test ./...
git add app/internal/winproc/ app/internal/orchestrator/
git commit -m "fix(winproc): bounds-check command buffer, real INFINITE, safe handle lifetime"
```

---

## Task 1.14: 子进程优雅停止路径不可达（`CREATE_NO_WINDOW`）

**Files:**
- Modify: `app/internal/orchestrator/spawn_windows.go:60-96`、`app/internal/winproc/console_windows.go:25-70`

**Interfaces:**
- Consumes: `winproc.SendCtrlBreak(pid uint32) error`（既有）
- Produces: `stopProcLocked` 签名不变，但 CTRL_BREAK 路径真正可达

**根因（已核实）**：`spawn_windows.go:85-89` 用 `CREATE_NO_WINDOW` → 子进程**没有控制台** → `GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, pid)` 必然失败 → 每次停止/空闲卸载都退化为等 `~3.3s` 后 `TerminateProcess`。另外子进程是在 `CreateProcess` **之后**才 `AssignProcessToJobObject`，存在崩溃时留孤儿的窗口期。

- [ ] **Step 1: 确认走的是裸 Win32 还是 Go `exec.Cmd`**

```bash
cd app && sed -n '1,96p' internal/orchestrator/spawn_windows.go
```
这决定 Step 2 用哪个方案。**不得凭猜测把 `exec.Cmd` 改写成未验证的 `CreateProcess` 序列。**

- [ ] **Step 2A: 若是裸 `CreateProcess`**

```go
	// CREATE_NEW_CONSOLE + SW_HIDE：子进程获得自己的（隐藏）控制台，CTRL_BREAK 才可达。
	// 旧写法 CREATE_NO_WINDOW 让优雅停止路径永久不可达（B24）。
	si.ShowWindow = windows.SW_HIDE
	flags := uintptr(windows.CREATE_NEW_CONSOLE | windows.CREATE_SUSPENDED)
	// CreateProcess 成功后、ResumeThread 之前加入 job，消除"崩溃即孤儿"窗口期
	if err := job.Assign(proc); err != nil {
		windows.TerminateProcess(proc, 1)
		return err
	}
	windows.ResumeThread(thread)
```

- [ ] **Step 2B: 若是 Go `exec.Cmd`**

```go
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NEW_CONSOLE, // CTRL_BREAK 可达的必要条件（B24）
		HideWindow:    true,
	}
```
并在注释中写明残余风险：`exec.Cmd` 拿不到 `CREATE_SUSPENDED` 时机，job 分配仍是「Start 后 Assign」，孤儿窗口期无法在此方案下消除。**不要为消除该窗口期临时手写 CreateProcess** —— 那是独立的重构决定，需单独评估。

- [ ] **Step 3: 移除全局信号吞没**

```bash
cd app && sed -n '20,70p' internal/winproc/console_windows.go
```
若存在 `signal.Ignore(os.Interrupt, syscall.SIGTERM)` 且从不恢复 → 它会在整个应用生命周期内吞掉 SIGINT/SIGTERM。改为：只在 AttachConsole 期间需要时注册 handler，或在 `cleanupProcLocked` 之后恢复默认。若该 Ignore 是**故意**的（避免 Ctrl+Break 从父控制台波及本进程），保留并补注释说明意图 —— **两种情况都要写明，不能留成谜**。

- [ ] **Step 4: 手工验证（必做，无法自动化）**

```bash
cd app && go build -o build/bin/Index-VT.exe .
./build/bin/Index-VT.exe   # 触发一次翻译，等待空闲卸载或手动退出
grep -i "ctrl_break\|graceful\|terminate" ../logs/indexvt-*.log
tasklist | grep -i llama
```
Expected: 日志出现优雅停止成功；**不得**出现 `TerminateProcess`/`force kill`。若仍走强杀 → 控制台仍不可达，换用 Step 2 的另一方案再验。

- [ ] **Step 5: Commit**

```bash
git add app/internal/orchestrator/ app/internal/winproc/console_windows.go
git commit -m "fix(winproc): give llama-server a hidden console so CTRL_BREAK graceful stop works"
```

---

## Task 1.15: `envprobe` 每轮 spawn / 无超时 / PATH 相对命令

**Files:**
- Modify: `app/internal/envprobe/envprobe.go`（`QueryVRAM`、`Probe`、`:95-105` 的 no-op 分支）
- Test: `app/internal/envprobe/envprobe_test.go`（新建）

**Interfaces:**
- Produces: `envprobe.QueryVRAMCached(ttl time.Duration) (GPU, error)`；包内 `runWithTimeout(timeout time.Duration, name string, args ...string) ([]byte, error)`（ctx 在函数内部派生，不从外部传入）

**根因**：① `exec.Command("nvidia-smi")` 按 PATH/cwd 解析可执行文件；② 无超时 → `nvidia-smi` 挂住即永久阻塞绑定；③ `GetSystemStatus`（`app.go:483`）在**每次 5s 轮询**都调 `QueryVRAM()` → 每轮 spawn 一个进程。

- [ ] **Step 1: 读现状**

```bash
cd app && sed -n '35,110p' internal/envprobe/envprobe.go
cd app && grep -n "QueryVRAM\|SweepResiduals" internal/envprobe/envprobe.go app/*.go
```

- [ ] **Step 2: 绝对路径 + 超时**

```go
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
```
`QueryVRAM` 内的 `exec.Command("nvidia-smi", …)` 与 `exec.Command("reg", …)`（约 `:158`、`:180`）改为 `runWithTimeout(2*time.Second, "nvidia-smi", …)` / `runWithTimeout(1*time.Second, "reg", …)`。

- [ ] **Step 3: TTL 缓存**

```go
type vramCache struct {
	mu       sync.Mutex
	at       time.Time
	val      GPU
	hasValue bool
}

var vramCacheState vramCache

// QueryVRAMCached 供状态栏 5s 轮询使用：命中缓存则不 spawn 进程（B25）。
func QueryVRAMCached(ttl time.Duration) (GPU, error) {
	c := &vramCacheState
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hasValue && !c.at.IsZero() && time.Since(c.at) < ttl {
		return c.val, nil
	}
	g, err := QueryVRAM()
	if err != nil {
		return GPU{}, err
	}
	c.at, c.val, c.hasValue = time.Now(), g, true
	return g, nil
}
```
`app.go:483` 的 `envprobe.QueryVRAM()` → `envprobe.QueryVRAMCached(5 * time.Second)`。`Probe()`（引导页，一次性）保持直调 `QueryVRAM`。

- [ ] **Step 4: 写测试**

```go
package envprobe

import (
	"testing"
	"time"
)

func TestRunWithTimeoutFailsFast(t *testing.T) {
	// 1ns 超时：无论命令是什么都必须返回错误（LookPath 失败也是错误）
	if _, err := runWithTimeout(1*time.Nanosecond, "cmd", "/c", "ping -n 6 127.0.0.1 >nul"); err == nil {
		t.Fatal("极短超时下应返回错误")
	}
}

func TestQueryVRAMCachedAvoidsRespawn(t *testing.T) {
	g1, err1 := QueryVRAMCached(time.Hour)
	g2, err2 := QueryVRAMCached(time.Hour)
	if err1 != nil || err2 != nil {
		t.Skipf("本机无 nvidia-smi，缓存路径无法验证: %v/%v", err1, err2)
	}
	if g1.TotalMB != g2.TotalMB {
		t.Fatalf("第二次调用未命中缓存（%d vs %d）", g1.TotalMB, g2.TotalMB)
	}
}
```
Step 4b：`GPU` 的字段名（`TotalMB`/`UsedMB`）以 Step 1 读到的为准。无 GPU 的机器上第二个测试 `t.Skip` 而非 fail —— 这是环境依赖测试，如实标注。

- [ ] **Step 5: 处理 `:99` 的 no-op 分支**

读 Step 1 输出，确认那条注释/分支有无副作用：无 → 删除；有 → 保留并补注释说明它做什么。**不得凭猜测删。**

- [ ] **Step 6: 运行 + Commit**

```bash
cd app && go test ./internal/envprobe/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/envprobe/ app/app.go
git commit -m "fix(envprobe): absolute-path lookup, timeout, TTL cache for status polling"
```

---

## Task 1.16: 字幕保真（ASS `\N` / SSA Format 行 / 编码识别 / LRC）

**Files:**
- Modify: `app/internal/subtitle/astisub.go`（解析取文本处、序列化写 Dialogue 处、`patchASSHeaders`）、`encoding.go`、`lrc.go`
- Test: 扩展 `app/internal/subtitle/roundtrip_test.go`

**Interfaces:**
- Produces: 行为变更，签名不变

- [ ] **Step 1: 读真实函数名**

```bash
cd app && grep -n "^func " internal/subtitle/astisub.go internal/subtitle/encoding.go internal/subtitle/lrc.go
sed -n '70,150p' internal/subtitle/astisub.go
sed -n '240,295p' internal/subtitle/astisub.go
```
`parseASS`/`serializeASS`/`detectEncoding` 在本文档中是占位称呼 —— **Step 2 的测试必须改成 Step 1 读到的真实函数名与签名。**

- [ ] **Step 2: 写失败测试**（追加到 `roundtrip_test.go`，函数名按 Step 1 替换）

```go
func TestASSMultilineRoundtrip(t *testing.T) {
	// ASS 用 \N 表示换行；解析侧必须转成真实换行，否则 textToLines 按 \n 切分
	// 会把整段当成一行送翻，多行 cue 的译文与换行位置都会错（B26）。
	doc := mustParseASS(t, dialogueText(`第一行\N第二行`))
	if n := strings.Count(doc.Cues[0].Original, "\n"); n != 1 {
		t.Fatalf(`ASS \N 未转成换行：Original=%q`, doc.Cues[0].Original)
	}
	out := mustSerializeASS(t, doc, ExportOptions{Format: FormatASS, Bilingual: BilingualTranslationOnly})
	if !strings.Contains(out, `第一行\N第二行`) {
		t.Fatalf("序列化未还原 \\N：%s", out)
	}
}

func TestSSAFormatLinePreserved(t *testing.T) {
	// v4.00 SSA 的 [V4 Styles] 与 Format 字段数必须原样保留；
	// 强推 V4+ 的 23 字段 Format 会让播放器解析错位。
	src := "[Script Info]\nScriptType: v4.00\n\n[V4 Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Marked, Start, End, Style, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,文本\n"
	doc := mustParseASSRaw(t, src)
	out := mustSerializeASS(t, doc, ExportOptions{Format: FormatASS})
	if strings.Contains(out, "v4.00+") {
		t.Fatalf("v4.00 SSA 被升级成 V4+：%s", out)
	}
	if !strings.Contains(out, "Format: Marked, Start, End, Style, Text") {
		t.Fatalf("原 Format 行未保留：%s", out)
	}
}

func TestDetectEncodingBOMOrder(t *testing.T) {
	cases := []struct {
		name string
		raw  []byte
		want string
	}{
		{"utf16be", []byte{0xFE, 0xFF, 0x00, '1'}, "utf-16be"},
		{"utf32le", []byte{0xFF, 0xFE, 0x00, 0x00}, "utf-32le"}, // 必须早于 UTF-16LE 判定
		{"utf16le", []byte{0xFF, 0xFE, '1', 0x00}, "utf-16le"},
		{"utf8bom", append([]byte{0xEF, 0xBB, 0xBF}, []byte("1")...), "utf-8"},
	}
	for _, c := range cases {
		if got := detectEncodingForTest(c.raw); got != c.want {
			t.Errorf("%s: 得到 %q，期望 %q", c.name, got, c.want)
		}
	}
}

func TestLRCClampsNegativeStart(t *testing.T) {
	doc := mustParseLRC(t, "[offset:-5000]\n[00:01.00]第一句\n")
	if doc.Cues[0].StartMs != 0 {
		t.Fatalf("负时间戳未钳制：%d（应为 0）", doc.Cues[0].StartMs)
	}
}
```

- [ ] **Step 3: 运行，确认失败**

Run: `cd app && go test ./internal/subtitle/ -count=1`
Expected: 多条 FAIL（编译期缺 helper 的先按 Step 1 的真实 API 补齐 `mustParseASS` 等小 helper —— 它们是测试夹具，允许新增）

- [ ] **Step 4: `\N` 双向转换**

解析侧（Step 1 定位到的取文本处）：

```go
			// ASS 换行标记转真实换行；解析与序列化必须严格互逆（B26）
			text = strings.ReplaceAll(text, `\N`, "\n")
			text = strings.ReplaceAll(text, `\n`, "\n")
			text = strings.ReplaceAll(text, `\h`, " ") // 硬空格
```
序列化侧（写 Dialogue 文本前）：

```go
	outText := strings.ReplaceAll(text, "\n", `\N`)
```

- [ ] **Step 5: `patchASSHeaders` 保留原 Format / ScriptType**

把「无条件写 V4+ 23 字段 `Format:`」改为：优先回写 `doc.EventsLines` / `doc.HeaderLines` 里读到的原始行；仅当它们缺失（新建文档）才生成默认。`ScriptType` 同理保持原值。

- [ ] **Step 6: 编码识别按 BOM 长度优先**

```go
	switch {
	case len(b) >= 4 && b[0] == 0xFF && b[1] == 0xFE && b[2] == 0 && b[3] == 0:
		return "utf-32le" // 必须早于 UTF-16LE：两者前两字节相同（B27）
	case len(b) >= 2 && b[0] == 0xFE && b[1] == 0xFF:
		return "utf-16be" // 旧实现完全漏掉 BE，被当 GBK 解码
	case len(b) >= 2 && b[0] == 0xFF && b[1] == 0xFE:
		return "utf-16le"
	case len(b) >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF:
		return "utf-8"
	}
```
Step 6b：确认返回的编码字符串与 `decode()` 分支里用的常量集一致（`encoding.go` 里应有一张 名称→decoder 表）；新增 `utf-16be`/`utf-32le` 必须同时加解码分支，否则识别出来却解不了。

- [ ] **Step 7: LRC 钳制 + 双语真正分支**

```go
	if startMs < 0 {
		startMs = 0 // offset 可为负，但导出不得产出负时间戳（B28）
	}
```
`serializeLRC`（`:102`）外层条件恒真 → 改为按 `opt.Bilingual` 真分支：`BilingualDualLine` 输出 `原文\n译文`，`BilingualTranslationOnly` 仅译文，`BilingualKeepOriginal` 走原文。

- [ ] **Step 8: 运行 + Commit**

```bash
cd app && go test ./internal/subtitle/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/subtitle/
git commit -m "fix(subtitle): ASS \\N roundtrip, preserve SSA format lines, BOM order, LRC edges"
```

---

## Task 1.17: 引擎内存与并发（读取上限 / 快照 / LRU 淘汰）

**Files:**
- Modify: `app/internal/subtitle/engine.go`（`Open`、`GetDoc`、`Export`/`serialize`、`docs` 记账）
- Test: `cueevent_test.go`（追加）

**Interfaces:**
- Produces: `const MaxSubtitleBytes = 32 << 20`、`(*Engine) snapshotLocked(doc *SubtitleDoc) *SubtitleDoc`

- [ ] **Step 1: 先量大小再读**

```go
// MaxSubtitleBytes 字幕文件大小上限（B29）：32MB 远超任何真实字幕文件，
// 用于拒绝误选的整本小说或二进制文件 —— 旧实现 os.ReadFile 会直接吃满内存。
const MaxSubtitleBytes = 32 << 20

func (e *Engine) Open(path string) (*SubtitleDoc, error) {
	st, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if st.Size() > MaxSubtitleBytes {
		return nil, fmt.Errorf("文件过大（%d 字节，上限 %d 字节），请确认选的是字幕文件", st.Size(), int64(MaxSubtitleBytes))
	}
	… // 原逻辑
```

- [ ] **Step 2: 持锁深拷贝快照**

```go
// snapshotLocked 在持有 e.mu 时返回与后续队列写入隔离的文档副本。
// Cue 的字段全是值类型/不可变 string，拷贝切片即足够；Styles/HeaderLines 同样浅拷贝安全。
func (e *Engine) snapshotLocked(doc *SubtitleDoc) *SubtitleDoc {
	cues := make([]Cue, len(doc.Cues))
	copy(cues, doc.Cues)
	out := *doc
	out.Cues = cues
	if len(doc.Styles) > 0 {
		out.Styles = append([]StyleDef(nil), doc.Styles...)
	}
	return &out
}
```
`Open` 返回值、`GetDoc`、`Export`/`serialize`/`ExportToBytes` 的入口一律改为「持 `e.mu` 取快照 → 解锁 → 再序列化」，消除 `engine.go:183/228` 的无锁快照与 `queue.go` 写入的竞争。

- [ ] **Step 3: LRU 淘汰（上限 8 篇）**

```go
const maxRetainedDocs = 8

// touchLocked 维护最近使用顺序并在超限时淘汰最旧文档；调用方须持 e.mu。
// 不淘汰就意味着长时间使用时内存单调增长（B29）。
func (e *Engine) touchLocked(id string) {
	for i, s := range e.order {
		if s == id {
			e.order = append(e.order[:i], e.order[i+1:]...)
			break
		}
	}
	e.order = append(e.order, id)
	for len(e.order) > maxRetainedDocs {
		oldest := e.order[0]
		e.order = e.order[1:]
		if ctl, busy := e.queueCancel[oldest]; busy {
			ctl.cancel() // 正在跑的文档也超进了上限：宁可取消最旧的任务也不能无界增长
		}
		delete(e.docs, oldest)
	}
}
```
`Engine` 加 `order []string` 字段；`Open` 成功入 map 后、`GetDoc` 命中后调 `e.touchLocked(doc.ID)`。

- [ ] **Step 4: 写并发导出测试**

```go
// 队列进行中反复导出：修复前导出读的是与队列写同一块底层数组（无锁快照）。
// 注意：本测试只能捕获崩溃级竞争 —— -race 因 CGO_ENABLED=0 不可用，
// 覆盖存在局限，须在报告里如实说明。
func TestExportDuringQueueStaysConsistent(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) {
		return "T" + text, nil
	})
	doc := newDocForTest(500)
	e.mu.Lock()
	e.docs[doc.ID] = doc
	e.mu.Unlock()

	if err := e.TranslateQueue(doc.ID, QueueOptions{TargetLang: "zh"}, nil); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 30; i++ {
		if _, err := e.ExportToBytes(doc.ID, ExportOptions{Format: FormatSRT, Bilingual: BilingualTranslationOnly}); err != nil {
			t.Fatalf("第 %d 次导出失败: %v", i, err)
		}
	}
	waitQueueDone(t, e, doc.ID)
}

func TestDocsMapEvicted(t *testing.T) {
	e := NewEngine(func(ctx context.Context, text, src, dst string) (string, error) { return text, nil })
	for i := 0; i < maxRetainedDocs+5; i++ {
		d := newDocForTest(1)
		e.mu.Lock()
		d.ID = fmt.Sprintf("doc-%d", i)
		e.docs[d.ID] = d
		e.touchLocked(d.ID)
		e.mu.Unlock()
	}
	e.mu.Lock()
	n := len(e.docs)
	e.mu.Unlock()
	if n > maxRetainedDocs {
		t.Fatalf("未淘汰：保留 %d 篇，上限 %d", n, maxRetainedDocs)
	}
}
```
Step 4b：`fmt` import 补齐。`ExportToBytes` 的选项字段名以现状为准。

- [ ] **Step 5: 运行 + Commit**

```bash
cd app && go test ./internal/subtitle/ -count=1 && go build ./... && go vet ./... && go test ./...
git add app/internal/subtitle/
git commit -m "fix(subtitle): file size cap, locked snapshots, doc LRU eviction"
```

---

## Task 1.18: `Translate` 绑定应用生命周期 ctx

**Files:**
- Modify: `app/app.go:305-348`（`Translate` 的 goroutine）

**Interfaces:**
- Consumes: `a.ctx`（Wails 上下文，`startup` 赋值）
- Produces: 任务 ctx 受应用生命周期约束，退出即取消

**根因（已核实，修正初版归因）**：`app.go:307` 传 `context.Background()` → 任务**不可取消**。`translator.go` 里 `defer t.deps.OnTaskFinish(modelID)` 正常时没问题，但一旦 `llama-server` 挂死（连接不响应、推理卡住），`ChatStream` 永不返回 → defer 永不执行 → `activeTasks` 永久 >0 → **空闲卸载永不触发，显存一直被占**。这才是「挂死占位」的真实链路，与用户主动取消无关。

- [ ] **Step 1: 派生可取消 ctx**

```go
	go func() {
		start := time.Now()
		// 任务 ctx 必须受应用生命周期约束。旧写法 context.Background() 意味着
		// 挂死的推理请求永远无法被回收，activeTasks 永久 >0 → 空闲卸载永不触发（B23）。
		taskCtx, cancel := context.WithCancel(a.ctx)
		defer cancel()

		res, err := a.tr.Translate(taskCtx, translator.TranslateRequest{
			TaskID:     taskID,
			SourceLang: source,
			TargetLang: req.TargetLang,
			Text:       req.Text,
			Mode:       mode,
			Syllables:  req.Syllables,
			Constraints: &translator.Constraints{Glossary: glossary},
		}, func(delta string) { batcher.append(delta) })
		… // 其余保持不变
```
Step 1b：`a.ctx` 在 `startup` 中赋值且 `ensureReady()` 已保证非 nil（Task 1.7）。`shutdown` 时 `runtime.Quit` 触发的 ctx cancel 会传播到 `taskCtx` —— 验证方式见 Step 2。

- [ ] **Step 2: 手工验证挂死路径**

```bash
cd app && go build -o build/bin/Index-VT.exe . && ./build/bin/Index-VT.exe
# 1) 启动一次翻译  2) 立刻 taskkill /F /IM llama-server.exe（模拟挂死/崩溃）
# 3) 观察：任务应在秒级返回错误而不是永久转圈；状态栏 activeTasks 应归零
grep -n "推理请求失败\|已取消" ../logs/indexvt-*.log
```
Expected: 任务返回错误，倒计时/卸载逻辑恢复可触发。

- [ ] **Step 3: 回归 + Commit**

```bash
cd app && go build ./... && go vet ./... && go test ./...
git add app/app.go
git commit -m "fix(app): derive translate task context from app context so hangs are reclaimable"
```

---

## Task 1.19: Wails 窗口配置与关窗释放

**Files:**
- Modify: `app/main.go:84-105`、`app/app.go:642-662`（`PrepareExit` nil 防护）

**Interfaces:**
- Produces: `OnBeforeClose` 走 `PrepareExit`；`BackgroundColour` 与浅色 canvas 一致

- [ ] **Step 1: 核验 `options.App` 真实字段**

```bash
cd app && go doc github.com/wailsapp/wails/v2/pkg/options.App 2>&1 | head -40
```
确认 `BackgroundColour`、`OnBeforeClose` 的存在与签名（`OnBeforeClose options.BeforeCloseCallback` 形如 `func(ctx context.Context) bool`）。**以 `go doc` 输出为准，不照抄本文档。**

- [ ] **Step 2: 加 BackgroundColour + OnBeforeClose**

```go
	err = wails.Run(&options.App{
		Title:     appTitle,
		Width:     1280,
		Height:    800,
		MinWidth:  1180,
		MinHeight: 700,
		// 与 DESIGN.md §9 的浅色 --canvas 一致，消除深色主题下的启动白闪（B30）。
		BackgroundColour: &options.RGBA{R: 251, G: 251, B: 250, A: 255},
		AssetServer: &assetserver.Options{
			Handler: http.FileServer(http.FS(assets())),
		},
		OnStartup: func(ctx context.Context) { … },
		OnBeforeClose: func(ctx context.Context) (prevent bool) {
			// 点 X 关窗同样必须释放推理进程；否则 llama-server 成孤儿常驻显存。
			// prepare 失败也放行关闭 —— 不得把用户困在关不掉的窗口里。
			if err := app.PrepareExit(); err != nil {
				slog.Error("OnBeforeClose 中 PrepareExit 失败", "err", err)
			}
			return false
		},
		OnShutdown: func(ctx context.Context) { app.shutdown() },
		Bind:       []interface{}{app},
	})
```

- [ ] **Step 3: `PrepareExit` / `Quit` 的 nil 防护**

`app.go:642` 里 `a.log.Info` 在装配未完成时 `a.log == nil` → `Handler()` 无 nil 守卫 → panic；`Quit` 用 nil `a.ctx`：

```go
func (a *App) PrepareExit() error {
	log := a.log
	if log == nil {
		log = slog.Default() // 装配尚未完成时也要能记录退出意图
	}
	a.mu.Lock()
	if a.closing {
		a.mu.Unlock()
		return nil
	}
	a.closing = true
	orch := a.orch
	a.mu.Unlock()

	if orch == nil {
		return nil // 编排器还没起来，无可释放
	}
	log.Info("prepare exit: releasing resources")
	if err := orch.PrepareExit(); err != nil {
		log.Error("prepare exit failed", "err", err)
		return err
	}
	log.Info("prepare exit done")
	return nil
}

func (a *App) Quit() {
	if a.ctx == nil {
		return // OnStartup 前无 ctx，runtime.Quit 会 panic
	}
	runtime.Quit(a.ctx)
}
```

- [ ] **Step 4: 手工验证 + 回归 + Commit**

```bash
cd app && go build -o build/bin/Index-VT.exe . && ./build/bin/Index-VT.exe
# 启动后直接点窗口 X：验证 tasklist 中无 llama-server 残留、nvidia-smi 显存归零
cd app && go build ./... && go vet ./... && go test ./...
git add app/main.go app/app.go
git commit -m "fix(main): background colour + release inference on window close"
```

---

## Task 1.20: 日志包脱敏承诺（先验证事实再设计）

**Files:**
- Modify: `app/logs.go`
- Test: `app/logs_test.go`（新建）

**Interfaces:**
- Produces: `collectLogsZipInto(logsDir, outDir string) (string, error)`（从现有 `collectLogsZip` 抽出的可测入口）

**根因（待验证）**：`logs.go:50` 把 `logs/llama-server.out.log` 一起打进声称「脱敏」的包；llama-server 可能把提示词原文（含用户待翻译正文与术语表）写进该日志。**这一步必须先取得事实，不得凭猜测设计脱敏规则。**

- [ ] **Step 1: 用真实运行取得证据**

```bash
cd app && go build -o build/bin/Index-VT.exe . && ./build/bin/Index-VT.exe
# 在界面里翻译一句可识别的哨兵文本，例如："机密哨兵字符串 ZEBRA-42"
cd .. && grep -c "ZEBRA-42" logs/llama-server.out.log logs/indexvt-*.log
```
Expected: 取得**确切**的命中文件与次数。命中 → 执行 Step 2；两条都是 0 → 跳过 Step 2，只做 Step 3 的回归锁并在注释写明「已验证不含正文」。

- [ ] **Step 2: 默认排除推理日志**

```go
// llama-server.out.log 实测可能包含提示词原文（即用户待翻译正文与术语表），
// "脱敏"承诺不能靠"打了包再指望它干净"来兑现，故默认不打包（B31）。
// 需要推理侧日志时由用户显式指定，并在界面上单独提示其内容范围。
var logsExcludedFromBundle = map[string]bool{
	"llama-server.out.log": true,
}
```
在遍历日志目录处按 `filepath.Base(name)` 查这张表跳过；`CollectLogs` 的返回文案追加「未包含推理日志」。

- [ ] **Step 3: 写回归测试**

```go
package main

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestCollectLogsExcludesInferenceLog(t *testing.T) {
	if len(logsExcludedFromBundle) == 0 {
		t.Skip("Step 1 已验证推理日志不含正文，未启用排除规则")
	}
	logsDir := t.TempDir()
	outDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(logsDir, "llama-server.out.log"),
		[]byte("用户待翻译正文：机密哨兵字符串 ZEBRA-42"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(logsDir, "indexvt-20261004.log"),
		[]byte("普通运行日志 无正文"), 0o644); err != nil {
		t.Fatal(err)
	}

	zipPath, err := collectLogsZipInto(logsDir, outDir)
	if err != nil {
		t.Fatal(err)
	}
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()

	foundRuntimeLog := false
	for _, f := range r.File {
		if filepath.Base(f.Name) == "llama-server.out.log" {
			t.Fatal("推理日志被打包，脱敏承诺失效")
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if bytes.Contains(b, []byte("ZEBRA-42")) {
			t.Fatalf("%s 内含用户正文", f.Name)
		}
		if filepath.Base(f.Name) == "indexvt-20261004.log" {
			foundRuntimeLog = true
		}
	}
	if !foundRuntimeLog {
		t.Fatal("普通日志也没打包进去，排除逻辑写错了")
	}
}
```
Step 3b：`collectLogsZip` 现在硬编码 `paths.LogsDir()` 与输出位置 → 抽 `collectLogsZipInto(logsDir, outDir string) (string, error)`，原函数变成 `collectLogsZipInto(paths.LogsDir(), paths.LogsDir())` 的薄封装。这是为可测性的最小重构，可接受。

- [ ] **Step 4: 运行 + Commit**

```bash
cd app && go test -run TestCollectLogs -count=1 . && go build ./... && go vet ./... && go test ./...
git add app/logs.go app/logs_test.go
git commit -m "fix(logs): exclude inference log from bundled zip to honour redaction claim"
```

---

## 完成判据（整条 Track A）

**自动验证**（必须逐条贴出真实输出，不接受「应该没问题」）：
```bash
cd app && go build ./...          # exit 0
cd app && go vet ./...            # 0 warning
cd app && go test ./...           # 全绿，含本计划新增的 14 个测试文件
cd app && go test -count=3 ./internal/subtitle/ ./internal/modelmanager/ ./internal/orchestrator/ ./internal/store/ ./internal/translator/ ./internal/paths/ ./internal/csvsanitizer/ .
```

**手工验证**（Playwright 覆盖不到 Win32 进程/显存行为，必须在真实 exe 上做）：
1. 热切换模型（普通 ↔ 配音）10 次 → 无 panic（Task 1.1）
2. 空闲卸载进行中立即提交新任务 → 秒级返回而非永久转圈（Task 1.2）
3. 停止/卸载时 `grep` 日志确认走 CTRL_BREAK 优雅路径，无 `TerminateProcess`（Task 1.14）
4. 取消翻译 → 已流出文本仍在；连续取消 5 次第 6 次仍正常（Task 1.4）
5. `taskkill /F llama-server` 模拟挂死 → 任务秒级失败、`activeTasks` 归零（Task 1.18）
6. 点窗口 X → `tasklist` 无 `llama-server` 残留、`nvidia-smi` 显存归零（Task 1.19）
7. 哨兵文本验证日志包内容（Task 1.20）

**诚实声明**：本 Track 的竞态类修复（1.2 / 1.3 / 1.7 / 1.9 / 1.17）**无法用 race detector 验证** —— `CGO_ENABLED=0` 下 `go test -race` 不可运行。交付报告只能写「确定性并发测试通过 N 轮 + 手工场景验证」，不得写「已用 race detector 验证」。
