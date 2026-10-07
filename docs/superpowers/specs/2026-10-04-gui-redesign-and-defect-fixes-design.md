# 设计 spec — Index-VT「素笺」GUI 重构与缺陷修复

| | |
|---|---|
| **日期** | 2026-10-04 |
| **状态** | 待用户审阅（brainstorming 架构路径产物） |
| **上游** | `spark-output/prd/sujian-gui-redesign.md`（需求与验收）· `docs/03-GUI设计图/DESIGN.md`（视觉契约）· `spark-output/context/motion-plan.json`（动效契约） |
| **下游** | 本文件获批后 → `writing-plans` skill 产出实施计划 |
| **本文职责** | 架构、模块边界、后端契约变更、数据流、错误处理、并发不变量、测试策略、交付顺序。**不重复** DESIGN.md 的 token 与 PRD 的验收标准 |

---

## 1. 目标与非目标

**目标**：把「后端已有能力」与「用户可见界面」对齐，同时消除会崩溃/丢数据/破安全边界的缺陷；视觉与交互按 `DESIGN.md`（素笺 · 浅色基准 + 深色同套 token · Premium 动效）重建。

**非目标**：不新增产品能力（cue 编辑、长文档翻译、实时翻译、托盘、样式面板一律不做）；不换技术栈；不做跨平台；不改 SQLite schema（除非 S4 的事务改造必须迁移，届时走 `user_version` 并同时修掉 `store.go:49` 的建表跳过问题）；**不引入新的运行时前端依赖**（`dependencies` 保持现状：react / react-dom / zustand / lucide-react。devDependencies 的唯一候选是 axe-core，用于 a11y 验收，不进产物——见 §10.1）。

---

## 2. 取证修正记录

初版后端审计报告有两条结论经复核**不成立**，已在本 spec 与 PRD 中修正，记录在此以免后续再次误传：

| 初版结论 | 复核结果 | 证据 |
|---|---|---|
| 「字幕队列取消会丢弃已翻译条目」 | **不成立**。取消路径（`ctx.Err() != nil` → `return`）不会回滚已写入的 `cue.Translated`；已完成的译文保留在后端文档中 | `queue.go:116,124,133` |
| 「`CueProgress` 不含 `DocID`，前端 `p.docId` 永远 undefined」 | **不成立**。`emit` 闭包统一填充 `DocID`/`Total`/`Done` | `queue.go:73-75` |

真正成立的字幕侧缺陷是：① `CueProgress` **无 `Translated` 字段** → 前端译文列永远为空；② `engine.GetDoc` **未绑定** → 前端无法回拉权威结果；③ `done++`（`:145`）在 `emit`（`:142`）之后 → 计数 off-by-one；④ `:139-144` 解锁后读 `cue` 字段 → 数据竞争；⑤ `RetryCues`（`:253`）先清空 `Translated` 再重译 → 重译失败即永久丢失原译文；⑥ `emit` 节流（`:69-71`）直接丢弃非终态事件 → 行可能看起来卡在 `pending`。

> **流程结论**：后端缺陷清单在写进实施计划前，逐条回到源码复核 file:line，不直接采信审计报告。

---

## 3. 架构

### 3.1 前端目录结构（新）

```
frontend/src/
├── main.tsx                    # 挂载；主题预应用（防白闪）
├── App.tsx                     # 外壳：Rail + 路由 + StatusBar + 浮层层 + 全局快捷键
├── theme/
│   ├── tokens.css              # 语义 token：:root(light) / [data-theme=dark] / @theme 映射
│   ├── base.css                # reset、focus-visible、滚动条、reduced-motion 单一降级块
│   └── theme.ts                # applyTheme(mode) + prefers-color-scheme 监听
├── lib/
│   ├── wails.ts                # 类型化绑定层 + 事件多路分发器（唯一订阅点）
│   ├── errors.ts               # Go error → 类型化 AppError 映射 + 分类
│   ├── shortcuts.ts            # 全局快捷键注册表（含 Ctrl+K 面板）
│   ├── virtualizer.ts          # ~40 行窗口化（仅 DataTable 用）
│   └── format.ts               # 时间码/字节/速率格式化（tabular-nums 配套）
├── stores/
│   ├── appStore.ts             # status / config / orchState（只读快照 + 轮询）
│   ├── jobStore.ts             # 翻译与字幕任务生命周期（跨页存活）
│   └── glossaryStore.ts        # 术语本与词条
├── components/
│   ├── ui/                     # 原语库（见 3.2）
│   ├── shell/                  # Rail / StatusBar / AppSurface
│   ├── translate/              # DualPane / LangBar / DubbingBar / ConstraintDrawer
│   ├── subtitle/               # CueTable / QueueToolbar / CueDetail
│   ├── model/                  # ModelCard / VramGauge / SourceBar / UnknownModels
│   └── CommandPalette.tsx
└── pages/
    ├── Translate.tsx  Subtitles.tsx  Models.tsx  Glossary.tsx  Settings.tsx  Onboarding.tsx
```

**边界规则**：`pages/` 只做组合与布局，不含业务逻辑；业务逻辑在 `stores/`；只有 `lib/wails.ts` 能碰 `window.go` / `window.runtime`；只有 `components/ui/` 能引用 token utility 之外的样式原语。

### 3.2 模块边界（做什么 / 怎么用 / 依赖什么）

| 单元 | 做什么 | 怎么用 | 依赖 |
|---|---|---|---|
| `lib/wails.ts` | 绑定调用 + **事件单点订阅与多路分发** | `call<T>('Method', ...args)`；`on(name, handler) → unsubscribe` | `window.go` / `window.runtime` |
| `lib/errors.ts` | 把 Go 侧字符串错误映射为 `{kind, message, retryable, logHint}` | `toAppError(e)` | — |
| `stores/jobStore.ts` | 持有 `translateJobs` / `subtitleQueues` 的状态机，消费事件并归约 | `useJobStore(sel)`；`startTranslate()` / `cancel()` | `lib/wails` |
| `stores/appStore.ts` | status/config/orchState 快照 + 5s 轮询兜底 | `useAppStore(sel)` | `lib/wails` |
| `components/ui/*` | 视觉与 a11y 原语，**无业务语义** | 见 DESIGN.md §5 | `theme/tokens.css` |
| `components/ui/DataTable.tsx` | 虚拟化表格 + 选择 + 排序 + 行内操作 | `<DataTable columns rows rowKey selectable virtual/>` | `lib/virtualizer` |
| `pages/*` | 组合原语与 store，落地 DESIGN.md §6.3 的每屏布局 | 路由渲染 | `stores`、`components` |

**原语清单**（`components/ui/`）：`Button` `IconButton` `Badge` `Segmented` `Switch` `Checkbox` `Field` `Textarea` `NumberField` `Slider` `LangPicker` `Surface` `DataTable` `Drawer` `Modal` `Popover` `Toast` `Tooltip` `Progress` `EmptyState` `Skeleton` `Kbd` `Spinner`。共 23 个；每个都必须是真实语义元素 + `:focus-visible` 焦点环 + 完整 TS props 类型。

### 3.3 后端契约变更（精确清单）

只加不改语义，除标注外全部向后兼容：

| # | 变更 | 位置 | 理由 |
|---|---|---|---|
| B1 | `CueProgress` 增加 `Translated string \`json:"translated,omitempty"\`` | `internal/subtitle/engine.go:93-101` | S3：译文进不了表格的根因 |
| B2 | 终态 emit 带上译文；`done++` 移到 `emit` **之前** | `internal/subtitle/queue.go:142-145` | B1 配套 + 修 off-by-one |
| B3 | 新增绑定 `SubGetDoc(docID string) (*subtitle.SubtitleDoc, error)`（含 `ensureReady`） | `app/app.go` 字幕组 | 事件丢包时的权威兜底；`emit` 节流会丢弃非终态事件 |
| B4 | `emit` 节流改为**合并而非丢弃**：暂存最新一条非终态事件，到点再发 | `queue.go:64-77` | 修「行看起来卡在 pending」 |
| B5 | `RetryCues` 不再预先清空 `Translated`；改为重译成功后覆盖 | `queue.go:249-256` | 修重译失败丢原译文 |
| B6 | `TranslateQueue` 结束时调用 `cancel()` | `queue.go:37,56-60` | context 泄漏 |
| B7 | `:139-144` 的字段读取移入 `e.mu` 临界区（先在锁内拷出值，再解锁 emit） | `queue.go:127-145` | 数据竞争 |
| B8 | `App` 增加 `cfgMu sync.RWMutex`；所有 `a.cfg` 读写走 `cfgSnapshot()` / `withCfg(func(*config.Config))` | `app/app.go:33-45,220-227,444-454,508-518` | P0-5：无锁共享结构体 |
| B9 | `SetActiveModel` 改为锁内 read-modify-write（不整体覆盖 cfg） | `app/app.go:444-454` | 与 `SetConfig` 互相覆盖 |
| B10 | `deltaBatcher.close()` 用 `sync.Once` 保护 | `app/app.go:101-104` | P0-1：双重 close panic |
| B11 | 所有缺门禁的绑定补 `ensureReady()`（PRD S9 列出的 20 余处）；`startup` 内回调改为**惰性解引用**（回调触发时 `a.tr/a.sub/a.models` 才取值） | `app/app.go` | nil 解引用 |
| B12 | `orchestrator.setState` 内 `o.cond.Broadcast()` | `internal/orchestrator/orchestrator.go` | P0-3：`cond.Wait()` 永不唤醒 |
| B13 | `modelmanager.List()` 不在持 `m.mu` 时调用 `m.orch.*`（先取快照再查编排态） | `internal/modelmanager/manager.go:245-253` | P0-4：AB-BA 死锁 |
| B14 | `winproc.CommandLine`：`retLen < dataOff` 直接返回错误 | `internal/winproc/process_windows.go:82-88` | P0-6：越界读 → 启动即崩 |
| B15 | 单实例锁只把 `ERROR_ALREADY_EXISTS` 当「已有实例」，其他错误照常启动 | `app/main.go:58-67` | P0-7：fail-closed 起不来 |
| B16 | `DeleteModel` 校验 quant，未命中返回错误（不 `Join` 出目录本身） | `internal/modelmanager/manager.go:482` | P0-9：误删 models 目录 |
| B17 | `AssignUnknown` 归拢校验：路径必须在 `models/` 内 + `.gguf` 后缀 + 调用 `sanitizeGGUFPath` | `manager.go:454-470`、`orchestrator/args.go:59` | P0-10：任意文件移动 |
| B18 | 下载完整性 fail-closed；无 `Content-Length` 时按已下载字节硬上限熔断；`isAllowedURL` 仅 `https` | `internal/modelmanager/download.go:63,392,403-410` | P0-11 |
| B19 | `ExportGlossaryCSV` 中和 `=` `+` `-` `@` 与 tab 前缀 | `app/app.go:406-409` | P0-12：CSV 公式注入 |
| B20 | `SaveGlossary` 包进单个事务 | `internal/store/store.go:289-317` | 中途失败清空整本术语 |
| B21 | `ListHistory` 的 offset 计算做下界与溢出保护 | `store.go:166` | 负 OFFSET |
| B22 | `sse.go`：① 取消/出错时也返回已累积文本（`result.Text` 在循环内增量赋值，不再只在 `:261` 循环后赋值）；② `eventBuf`（`:245`）加上限 1MB，超限返回明确错误而非无限增长；③ `Timeout: 0`（`:122`）改为**首字节超时 60s**（覆盖模型唤醒约 10s + 排队），整体不设硬超时（长文本 CPU 推理可能很久），靠 B23 的可取消 ctx 兜底 | `internal/translator/sse.go:122,243,245,261` | P0-2 + 丢文本 + 挂死任务永久占住 `activeTasks` |
| B23 | `Translate` 用受应用生命周期约束的 ctx（派生自 `a.ctx`，可取消），不再 `context.Background()` | `app/app.go:307` | 挂死任务永久占住 `activeTasks` |
| B24 | `spawn_windows.go`：改 `CREATE_SUSPENDED` 后加入 job 再恢复；`watchInfinite` 传正确的 `windows.INFINITE`；`cleanupProcLocked` 不在 watcher 仍持有 handle 时关闭它 | `internal/orchestrator/spawn_windows.go`、`internal/winproc/process_windows.go:300,449` | 孤儿进程 + 2147ms 假 INFINITE + handle use-after-close |
| B25 | `QueryVRAM` 加超时 + 结果缓存（TTL ≥ 轮询间隔），`exec.Command` 用绝对路径解析 `nvidia-smi` | `internal/envprobe/envprobe.go:49-55,158,180` | 每 5s spawn 进程；挂住即永久阻塞绑定 |
| B26 | `astisub` 解析/序列化两侧统一处理 `\N` ↔ `\n`；`patchASSHeaders` 保留原 `Format:` 字段数（不强制 V4+ 23 字段） | `internal/subtitle/astisub.go:77,246,278` | 多行 ASS cue 误译；v4.00 SSA 被破坏 |
| B27 | `encoding.go` 补 UTF-16 BE；UTF-32 LE BOM 不再误判为 UTF-16 | `internal/subtitle/encoding.go:18` | 误判为 GBK |
| B28 | `lrc.go`：`startMs` 负值钳到 0；`serializeLRC` 真正按双语模式分支 | `internal/subtitle/lrc.go:76,102` | 负时间戳；双语模式被忽略 |
| B29 | `engine.Open` 加文件大小上限（32MB，错误信息含上限值）；`docs` map 加 LRU 淘汰（上限 8 篇） | `internal/subtitle/engine.go:127-175` | 无上限读文件；map 永不淘汰 |
| B30 | `main.go` 设 `options.App.BackgroundColour`（取浅色 canvas `#FBFBFA`）；`OnBeforeClose` 走 `PrepareExit` | `app/main.go:84-105` | 深色主题启动白闪；关窗时未释放资源 |
| B31 | `CollectLogs` 验证并处理 `logs/llama-server.out.log`（若含提示词原文则默认不打包，或做脱敏） | `app/logs.go:50` | R-6 隐私承诺 |
| B32 | `tsconfig.json` 打开 `noUnusedLocals` + `noUnusedParameters` | `frontend/tsconfig.json` | DESIGN.md §10 漂移防线（现状均为 `false`） |

**不做的后端变更**（明确记录，避免范围蔓延）：不加 cue 编辑 API；不加 `DocTranslate` 实现；不清理 `ImportGGUF` / `docpipeline` / `paths.PartDir` / `textBytes` 死代码（`sanitizeGGUFPath` 例外，见 B17）；不改 SQLite schema。

---

## 4. 数据流

```
Go 后端 ──EventsEmit──> window.runtime.EventsOn(name, dispatcher)
                              │  （lib/wails.ts：每个事件名只注册一次）
                              ├─> 本地 handler 集合（Map<name, Set<handler>>）
                              │      退订只从 Set 里删自己；Set 空时才 EventsOff(name)
                              ▼
                    stores（jobStore / appStore / glossaryStore）
                              │  归约为不可变状态；组件只订阅派生选择器
                              ▼
                        components / pages
```

**为什么必须改**：现状 `wailsapi.ts:30` 的退订直接调 `runtime.EventsOff(name)`，会摘掉该事件名的**全部**订阅者。`model:progress` 同时被 `Onboarding.tsx:42`、`ModelHub.tsx:45`、`appStore.ts:65` 订阅 —— 任一组件卸载即静默打断其余两处。

**任务生命周期（jobStore）**：

```
translate: idle → pending(taskId 未知) → streaming → done | error | canceled
subtitle : idle → running → paused → running → done | partial-failed | canceled | error
```

- **早到事件缓冲**：后端 `Translate` 同步返回 `taskId`（`app.go:349`），但翻译 goroutine 可能在 JS 侧收到该 id **之前**就已 emit delta。`lib/wails.ts` 因此维护一个 `Map<taskId, buffered[]>` 的短生命周期缓冲（TTL 5s，上限 256 条），job 注册 taskId 时立即 flush 并按序归并。
  - 不用「单一活跃任务」模型：那样无法归属并发任务的 delta，也无法支持字幕队列与主翻译同时进行。
  - **这是现状丢字符的根因之一**：`MainTranslate.tsx:64-93` 的订阅以 `taskId` 为 effect 依赖，重注册窗口内的 delta 落到已卸载的 handler 上，直接丢失。
- 任务态存 store 而非组件 → 切页不中断、不丢输出。
- 状态栏订阅 `jobStore` 显示常驻任务条（有进行中任务时）。

**轮询与事件的分工**：事件驱动为主；`appStore` 的 5s 轮询**只**用于空闲倒计时与 VRAM 这类无事件的量，且 `model:progress` 不再触发 `refreshStatus()`（现状每个下载 chunk 都触发一次全量状态查询 → 事件风暴）。

---

## 5. 错误处理策略

三层，各层职责不重叠：

| 层 | 职责 | 不做 |
|---|---|---|
| `lib/wails.ts` | 判断 runtime 是否可用；把 rejection 交给 `lib/errors.ts` | 不弹 UI |
| `lib/errors.ts` | 分类为 `not-ready` / `validation` / `io` / `network` / `model` / `canceled` / `unknown`，附 `retryable` 与 `logHint` | 不弹 UI |
| store | 把错误写进状态（`job.error` / `pageError`）；决定是否需要 Toast | 不直接操作 DOM |
| 组件 | 读状态渲染：内联字段错误 / 区块错误态 / Toast | 不调 `alert` |

规则：
1. **取消不是错误**：`canceled` 走独立分支，不弹 error Toast，界面标注「已取消」。
2. **`not-ready` 可重试**：装配未完成时的调用（B11 修好后应极少出现）由 store 自动重试一次，仍失败才提示。
3. **每个 error Toast 带「查看日志」动作**（调 `OpenLogsFolder`），因为这是单机软件、维护者只能靠日志排错。
4. **静默失败是缺陷**：任何 `.catch(() => {})` 都必须改为至少写日志或提示。现状全仓有大量空 catch（`App.tsx:39,65,66`、`ModelHub.tsx:92,184,187,217`、`Settings.tsx:154`、`Onboarding.tsx:24,58`、`MainTranslate.tsx:132,137,300,341,354`）。浏览器 dev 模式下的「runtime 不可用」是唯一允许静默的场景，且需集中在 `lib/wails.ts` 一处判断，不散落到各组件。
5. **后端错误文案面向用户**：现状直接把 Go 的 `err.Error()` 抛给界面（含内部路径）。改为 `errors.ts` 做映射，未识别的错误保留原文但附「查看日志」。

---

## 6. 主题与 token 实现

### 6.1 正确的 `@theme` 写法（修旧实现的自引用 bug）

```css
/* tokens.css */
:root { --surface: #FFFFFF; --ink-1: #1A1A18; /* … */ }
[data-theme="dark"] { --surface: #1A1A19; --ink-1: #ECECEA; /* … */ }

@theme inline {
  --color-surface: var(--surface);   /* 不同名 → 无环 */
  --color-ink-1:   var(--ink-1);
}
@theme {
  --radius-sm: 6px;                  /* 字面值，不写 var(--radius-sm) */
  --text-read: 15.5px;
  --text-read--line-height: 1.9;
}
```

> 旧 `tokens.css:65-70` 在 `@theme inline` 里写 `--radius-s: var(--radius-s)`、`--font-mono: var(--font-mono)` —— **同名自引用**，CSS 自定义属性成环即失效。新版：颜色走 `@theme inline` + 异名变量（因为要随主题切换），几何/字体走 `@theme` + 字面值（不需要切换）。

### 6.2 主题切换

- `<html data-theme="light|dark">`，由 `theme/theme.ts` 的 `applyTheme(mode)` 设置；`mode ∈ {light, dark, system}`。
- `system` 档监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 事件。
- 写入 `config.Appearance.Theme`（字段已存在，`config.go:70`），`SetConfig` 后立即生效。
- **防白闪**：`index.html` 内联一段阻塞脚本，在首帧前根据 `localStorage` 缓存的主题设置 `data-theme`；同时 `main.go` 设 `BackgroundColour`（B30）与 `<meta name="color-scheme" content="light dark">`。

### 6.3 界面字号

`config.Appearance.FontSize ∈ {small, standard, large}` → `<html data-fontsize>` → 只缩放 `--text-read` 与 `--text-body`（系数 0.92 / 1.0 / 1.1），**不缩放** `--text-micro`（刻度标签必须恒定，否则表格列宽跳动）。缩放后需在 1180 宽度下重测不溢出（PRD S7 待澄清项）。

---

## 7. 并发不变量（因 `-race` 不可用，必须文档化 + 断言）

`CGO_ENABLED=0`（ADR-001）→ `go test -race` 无法运行。以下不变量写进代码注释并在 debug 构建加断言：

1. **锁顺序**：`orchestrator.opMu` → `modelmanager.m.mu` → `App.mu` → `App.cfgMu` → `subtitle.Engine.mu` → `store` 内部锁。**永不反向**。
   - B13 即为此：`List()` 曾在持 `m.mu` 时取 `opMu`，而 `OnEvent` 在持 `opMu` 时取 `m.mu`。
2. **不在持锁时触发回调/事件**：`EventsEmit`、`onProgress`、`orchestrator.Callbacks.OnEvent` 一律在解锁后调用（B7 即此）。
3. **`App.cfg` 只能通过 `cfgSnapshot()` 读、`withCfg()` 写**（B8），任何直接字段访问都是缺陷。
4. **`cond.Wait()` 必须有配对的 `Broadcast()`**（B12）；新增等待点时在 PR 里指出唤醒方。
5. **channel 关闭权归创建者**，且只能关一次（B10 用 `sync.Once`）。
6. **子进程 handle 的生命周期**：只有 watcher goroutine 退出后才允许 `CloseHandle`（B24）。

**测试替代方案**（无 race detector）：
- 用 `sync.WaitGroup` + 屏障构造**确定性**并发测试：先写出能稳定失败的用例，再修，再确认稳定通过（连跑 100 次）。
- 死锁类用超时保护：测试内 `select { case <-done: case <-time.After(3*time.Second): t.Fatal("deadlock") }`。
- `go vet` 保持全绿（现状已全绿），并加 `go vet -copylocks`（默认含）确认无锁值拷贝。

---

## 8. 测试与验证策略

### 8.1 后端

| 检查 | 命令 | 门槛 |
|---|---|---|
| 构建 | `cd app && go build ./...` | exit 0（现状已绿，作回归基线） |
| 静态检查 | `cd app && go vet ./...` | 0 warning（现状已绿） |
| 单测 | `cd app && go test ./...` | 全过（现状 `modelmanager`/`subtitle`/`translator` 三包已绿） |
| 新增单测 | 见下 | 全过 |

**必须新增的测试**（每条对应一个 P0，先写失败用例）：
1. `app`：`deltaBatcher` 并发 `close()` × 2 不 panic（B10）
2. `orchestrator`：`state == stopping` 时调用状态查询在 3s 内返回（B12）
3. `modelmanager`：并发 `List()` + `MarkRan()` × 100 无死锁（B13，超时保护）
4. `modelmanager`：`DeleteModel(id, "不存在的档位")` 返回错误且 models 目录仍存在（B16）
5. `modelmanager`：`AssignUnknown("C:\\Windows\\...\\hosts", ...)` 返回错误且无文件移动（B17）
6. `modelmanager`：校验和缺失时下载**不落盘**（B18）
7. `winproc`：`retLen < 16` 时 `CommandLine` 返回错误不 panic（B14，用构造的短返回）
8. `store`：`SaveGlossary` 中途失败时原术语本完整（B20，注入失败）
9. `store`：`ExportGlossaryCSV` 对 `=SUM(A1)` 类词条做中和（B19）
10. `subtitle`：`CueProgress` 终态事件含 `Translated`；`Done == Total` 于最后一行（B1/B2）
11. `subtitle`：`RetryCues` 重译失败时原译文保留（B5）
12. `subtitle`：ASS 多行 cue（含 `\N`）往返保真（B26，扩展 `roundtrip_test.go`）
13. `subtitle`：UTF-16 BE 与 UTF-32 LE BOM 正确识别（B27）
14. `translator`：取消时返回已累积文本；`eventBuf` 超限报错而非无限增长（B22）

### 8.2 前端

| 检查 | 命令 / 手段 | 门槛 |
|---|---|---|
| 类型 | `cd frontend && npx tsc --noEmit` | exit 0，且 `noUnusedLocals`/`noUnusedParameters` 已开（B32） |
| 构建 | `cd frontend && npm run build` | exit 0 |
| **token 漂移 lint** | `node scripts/lint-design-tokens.mjs`（零依赖，纳入 `npm run build` 前置） | 0 命中：硬编码 hex/rgb、Tailwind 任意值 `-[`、`outline-none`、`<div onClick`、`alert(`/`confirm(`/`prompt(`、emoji、外链字体 |
| **可访问性** | Playwright + axe-core，矩阵 1180 / 1366 / 1680 × light / dark × 6 屏 | **0 critical、0 serious** |
| **对比度** | 脚本读取计算样式，对每个文本节点算与其背景的对比度 | 全部 ≥ 4.5:1（`--text-micro` 装饰性文本亦不豁免，DESIGN.md §2.3 已保证） |
| **键盘流程** | Playwright 脚本：仅用键盘完成「导入字幕 → 选目标语言 → 全部翻译 → 导出」 | 可完成，每步有可见焦点环 |
| **断点** | Playwright 在 1179 / 1180 / 1379 / 1380 / 1679 / 1680 六个宽度截图并断言布局 | 模型卡列数 1/2/3、侧栏收放符合 DESIGN.md §6.2 |
| **动效降级** | `page.emulateMedia({ reducedMotion: 'reduce' })` 后断言无 transform 位移、无无限循环动画 | 通过 |
| **大文件** | 5000 行 ASS，测首屏渲染与滚动长任务 | 首屏 ≤ 500ms，无 > 200ms 长任务 |

> axe-core 需作为 devDependency 引入（`@axe-core/playwright`）。这是**唯一**新增依赖，且只在 devDependencies，不进产物。若不接受，降级为 Playwright 内注入 axe-core 单文件（无 npm 依赖）。**此点需在实施前确认。**

### 8.3 桌面端（无法自动化的部分，手工清单）

Playwright 只能验 web 层。以下必须在真实 `Index-VT.exe` 上手工验：
1. 启动无白闪（深色主题下尤其）
2. 关闭窗口（点 X，非 Ctrl+Q）→ `llama-server` 进程被回收，`nvidia-smi` 显存归零
3. 二次启动 → 激活既有窗口而非新起进程
4. 空闲卸载触发后再次翻译 → 自动唤醒成功
5. 取消翻译 5 次后第 6 次仍返回非空（P0-2 的真实验证）
6. `CollectLogs` 产出的 zip 内容逐项检查是否含待翻译正文（R-6）

**诚实声明**：本项目无法用 `-race` 验证竞态修复，也无法用 Playwright 验证 Win32 进程/显存行为。这两类只能靠确定性单测 + 手工清单，交付时不会声称「已用工具验证」。

---

## 9. 交付顺序

对应 PRD §8。每批次独立可验收、可回滚：

| 批次 | 内容 | 验收 |
|---|---|---|
| **0 地基** | `theme/tokens.css`（两主题）+ `base.css` + `components/ui/` 23 个原语 + `lib/wails.ts`（事件多路分发）+ `lib/errors.ts` + lint 脚本 + B32 | lint 0 命中；原语在 Storybook 式 demo 页（临时，交付前删）上通过 axe；`tsc` 绿 |
| **1 止血** | 后端 B10 B12 B13 B14 B15 B16 B17 B18 B19 B20 B21 B22 B23 B24 B25 + 对应单测 1-9,14 | `go build/vet/test` 全绿；新增测试全过；手工清单 5 |
| **2 首启** | S1：Onboarding 重写 + `onboarded` 落库 + 非阻塞横幅 + B30 | PRD S1 全部 GWT |
| **3 核心价值** | S3：B1-B7 B26-B29 + `pages/Subtitles.tsx` + `DataTable` + `virtualizer` | PRD S3 全部 GWT + 单测 10-13 + 大文件测试 |
| **4 差异化** | S6：`pages/Models.tsx` + 本地导入 + 事件节流；S4：`pages/Glossary.tsx` + 术语注入 + 命中高亮 | PRD S6/S4 全部 GWT |
| **5 完整度** | S7：Settings 重写 + 主题/字号接通 + B8 B9；S8：语义化收尾 + CommandPalette + 快捷键；S10 | PRD S7/S8/S10 全部 GWT + a11y 矩阵 |
| **6 增强** | S2 前端剩余（DualPane/LangBar 完整版）+ S5 配音与约束抽屉 | PRD S2/S5 全部 GWT |
| **7 收尾** | B31（日志脱敏）+ 手工清单全项 + 旧文件归档说明 | 手工清单 1-6 全过 |

> 批次 1 与批次 0 可并行（后端与前端无耦合），但批次 1 必须先于批次 3 完成——S3 的验收依赖 B1/B2/B5/B7。

**实施计划的组织方式**：`writing-plans` 产出的计划**按批次分节**，每节自带验收命令与「本批次完成的判据」，批次之间设人工复核检查点。不把 7 个批次压成一份无检查点的长计划——本项目跨度大（前端全量重写 + 32 项后端变更），一次性执行到尾无法及时发现方向偏差。

> 批次 0 的原语验收需要一个临时 demo 页（dev-only 路由，罗列 23 个原语的全部变体与状态，供 axe 扫描与目视核对），**交付前删除**，不进产物。

---

## 10. 未决问题（2026-10-05 已全部有结论）

> 本节原为实施前待答问题。Track A/B 执行后逐条核过代码，结论附在每条后面；
> 未接线到 UI 的部分留给 Track C，已在交接文档登记。

1. **axe-core 引入方式**：`@axe-core/playwright`（devDependency）还是 Playwright 注入单文件（零依赖）？见 §8.2。
   → 取 `@axe-core/playwright`，已在 `frontend/package.json` devDependencies；矩阵由 `scripts/verify-a11y.mjs` 消费。
2. **`QueueOptions.GlossaryID` 后端是否真的消费**：`engine.go:88` 注释标「M3 启用术语」，但 `queue.go:119` 调 `e.translate(ctx, clean, "auto", opt.TargetLang)` **没有传术语**。若不消费，字幕页的术语选择器本版不上（不做死控件）。
   → 确认不消费（现 `queue.go:144` 仍只传 lang 不传术语）。字幕页术语选择器本版不上，符合预判；主翻译台的 `GlossaryID` 走 `app.go:359` 的真实查表路径，不受影响。
3. **约束抽屉的字段真实性**：mockup 里的 4 硬约束 + 5 软预设必须逐个对照 `translator.Constraints` 的真实字段，后端不消费的**不渲染**。
   → 真实字段只有 `Glossary / Hard / Soft / Genre / JSONPreserve` 五个（`translator/prompt_translate.go:21-28`）。抽屉 UI 未重做，Track C 按这五个字段渲染，多余的预设不渲染。
4. **拖拽导入**：Wails v2 `DragAndDrop` 是否与 WebView2 文本拖选冲突（PRD R-8）。
   → 未实施：前端零 `onDrop/dataTransfer`，`wails.json` 无 `DragAndDrop` 配置，导入一律走原生文件对话框。冲突问题因此尚未遇到，等 Track C 真要做拖拽时再验。
5. **`CollectLogs` 脱敏**（B31/R-6）：`logs/llama-server.out.log` 实际是否含提示词原文？需真实运行一次后检查。
   → 已按保守默认落地（`app/logs.go:15-24` 排除表 + `logs_test.go` 锁定）。2026-10-05 补了实测：本机仅存的样本 25 行，内容只有启动信息、`verbosity = 3` 参数回显、模型绝对路径与 `127.0.0.1:8101` 监听地址，`grep "请将以下"` 零命中——即该次运行未记录提示词正文。但这份样本里模型路径指向 `E:\Code_Projects\Python_Dev\Index-VT_GUI`（旧目录），不能当作当前 exe 的证据；且日志是否含正文取决于 llama-server 的 `-lv` 级别，级别提高后的行为未实测。所以排除表仍是正确默认，`code` 注释里"事实核验尚未执行"那句可以更新为上述结论。
   → 顺带一条实测发现：该日志会写入模型**绝对路径**（含用户名目录）。打包虽已排除它，用户自行分享时仍会暴露本机目录结构。
6. **模型校验失败时的「我知道风险」出口**：是否需要（PRD R-7）。倾向需要，但要输入模型名以防误点。
   → 未实施，也不建议按原倾向实施：完整性校验现为 fail-closed（`modelmanager/download.go:498-508`，拿不到官方 SHA256SUMS 直接拒绝安装并保留 `.part` 供重试）。加绕过出口等于把"不装未校验模型"的承诺换成一个可点的按钮。真要做，前提是产品层面先改口径。
7. **旧文件处置**：`docs/03-GUI设计图/mockups.html` 与 `设计系统规范.md` 已加 SUPERSEDED 横幅并保留。**不删除**（属用户既有资产）；若需归档到 `docs/_archive/`，需用户明确同意。
   → 2026-10-05 用户同意后归档到 `docs/03-GUI设计图/legacy/`（`git mv`，历史可追）。实测修正一项记录偏差：`设计系统规范.md` 确有 SUPERSEDED 横幅，`mockups.html` 原本**没有**任何作废标记，归档时补了页内横幅与 `[已作废]` 标题。引用路径已在 DESIGN.md / README / docs 01·04 同步。
