# Index-VT

Windows 上的全本地 AI 翻译工具。主翻译台、字幕工作台、模型中心、设置都在本机跑，
推理由 `llama-server` 承担。除模型下载外不联网，没有遥测。术语本的增删改查后端齐了，
但界面还没接（见「已知限制」）。

- 技术栈：Go 1.25+ · Wails v2.16 · React 18 · TypeScript 5.7 · Tailwind CSS 4 · SQLite · llama.cpp
- 推理后端：`llama-server`（llama.cpp），应用按需拉起与回收，空闲自动卸载以释放显存
- 便携布局：`models/` 和 `logs/` 就在 exe 所在目录，整个文件夹拷走即搬家

三个模型的现状并不齐平，读文档时请带上这个前提：`translate` 有完整前后端链路；
`homura`（配音）后端已实现但前端没有任何入口；`nailong`（长文档）只有下载与登记能用，
翻译管线是空壳。

> 运行前必读：`thirdparty/llama-server/` 与 `models/` 被 `.gitignore` 排除，干净克隆里两者都不存在。
> 必须先补齐（见「首次准备」），否则应用会提示缺少 llama-server。

---

## 当前状态（2026-10-06）

| 阶段 | 状态 |
|---|---|
| 设计契约（DESIGN.md v2.0「素笺」/ PRD / 动效规范 / spec） | 完成 |
| Track A 后端止血（B1–B31：崩溃、死锁、丢数据、安全边界） | 已完成并合并 `master`；12 个 Go 包里 10 个有测试且全绿 |
| Track B 前端地基（双主题 token / 23 原语 / 事件层 / 九道门禁） | 已完成，在分支 `sujian/track-b-frontend-foundation`，尚未合并 |
| **瑞士风格重映射（2026-10-06 用户指令）** | 两层 token 值整体切换为 Swiss International（白底黑字红强调、直角、无阴影/渐变、150ms ease-out、Helvetica 栈）；语义名与 utility 名不变；verify-theme 期望值已同步，九道门禁全绿。B33（引导页死胡同）与 B34（显存轮询控制台弹窗）已修复。**DESIGN.md 已升到 v2.1 并整表同步瑞士值**（含 Inter 弃用、圆角归零、动效改 Clean Cut、§12 差异表） |
| **Track C 页面迁移（2026-10-06，同日完成）** | 全部页面 + 外壳迁到新设计系统并接线：App/Rail/StatusBar/appStore（事件层 `lib/wails` 全量接线）、主翻译台（R17 错误态保留部分译文·前后端、收藏历史、约束抽屉五字段）、模型中心（未知模型归位 UI、alert/confirm → toast/Modal、nailong/homura 激活收口）、字幕工作台（EV.CUE 译文实时刷新 + SubGetDoc 权威对账、SubGetDoc/SubRetryCues 封装补齐）、设置页（主题/字号真正可改）。旧 `styles/tokens.css` 与旧 `components/ui.tsx` 已删除；lint 白名单 13 行 → 1 行（wailsapi.ts）。九道门禁全绿（verify:wails 探针改开 /?primitives——App 接入新事件层后成为合法订阅者，隔离前提需无订阅页面） |
| **页面级门禁（2026-10-06）** | 新增 `npm run verify:pages`：真页面在 dev 假后端（`?mock`，`lib/mockbackend.ts`）供数下跑 a11y / 对比度 / 键盘三组断言。首轮即抓出并修掉 4 个真缺陷（详见下）|
| **翻译模式系统（2026-10-06）** | 主翻译台顶栏"模式"下拉：内置 5 个领域约束模板（通用=官方无约束默认 / 政治经济·社科金融 / 计算机·人工智能 / 人文写作 / 医疗生物，`lib/modes.ts`）；切换即整套预填硬/软约束+文体域，抽屉内手动微调自动落到"自定义"档并记忆。设置页新增「翻译模式」卡片管理自定义模式（增删改，localStorage 持久化）。后端零改动（Constraints 五字段链路 Track C 已通） |

页面的过渡期结束了：Track C 已把 5 个页面迁完，新旧两层 token 值在 2026-10-06 统一为
瑞士风格（白底/黑墨/红强调），观感一致。`app/build/bin/Index-VT.exe` 里嵌的前端取决于
最近一次 `node scripts/build.mjs`，界面与源码不同步时先重新构建再判断。

发布约束（更新）：原「Track B 不得单独出包」的成因是旧页面在新色相下跌破对比度，这条已随
Track C 与两层 token 对齐而解除。要出包仍需重新构建（`node scripts/build.mjs`）并跑一遍
`verify:all` + `verify:pages`；本机 Win32 手工验收项（见「已知限制」）与它无关，仍然待做。

### 页面级门禁首轮抓出的 4 个真缺陷（2026-10-06，均已修）

| 缺陷 | 症状 | 修法 |
|---|---|---|
| `Settings.tsx` 的 `Row` 定义在组件体内 | 每次渲染生成新组件类型 → 整棵 Row 子树重建：输入框敲第二个字符就丢焦点；Modal 打开时触发按钮节点被销毁，关闭后焦点落到 `<body>` | `Row` 提到模块作用域（`Settings.tsx:17`） |
| `ModelHub` 把 `ListUnknownModels` 当 `string[]` 用 | 后端返回 `[]ModelInfo`，存在未知模型时页面白屏（`path.split is not a function`） | 边界处取 `m.path`（`ModelHub.tsx:61`） |
| `--suj-ink-3` 只按白底校验 | 压 `--sunken` (#F0F0F0) 实测 3.99:1（语言栏 AUTO/TARGET 标签） | light 值 `#767676` → `#6A6A6A`（白 5.41 / sunken 4.75） |
| 瑞士红 `#E60000` 只按白底校验 | 压在 `accentSoft`/`dangerSoft` 6% 底上 4.34:1、sunken 上 4.22:1（模型中心空闲条、"保持加载"、状态栏崩溃徽标） | light `--suj-accent`/`--suj-danger` → `#D40000`（白 5.53 / soft 4.98 / sunken 4.85） |

外加 Settings 三个裸 `<input>`（ngl / CPU 线程 / 历史上限）补了 `aria-label`——axe 判 critical。

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Windows | 10 1809+ / 11 | 只做 Windows：`internal/winproc`、`spawn_windows.go`、`envprobe_windows.go` 全是 Windows 专属实现 |
| Go | ≥ 1.25 | `app/go.mod` 声明 `go 1.25.0`，本机 1.27.1 实测通过 |
| Node.js | ≥ 20 | Vite 6 + Tailwind 4 |
| Wails CLI | v2.16.0 | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` |
| WebView2 Runtime | — | Win11 与较新 Win10 自带；缺失时装 Evergreen Runtime。构建用 `-webview2 embed` 把 loader 打入 exe |
| NVIDIA 驱动（可选） | — | 有 `nvidia-smi` 走 GPU；没有则自动 CPU 模式，约慢 10 倍，引导页会如实提示 |
| Shell | Git Bash | 本文命令块按 Git Bash 写（`grep`、`cd x && y` 之类）。PowerShell/CMD 缺这些 Unix 工具，构建自检另给了等价写法 |

## 首次准备

### 1. llama-server（必需）

从 llama.cpp 发布包取 Windows CUDA 版，放到：

```
thirdparty/llama-server/llama-server.exe      ← 连同其 .dll 一起
```

应用按 `thirdparty/llama-server/` → 基准目录 的顺序探测（`app/internal/paths/paths.go:36`）。
放错位置的症状是引导页报「缺少 llama-server.exe（安装包损坏）」。

### 2. 模型（必需，二选一）

应用内下载（推荐）：首次引导或「模型中心」里下载。三档模型 `translate` / `nailong` / `homura`，
量化档位体积按官方 SHA256SUMS 记：`Q4_K_M` 对 `translate` 是 1,312,164,352 字节（约 1.22 GiB），
`nailong` / `homura` 用近似值 1,312,000,000（`registry.go:62,81,97`）；`Q8_0` 三者同为 2,235,000,000
（约 2.08 GiB）。下载支持 HF / ModelScope 双源择优与断点续传。完整性校验是 fail-closed：
拿不到官方 SHA256SUMS 就拒绝安装，不装未校验的模型，同时保留 `.part` 供重试（`download.go:498`）。

手动放置：把 `.gguf` 放进 `models/`，启动时按两层规则识别：文件名必须严格匹配
`^Index-(Translate|Nailong|Homura)-2B\.(Q4_K_M|Q8_0)\.gguf$`（大小写不敏感），再用 GGUF 头的
`general.file_type` 交叉校验量化档位（`modelmanager/manager.go:151`）。改过名、或档位不在 Q4_K_M/Q8_0
的文件会落到「未知」名单，而当前版本**没有归位入口**：后端 `AssignUnknown` 已绑定，模型中心还没接这个 UI。
遇到这种情况改回官方文件名最省事。

### 3. 前端依赖

```bash
cd frontend && npm install
```

装完人在 `frontend/`，下面的「构建」要在仓库根跑，记得 `cd ..`。

## 构建

在**仓库根目录**跑构建脚本，不要用裸 `wails build`：

```bash
cd ..                                       # 若你还在 frontend/ 里，先回仓库根
node scripts/build.mjs                      # 前端构建 → 同步 embed 目录 → 编译 exe
node scripts/build.mjs --skip-frontend      # 前端未改，只重新编译 exe
```

产出 `app/build/bin/Index-VT.exe`（相对仓库根）。

上面那条 `cd ..` 不是多余的。照「首次准备」走完，你人在 `frontend/`，在那里跑
`node scripts/build.mjs` 会得到：

```
Error: Cannot find module '...\Index-VT_GUI\frontend\scripts\build.mjs'
```

因为 `frontend/scripts/` 下只有 `lint-design-tokens.mjs` 和 `verify-*.mjs`，构建脚本在仓库根的
`scripts/`，两处同名目录容易看漏。脚本内部用 `import.meta.url` 反推仓库根（`scripts/build.mjs:28`），
后续所有子命令都按那个绝对路径执行，所以工作目录其实不影响构建结果，只要 node 找得到脚本文件——
在 `frontend/` 下用 `node ../scripts/build.mjs` 一样能成。

为什么必须走脚本：Go 侧用 `//go:embed all:frontenddist` 嵌入前端（`app/main.go:29`）。vite 产物在
`frontend/dist`，而 Go 模块根是 `app/`，`go:embed` 不能跨 `..`，所以得先构建前端、再把
`frontend/dist` 复制进 `app/frontenddist`。该目录是构建产物（已 gitignore），不会自行更新。

裸跑 `wails build` 的后果：它会构建前端、编译 Go，但不同步 embed 目录，exe 里嵌的是上一次复制的旧前端。
源码是新的、界面是旧的，而且完全不报错。这个坑从 2026-10-04 18:52 一直在，`scripts/build.mjs` 就是为它写的。

构建后自检。本文件所有命令块默认按 Git Bash 写，`grep` 在 PowerShell/CMD 里不存在，会报
`无法将"grep"项识别为 cmdlet...`。按你用的 Shell 选一条，都在仓库根执行：

```bash
# Git Bash
grep -ac suj-ink-1 app/build/bin/Index-VT.exe
```

```powershell
# PowerShell
(Select-String -Path app/build/bin/Index-VT.exe -Pattern 'suj-ink-1' -SimpleMatch -Encoding utf8).Count
```

```bash
# 任意 Shell（Node 是必需依赖，这个最省事，且数的是出现次数）
node -e "const b=require('fs').readFileSync('app/build/bin/Index-VT.exe');const p=Buffer.from('suj-ink-1');let c=0,i=0;while((i=b.indexOf(p,i))>=0){c++;i++}console.log(c)"
```

本机当前 exe 实测：grep 输出 1，PowerShell 输出 1，Node 输出 7（同一串出现 7 次，前两者数的是行）。

非 0 说明新 token 层的样式串确实进了 exe，能证明「嵌的是新前端」，但前两条数的是行数，
证明不了它是本次构建的产物。要确认新鲜度看 exe 的 mtime。

`--skip-frontend` 要求 `frontend/dist/index.html` 已存在（之前完整跑过一次），否则脚本会直接报错退出，
不会拿旧 dist 凑数。

## 运行

路径同样相对仓库根：

```bash
app/build/bin/Index-VT.exe            # 启动
app/build/bin/Index-VT.exe -version   # 打印版本后退出
```

- 单实例：再次启动会激活已有窗口。若单实例锁创建失败（权限或策略异常），应用照常启动而不是静默退出
  （`app/main.go:58`，fail-open）
- 窗口：1280×800 起，最小 1180×700（`app/main.go:90`）
- 退出：点窗口 X 或 Ctrl+Q 都走优雅退出。顺序是取消任务 → 向 `llama-server` 发 CTRL_BREAK →
  等 3s → 超时则 `TerminateProcess` → 等 Job Object 句柄确认 → 关闭 SQLite。`Ctrl+Q` 只在前端绑定
  （`frontend/src/App.tsx:52`），`wails.json` 里没有菜单或快捷键配置
- 关闭 SQLite 是无条件的（`app/app.go:265`）。WAL 的 checkpoint 依赖最后一个连接关闭时自动完成，
  代码里没有显式 `PRAGMA wal_checkpoint`
- 强杀也安全，但不推荐：子进程在带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 Job Object 里
  （常量 `app/internal/winproc/job_windows.go:18`，设置 `:65`），任务管理器强杀主进程不会留下孤儿推理进程。
  这是 Track A 专门补的：`CREATE_SUSPENDED` + 先入 job 再 `ResumeThread`，消除崩溃窗口期。
  代价是跳过优雅停止与应用侧清理，WAL 靠下次启动恢复。优先用 X / Ctrl+Q
- 空闲卸载：无任务持续 N 分钟自动卸载。设置页 1–30 分钟，或设 0 常驻；越界值会被 `config.Normalize`
  收敛回默认 5 分钟（`app/internal/config/config.go:98`）
- 主题：实际由浏览器存储的 `localStorage['indexvt.theme']` 决定，默认 `system`，
  由 `index.html` 内联首屏脚本与 `frontend/src/main.tsx:23` 应用，重启保持。
  设置页上的主题与字号控件是只读展示，改了不生效；Go 侧 `config.Appearance` 有字段但无人读写

### 数据与日志位置

| 路径 | 内容 |
|---|---|
| `models/data/indexvt.db` | SQLite：历史记录、配置、术语本、模型登记 |
| `models/` | 模型文件（`.gguf`）与下载中的 `.part` |
| `logs/indexvt-YYYYMMDD.log` | 运行日志。启动时按 mtime 清掉 7 天前的，没有按大小轮转 |
| `logs/llama-server.out.log` | 推理进程输出 |

- 基准目录解析（`app/internal/paths/paths.go`）：环境变量 `INDEXVT_ROOT` 最高优先（开发/测试用，
  测试靠它把 `models/` 隔离到临时目录）；否则从 exe 所在目录起向上最多 4 层找第一个「已装配根」——
  含 `thirdparty/llama-server/llama-server.exe`（或与根同级 `llama-server.exe`）、或 `models/` 下已有
  完整 `.gguf` 的目录；找不到才回落 exe 所在目录。正常分发 exe 与资产同级，第一层即命中，行为同旧版；
  在仓库检出内直接跑 `app/build/bin/Index-VT.exe` 时会回溯到仓库根，直接用上 `thirdparty/` 与
  `models/` 里的现成资产。空 `models/`、`.part` 半成品、`data/` 都不算装配证据 —— 没有这条回溯时，
  旧版会看不见已下载的模型，引导页每次启动都自动重新下载，且 llama-server 永远探测不到（B33 修复）
- 「设置 → 一键收集打包」产出的 zip 默认不含 `llama-server.out.log`（`app/logs.go:15`）。
  实测本机仅存的一份样本 25 行，只有启动信息、模型绝对路径与监听端口，`grep 请将以下` 零命中，
  也就是说那次运行没记正文。但日志内容随 llama-server 的 `-lv` 级别变化，级别提高后的行为没实测，
  所以默认排除是正确选择。注意该日志会写模型绝对路径，自行分享时等于交出本机目录结构

## 开发

```bash
# 热重载整应用（Go + 前端）
cd app && wails dev

# 只跑前端（无 Go 后端；浏览器里 Wails 运行时不存在，UI 会容忍）
cd frontend && npm run dev

# 陈列页需要显式绑到 127.0.0.1
cd frontend && npx vite --host 127.0.0.1 --port 5173    # → http://127.0.0.1:5173/?primitives
```

裸跑 `npm run dev` 只监听 `[::1]:5173`，用 `127.0.0.1` 取不到页面；所有 verify 脚本自带
`--host 127.0.0.1`，所以脚本里能跑通、手工照 README 敲就会失败。
本机 `connect()` 到 `::1` 返回 EACCES，这是显式用 IPv4 的原因。

陈列页只渲染新设计系统，不 import Wails，因此不需要后端。它是**常设的 dev-only 工具**：
原语速查 + 组件层的门禁靶子（a11y/对比度/键盘/虚拟化/事件隔离五处断言都指向它）。

真实页面在浏览器里没有 Go 后端，会渲染成空态。要看带数据的形态（也是页面级门禁的供数方式），
加 `?mock` 开 dev 假后端（`lib/mockbackend.ts`，只在本文件被 `import.meta.env.DEV` + 动态 import
拉到，生产包不含）：

```bash
cd frontend && npx vite --host 127.0.0.1 --port 5173
#  http://127.0.0.1:5173/?mock&page=model     初始页 = 模型中心
#  http://127.0.0.1:5173/?mock&fresh=1        config.onboarded=false，看首次引导
#  http://127.0.0.1:5173/?mock&page=subtitle  字幕页（点「导入字幕」出一份 48 条 cue 的样例）
```

假后端覆盖 `wailsapi.ts` 里全部 37 个绑定（另有一个未封装的 `ExportGlossaryCSV`）；
未覆盖的方法 resolve(null) 并在控制台点名。

## 验证门禁

```bash
# 后端
cd app && go build ./... && go vet ./... && go test ./...

# 前端（build 内含 lint:design + tsc --noEmit）
cd frontend && npm run build

# 前端九道门禁（组件层：陈列页 + 各纯逻辑脚本）
cd frontend && npm run verify:all

# 页面级门禁（真实页面 + ?mock 供数；a11y 20 组合 / 对比度 10 组合 / 键盘）
cd frontend && npm run verify:pages
```

`verify:all` 的九步与覆盖范围（前三道是纯逻辑/构建，后六道需要浏览器）：

| 步骤 | 断言 | 靶子 |
|---|---|---|
| `lint:design` | 设计 token 漂移：旧 utility、硬编码色值、任意值 | 49 文件扫描，白名单只剩 `wailsapi.ts` 一行 |
| `tsc --noEmit` | 类型检查，`noUnusedLocals`/`noUnusedParameters` 已开 | 全部 TS |
| `verify:theme` | token 换值、字体栈、瑞士直角、旧变量已清除、语义组合可读 | tokens.css |
| `verify:wails` | 事件层：多路分发、退订隔离、`EventsOff` 语义、早到缓冲、异常隔离 | `lib/wails.ts`（探针页 = 陈列页） |
| `verify:lib` | 时间码/字节/百分比/虚拟化边界 | `lib/format.ts`、`lib/virtualizer.ts` |
| `verify:a11y` | axe 矩阵 1180/1366/1680 × light/dark | 陈列页（组件层） |
| `verify:datatable` | 5000 行 DOM 数与长任务 | 陈列页的 5000 行演示表——**组件级门禁，故意不搬去真实页面**（真实页面没有这种数据量） |
| `verify:contrast` | 所有可见文本 ≥4.5:1 | 陈列页 |
| `verify:keyboard` | Tab 焦点环、Segmented 方向键、Modal 陷阱 + 焦点归还、破坏性确认初始焦点、reduced-motion 三断言 | 陈列页 |

`verify:pages` 三组，全部跑在 `?mock` 供数的真实页面上：

| 步骤 | 内容 |
|---|---|
| `verify:pages:a11y` | 5 个靶子（translate/subtitle/model/settings/引导页）× 1180,1680 × light,dark = 20 组合，门槛 critical=0 && serious=0 |
| `verify:pages:contrast` | 同 5 个靶子 × 两主题；字幕页用 `--click-text=导入字幕` 先展开 48 条 cue 再测 |
| `verify:pages:keyboard` | Settings 页（`--modal-text=立即清空 --confirm-text=立即清空 --min-stops=10`），组件不存在记 SKIP、全 SKIP 视为失败 |

脚本改靶方式：都是位置参数给路径，`verify-a11y` 可给逗号分隔的多路径；`verify-contrast`
支持 `--click-text=` 做一次导航后点击；`verify-keyboard` 支持 `--min-stops/--modal-text/--confirm-text`。
键盘门禁的结果口径是 PASS/SKIP/FAIL 三态计数，SKIP 不掩盖 FAIL，也不允许"全跳过"当绿。

已知环境约束，都已写进脚本，不是待办：

- `go test -race` 不可用。`CGO_ENABLED=0` 是架构决策（ADR-001），所以竞态类修复只能靠确定性并发测试
  加代码审阅。任何报告都不得声称 race detector 通过
- `npx playwright install chromium` 本机不可达（`cdn.playwright.dev` 超时）。各 verify 脚本自己按
  `channel: 'chrome'` → `msedge` → 自带 chromium 回退，不依赖下载浏览器。这段回退逻辑在每个脚本里各存一份，
  没有抽公共 helper
- Git Bash 里跑 node 脚本需要 `MSYS_NO_PATHCONV=1`，因为只有 `verify-a11y.mjs` 的位置参数
  `/?primitives` 会被 MSYS 路径转换吃掉；npm scripts 走 cmd 则不需要
- 两个门禁组的覆盖面不同：`verify:all` 是组件层（陈列页 + 纯逻辑），`verify:pages` 是页面层
  （真实页面 + `?mock`）。页面层目前只覆盖 a11y/对比度/键盘三组；`verify:datatable` 的本质是
  组件级性能门禁，留在陈列页（真实页面没有 5000 行数据）
- 页面级 a11y 的剩余 moderate（不阻塞门禁，门槛是 critical/serious）：真实页面都有
  `page-has-heading-one`（页面标题是 `<span>` 不是 `<h1>`），引导页另有 `landmark-one-main` 与
  `region ×12`（向导浮层没有 `<main>` 包裹）

## 目录结构

```
app/                      Go 后端（模块 indexvt）
  main.go                 Wails 入口：单实例锁 → 日志 → 装配 → UI
  app.go                  绑定层（前端唯一 API 面，51 个导出方法）
  frontenddist/           前端 embed 源（构建产物，gitignored，由 scripts/build.mjs 同步）
  internal/
    orchestrator/         llama-server 生命周期、空闲卸载、热切换、状态机
    modelmanager/         三模型注册表、下载（双源 + 续传 + 校验）、路径安全
    translator/           提示词、SSE 流式、off-target 检测、首字节看门狗
    subtitle/             SRT/ASS/VTT/LRC 解析与保真导出、翻译队列
    docpipeline/          长文档：只有类型与接口，无实现（M5 范围）
    store/                SQLite（历史/配置/术语/模型登记）
    envprobe/             GPU / llama-server / 残留进程探测
    winproc/              Win32：互斥锁、job object、控制台、进程句柄
    config/ paths/ csvsanitizer/
frontend/                 React 前端
  src/theme/              语义 token（light/dark · 瑞士值）+ 主题运行时 + 本地字体
  src/lib/                wails 事件层 / 错误映射 / 格式化 / 虚拟化 / useDismissable /
                          modes.ts（翻译模式模板）/ mockbackend.ts（dev 假后端，?mock）
  src/components/ui/      23 个原语（Button…DataTable）
  src/pages/              5 个页面 + _Primitives 陈列页
  src/wailsapi.ts         RPC 薄封装（事件走 lib/wails，调用仍走这里）
  src/vite-env.d.ts       import.meta.env 类型（Vite 客户端类型引用）
  scripts/                门禁脚本（lint-design-tokens / verify-*）
scripts/build.mjs         生产构建入口
thirdparty/llama-server/  推理后端（gitignored，需自备）
models/                   模型与数据库（gitignored）
docs/                     设计与交付文档（见下）
spark-output/             PRD 与动效规范等设计链产物
```

## 文档索引

| 文档 | 作用 |
|---|---|
| `docs/03-GUI设计图/DESIGN.md` | 视觉契约 v2.1：token 实算值（含对 surface 与对自身 soft 两列对比度）、组件规格、a11y 契约、反模式与漂移防线。2026-10-06 已随瑞士重映射整表同步，§12 记 v2.0「素笺」→ v2.1 的差异。§6.2 断点与若干布局值如实标注为未实现 |
| `docs/03-GUI设计图/legacy/` | v1.0 作废件（`设计系统规范.md` + `mockups.html`），2026-10-05 归档，只作历史参考 |
| `docs/01-设计方案文档.md` · `02-执行细节说明.md` · `04-交付与验收方案.md` | M1 设计冻结记录。哪些条目已被取代、哪些功能仍未实现，见各文件开头的状态说明 |
| `docs/superpowers/specs/2026-10-04-gui-redesign-and-defect-fixes-design.md` | 工程 spec：架构、B1–B32 契约变更（B32 属 Track B）、并发不变量、验证矩阵；§10 是已回答的未决问题 |
| `docs/superpowers/plans/2026-10-04-sujian-track-a-backend-hardening.md` | Track A 实施计划（已完成） |
| `docs/superpowers/plans/2026-10-04-sujian-track-b-frontend-foundation.md` | Track B 实施计划（已完成） |
| `docs/superpowers/plans/2026-10-05-sujian-track-b-handover.md` | Track B 完成报告 + Track C 交接清单（23 原语导入面、迁移白名单规则、未接线后端能力） |
| `spark-output/prd/sujian-gui-redesign.md` | 8 段式 PRD：10 个 Story × 64 条 Given/When/Then 验收 |
| `spark-output/context/motion-plan.json` | 动效规范（Premium 人格，16 条 element_specs，reduced-motion 降级策略） |
| `spark-output/dashboard.html` | 设计链面板，可由套件重新生成，不含独有信息 |

## 隐私与安全

- 全本地推理，零遥测：没有行为埋点，不接分析服务
- 外网仅用于模型下载：仅 https、允许列表域、解析后 IP 直连以防 DNS rebinding（`download.go:88`）。
  允许列表检查发生在 `CheckRedirect`，初始 URL 由代码拼接而非用户输入
- 路径安全：来自前端的文件路径过归拢校验（必须在 `models/` 内 + `.gguf` 后缀），由
  `modelmanager/manager.go:470,512` 在导入归位与删除两处执行。字幕的 `SubOpen`/`SubExport`
  走系统对话框路径，不经此检查
- CSV 导出做过公式注入中和：`=` `+` `-` `@` 开头的内容加前缀 `'`，不会被 Excel 当公式执行
  （`csvsanitizer.go:9`）
- `logs/llama-server.out.log` 默认不进「脱敏」zip，理由见「数据与日志位置」

## 已知限制

- 只做 Windows，不考虑跨平台
- cue 编辑与时间轴操作（行内编辑、±100ms、拆分合并、整体平移、两点校准）后端不存在，UI 也未做
  —— 属 M4 计划范围（`docs/04-交付与验收方案.md` §5 里程碑表），不是 Track C 的遗漏
- 长文档翻译：`docpipeline` 是接口空壳，`DocTranslate`/`DocCancel`/`DocExport` 三个绑定直接返回
  「文档翻译将于 M5 里程碑提供」。导航里那一项是置灰的（`Rail.tsx:9`，标题「文档翻译（M5 提供）」），
  点进去是占位页，前端从未调用过这三个绑定
- 配音模式（Homura）后端已实现（prompt 构造、`ModeDubbing`、音节计数都在），但前端零入口，
  所以用户目前用不到；`StatusBar` 里只有一处模型名映射
- 模型中心的激活收口在 UI 层：只有 `translate` 可设为当前模型（`ModelHub.tsx:143`），
  `nailong`/`homura` 的按钮不可点。后端 `SetActiveModel` 本身没有守卫，绕过 UI 直接调用仍可设置
- 设置页的「关闭程序时」是无 `onChange` 的单选展示（退出即释放是唯一实现）；主题与字号已可改
  （Track C 接通了 `applyTheme`/`applyFontSize` + 配置持久化）
- 状态栏的「离线可用」徽标是写死的静态元素（`StatusBar.tsx:93`），不来自后端状态。Go 侧
  `GetSystemStatus` 的 `Offline` 字段恒为 `false`（`app.go:646`）且前端无人消费。也就是说断网探测并未实现，
  徽标只是把「模型就绪后不需要网络」这句设计事实常驻显示
- 事件订阅已全部走 `lib/wails`（单点订阅多路分发）；`wailsapi.ts` 现在只剩 RPC 薄封装。
  它是 lint 白名单里最后一行（因 `declare global` 的 any 用法保留豁免）
- 术语本只读可选、不能建/改/删：约束抽屉用 `ListGlossaries` 拉列表，
  `SaveGlossary`/`DeleteGlossary`/`ExportGlossaryCSV` 已封装但没有 UI；`CurrentModelPath()` 恒返回空串
- 页面级门禁的已知缺口：只覆盖 a11y/对比度/键盘三组（`verify:pages`），datatable 留在组件层；
  引导页有 3 类 moderate 未修（`page-has-heading-one`、`landmark-one-main`、`region ×12`），
  真实页面各有 1 条 `page-has-heading-one` —— 都不阻塞门禁（门槛是 critical/serious），但属待办
- 内嵌字体三份（均 SIL OFL 1.1）：Archivo latin 子集 18.3KB、Noto Sans SC CJK 子集 1.72MB、
  JetBrains Mono latin 子集 30.7KB。Archivo 与 Noto 的许可证文本随仓库分发
  （`frontend/src/assets/fonts/OFL-*.txt`），**JetBrains Mono 的许可证副本仍缺，发布前需补**。
  **CJK 子集不覆盖生僻字/繁体/韩文**——这些字按字形回退系统雅黑，同段文本可能出现字形混排
  （口径与体积取舍见 `DESIGN.md` §3.1）
- 语言清单实际 152 条（22 核心 + 130 扩展，`translator/languages.go:16-18`），代码注释与 UI 文案仍写「150 语言」
- **64K 档真机未验证**：模型 GGUF 标称 262144 positions（理论支持），但 `-c 65536` 的启动耗时、
  显存峰值与失败时的 orchestrator 退避从未实测；ctx 自定义刚落地时建议首次用超 32K 档位时手工观察一次。
  显存估算是线性模型（偏差 ±20%，见 `EstimateCtxVRAM` 的 `basis`），不是测量值
- `go test -race` 不可用；Win32 进程与显存行为只能真机手工验收
