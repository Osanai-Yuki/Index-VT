# PRD — Index-VT / 素笺 GUI 重构与缺陷修复

- **生成时间**：2026-10-04T20:07:10+08:00
- **数据源**：`spark-output/context/motion-plan.json`（1 个上游 Skill）+ 代码库取证（前端 13 文件全量阅读、Go 后端全量审计、mockups/规范 gap 分析、Playwright 1366×768 实测渲染）
- **完整度**：**moderate** — Section 6/7/8 强支撑（有 file:line 级证据），Section 2/3/5 偏薄（无 brief / frame / stories 上游，persona 由代码与文档反推）
- **设计契约**：`docs/03-GUI设计图/DESIGN.md`（v2.0「素笺」，取代已作废的 v1.0《设计系统规范.md》）
- **动效规范**：`spark-output/context/motion-plan.json`（Personality = Premium，用户显式确认）

---

## 1. Summary

Index-VT 是一个 Windows 桌面端、全本地推理的 AI 翻译工具（Wails v2 + Go + React/TS，三模型：Translate / Nailong 长文档 / Homura 配音，llama.cpp 后端，便携布局随项目文件夹迁移）。本 PRD 面向**汉化组与字幕组的译者/校对**——他们要在 1366×768 到 1920×1080 的屏幕上，长时间对照阅读双栏译文、批量翻译上千行 cue、管理模型与术语。现在是重做它的时机，因为现有实现与它自己的设计契约严重脱节：v1.0 规范写了 14 屏，只落地 6 屏；后端暴露的 32 个绑定方法里 8 个没有任何 UI 入口（术语本 CRUD 完整但前端零 UI，导致术语注入与术语锁定整条链路不可达）；前端有 3 处死控件、8 处 `alert()/confirm()`、0 个 a11y 属性、0 条媒体查询；后端审计发现 12 项会崩溃/丢数据/破安全边界的缺陷，其中「取消一次翻译即可永久打死共享推理进程，之后所有翻译静默返回空串」和「每次启动都重跑引导并自动触发 1.3GB 下载」两条会直接摧毁首次体验。成功长什么样：**引导到首次成功翻译 ≤ 90 秒（模型已就位时 ≤ 5 秒）；字幕队列完成后无需重新导入即可看到全部译文（现状为 0%）；axe 在 1180/1366/1680 × light/dark 六组实测下 0 critical、0 serious；取消翻译后下一次翻译成功率 100%（现状可能永久失效）。**

---

## 2. Background & Problem

### 用户视角的问题

译者打开这个工具，第一次看到的应该是「输入文字，右边出译文」。现状是：

1. **每次启动都被 4 步向导拦住。** `onboarded` 状态只写进前端 zustand store（`App.tsx:81`），从不回落后端 `config.Onboarded`（`config.go:73` 字段存在，全仓库无写入点）。重启即重跑向导，且向导第 3 步会**自动**发起 Index-Translate-2B Q4_K_M（约 1.3GB）下载（`Onboarding.tsx:62-65` 的 `startDownload()` 在 `step===3` 时无条件触发）——即使用户模型早就下好了。
2. **取消一次翻译，之后全废。** 取消路径触发 `sse.go` 的三个 goroutine 互相等待对方读管道，最终永久 `SIGKILL` 掉共享的 `llama-server`；若不退出，`TaskDone()` 永不触发，编排器的 `activeTasks` 永久 >0，**后续所有翻译静默返回空字符串**——没有错误提示，右边就是空的。
3. **字幕翻完了，表格里看不到译文。** 后端 `CueProgress`（`engine.go:93-101`）不含 `Translated` 字段也不含 `DocID`；前端（`SubtitleWorkbench.tsx:67-81`）既拿不到译文，`p.docId` 也永远匹配不上。唯一「看到译文」的办法是重新导入文件。
4. **术语本功能存在但摸不到。** `ListGlossaries`/`SaveGlossary`/`DeleteGlossary`/`ExportGlossaryCSV` 全部已绑定（`app.go:389-415`），前端 `wailsapi.ts:46-48` 有封装但**从未被任何页面 import**。于是「术语注入提示词」「术语命中高亮」「术语锁定」这些翻译工具的核心能力，用户完全无法触达。
5. **界面点不动的地方比想象多。** 设置页的「关闭程序时」「主题」「界面字号」三个 Segmented 没有 `onChange`（`Settings.tsx:101,137,140`）——纯装饰。模型中心的「暂停」和「取消」调同一个 `apiCancelDownload`（`ModelHub.tsx:184,187`）。字幕页的「重试选中项」「整体平移」「两点校准」在设计稿里，代码里一行都没有。
6. **键盘用户进不来。** 左导航、语言选择、历史行、开关、分段器全部是 `div`/`span` + `onClick`；实测 6 个真实 `<button>` vs 6 个 `cursor-pointer` 的 div；`src/` 内 `role`/`aria-*`/`tabIndex` 出现次数为 **0**；6 处 `outline-none` 无替代焦点样式。而 v1.0 规范 §7 明写「全部操作可达」。

### 当前 workaround

用户的现实做法是：不用这个 GUI，直接开 `llama-server` + 命令行；或者用在线翻译（与「全本地、零遥测」的产品承诺直接冲突）；字幕场景回退到 Aegisub 手工逐行 + 机翻网页粘贴。这些 workaround 的共同点是**放弃了批量与本地隐私**，正是本产品声称要解决的。

### 为什么是现在

- 三模型（Translate / Nailong / Homura）与 llama.cpp 编排层已经能跑通：`go build`、`go vet`、`go test` 三绿，`ggufmeta`/`prompt_homura`/`prompt_translate`/`sse`/`roundtrip` 五个包有测试。后端地基在，缺的是**它能力的可见性**。
- v1.0 设计契约已被用户明确作废（2026-10-04 决定推翻），继续按旧规范补屏没有意义。
- 12 项 P0 缺陷里，有 3 项（双重 close panic、`cond.Wait()` 无 Broadcast 死锁、`winproc` 越界读）属于「随机崩溃/启动即崩」级别，越晚修越多用户把它们归因为「这软件不稳定」。

### 本 PRD 故意不解决什么

1. **长文档翻译（Nailong 全文一致性）**：后端 `DocTranslate` 返回「文档翻译将于 M5 里程碑提供」（`app.go:610-616`），`docpipeline` 整包不可达。本版**从导航移除**该入口，不做假界面。
2. **cue 编辑与批量时间轴操作**（拆分/合并/插入/删除/±100ms/整体平移/两点校准）：字幕引擎只有 `Open`/`GetDoc`/`Export` + 队列操作（`engine.go:127-300`、`queue.go:22-242`），**这些能力后端一个都没有**。用户已决定归入 Phase 2，本版不画死控件。
3. **ASS 样式编辑面板与 16:9 预览画布**：同上，无后端。
4. **托盘驻留**：`config.CloseBehavior` 有 `tray-reside` 枚举值（`config.go:36`）但无实现，本版只做「退出即释放」，并在设置页如实呈现为单一不可选项而非假 Segmented。

---

## 3. Personas

### Primary persona

```
姓名：阿澄
身份：字幕组翻译 + 校对，日语→中文，每周 1-2 话新番，同时兼一部同人游戏的汉化
情境：晚上 10 点到凌晨 2 点，1920×1080 外接屏 + 1366×768 笔记本各一半时间；
      一话字幕 300-450 行 cue，游戏汉化是几千行零散短句
JTBD：当我拿到一份 SRT/ASS，我想一次性批量翻出可读的中文并保留原时间轴与样式，
      从而把剩下的时间花在润色与校对上，而不是逐行复制粘贴到网页翻译。
当前 workaround：Aegisub 逐行 + 网页机翻粘贴；术语靠一个 txt 手工对照；
      人名一致性靠记忆力
痛点：① 机翻术语不统一，同一个角色名出现三种译法，校对时要全局替换
      ② 批量工具要么要联网（隐私/额度），要么界面卡到几千行就崩
      ③ 翻完看不到结果、或者结果不进表格，等于白跑
      ④ 夜间长时间盯屏，深色主题的高饱和品牌色很刺眼
```

### Secondary persona

```
姓名：老周
身份：汉化组技术，负责工具链与模型部署，不太做翻译本身
情境：给组里 5-8 个人配好统一的工具与模型，出问题时要能远程排查
JTBD：当我把工具发给组员，我想让他们下载模型、选量化档位、出问题时打包日志给我，
      从而不必每个人的机器都远程连一遍。
当前 workaround：手写 README + 网盘传模型 + 微信截图排错
痛点：① 模型下载源在国内不稳定，需要 HF/ModelScope 择优与断点续传
      ② 组员描述不清故障，需要一键日志打包（且必须脱敏）
      ③ 显存不够时要知道该降 ctx 档位还是降 -ngl
```

### 这个产品不为谁做

不为**偶尔翻一句就走**的轻度用户做——他们打开网页翻译更快，本产品的全部价值（本地模型、批量队列、术语一致性）对他们都是负担。也不为**非 Windows** 用户做（`winproc`/`spawn_windows.go`/`envprobe_windows.go` 全是 Windows 专属实现，`explorer` 硬编码在 `app.go:631`）。

---

## 4. Goals & Success Metrics

### 产品目标

让字幕组译者**在本机、离线、一次批量操作**内拿到术语一致的可读译文，并把校对时间而不是搬运时间花在这个工具里。（outcome-framed：不是「重构 5 个页面」，而是「批量翻译的结果可信、可见、可继续编辑」）

### 成功度量

| 指标 | 度量什么用户行为 | 目标值 | 时间窗 |
|---|---|---|---|
| **引导→首译耗时**（primary） | 从进程启动到第一次看到译文的墙钟时间 | 模型已就位 ≤ 5s；需下载 ≤ 90s（不含下载时长）且**不自动开始下载** | 30 天 |
| **字幕结果可见率**（primary） | 队列完成后，cue 表「译文」列非空的行 / 已翻译行数 | **100%**（现状 0%） | 30 天 |
| **取消后可用率**（primary） | 取消任一任务后，下一次翻译返回非空输出的比例 | **100%**（现状可能永久为 0） | 30 天 |
| **崩溃/无响应**（health） | 启动失败、panic、界面冻结（`opMu` 死锁）报告数 | 0 | 60 天 |
| **术语功能触达**（secondary） | 至少创建过 1 个术语本并在翻译中启用的用户占比 | ≥ 40% 的活跃用户（现状 0%，无入口） | 60 天 |
| **可达性**（health） | axe 在 1180/1366/1680 × light/dark 六组的 critical+serious 数 | **0** | 交付即验 |
| **键盘完成率**（secondary） | 仅用键盘完成「导入字幕→选目标语言→全部翻译→导出」全流程 | 可完成（现状不可） | 交付即验 |
| **大文件不卡死**（health） | 打开 5000 行 cue 的 ASS，滚动帧率 | ≥ 50fps，主线程无 >200ms 长任务 | 60 天 |

### Anti-metrics（反指标：明确不优化）

1. **每屏可见控件数** —— 不追求「功能都摆在脸上」。素笺概念下控件靠抽屉与命令面板收纳，把控件数当 KPI 会直接毁掉留白。
2. **动效数量与总时长** —— 不追求「有动效显得高级」。Premium + 稀疏原则下，全站只有页面切换是编舞时刻，数据行永不动画。优化这个指标等于制造干扰。
3. **会话时长 / 日活** —— 这是生产力工具，用户待得久说明任务没完成得快。不引入任何留存钩子、通知、成就体系。
4. **遥测事件数** —— 见 §6 埋点说明：本产品**零遥测**，不做任何行为上报，因此不存在这个指标。

### 关键假设 ⭐

**「译者愿意为『术语一致 + 全本地』承受首次下载 1.3GB 模型与显存门槛。」**

如果这条错了（例如用户更在意即开即用，宁可联网也不愿下模型），那么本版把资源投在术语本 UI、模型中心可信度、离线隐私表达上就是投错了方向，应该转向「可选的远程推理端点」——那会改变产品的根本承诺，因此必须最先验证。最便宜的验证：在引导第 1 步之后放一个不阻塞的「跳过下载，先用在线端点」出口，观察点击率（本地记录，不上报）。

---

## 5. Value Proposition

### 对主用户（阿澄）

> 阿澄终于可以**把一份 SRT 丢进来、选一次术语本、按下全部翻译，然后在同一个表格里逐行校对译文**，而不必在 Aegisub 和网页翻译之间来回搬运、也不必靠记忆力维持人名一致——因为这个工具把术语注入到提示词里、把译文实时刷回 cue 行、并且从始至终不联网。

### 对 secondary（老周）

> 老周终于可以**发一个便携文件夹给组员**，让他们自己完成模型下载（HF/ModelScope 双源择优 + 断点续传）、量化档位选择、显存不足时降 ctx/-ngl，出问题一键打包脱敏日志——而不必远程连每个人的机器。

### 竞争差异化

- **网页机翻（DeepL/Google）**：做对了「即开即用、零安装」，留下的空白是**隐私、批量、术语一致性、离线**。本产品填的是后者，且用「全本地推理·零遥测·除模型下载外零网络请求」把这条空白变成可验证承诺（状态栏常驻离线徽标）。
- **CAT 工具（Trados/memoQ/Crowdin）**：做对了**术语库与批量流程**，留下的空白是**价格、学习成本、以及本地 LLM 推理**——它们的机翻引擎仍是云端。本产品把术语库能力以极轻量形态（一本 = 一组 term/translation，CSV 可导入导出）+ 本地推理提供。
- **Aegisub + 外部机翻脚本**：做对了**时间轴与样式编辑**，留下的空白是**翻译本身**。本版不与它竞争时间轴编辑（cue 编辑归 Phase 2），而是把「翻译 + 术语 + 导出」这一段做扎实，允许用户导出后回 Aegisub 精修。

---

## 6. Solution & Feature Scope

> **埋点说明（刻意偏离 skill 默认要求）**：本产品的核心价值主张是「零遥测」，状态栏与设置页都以此为承诺（`StatusBar.tsx:83`「全本地推理 · 零遥测」）。因此**不设计任何行为埋点事件**，不接入分析服务。§4 的度量全部通过**本地可复现的验证手段**取得：axe 报告、Playwright 实测、`logs/indexvt-YYYYMMDD.log`、以及「一键收集打包」（`app.go:636` `CollectLogs`）产出的脱敏日志包。若未来需要产品决策数据，只能走「用户主动打包日志发给维护者」这条路径。
>
> ⚠️ 隐私风险（来自后端审计）：`CollectLogs` 声称脱敏，但 `logs.go:50` 会把 `logs/llama-server.out.log` 一并打进包，而 llama-server 可能把提示词原文写进该日志——**提示词里含用户待翻译的正文与术语表**。这条必须在交付前验证并修（见 §7 风险表 R-6）。

---

### S1 · 首次启动即可用，引导不再拦路

**Persona**：阿澄（首次）／老周（给组员装机）
**Job**：装好就想翻 → 不想每次启动都被向导拦、不想被自动下载 1.3GB
**优先级**：**P0** · 关键假设标记 ⭐

**功能描述**
进程启动后直接进入主界面。只有「本机没有任何可用模型」时才呈现引导，且引导是非阻塞覆盖层：可关闭，关闭后主界面顶部常驻一条「模型未就绪」横幅 + 就地 CTA。已有模型时启动即进翻译台，不出现任何向导。

**In Scope**
- `onboarded` 状态**落库**：引导完成或用户关闭时写 `config.Onboarded = true`（后端 `SetConfig` 已支持，前端从未调用）
- 启动判定改为「扫描 `models/` 是否已有可用 gguf」，而不是「onboarded 标志」——两者独立
- 引导**不再自动触发下载**（删除 `Onboarding.tsx:62-65` 的无条件 `startDownload()`），改为显式「开始下载」按钮 + 明确的体积与源信息
- 引导步骤压缩为 2 步：环境检测 → 模型就绪（原「本地扫描」并入第 1 步结果，原「就绪试译」改为可选）
- 未就绪横幅：常驻主界面顶部，含「去下载」与「从本地导入 .gguf」两个 CTA
- 启动白闪修复：Wails `options.App.BackgroundColour` + `index.html` 内联首屏背景 + `<meta name="color-scheme">`

**Out of Scope**
- 引导内的「试译」步骤若模型未就位则不出现（不做假演示）
- 多语言界面（本版仅简体中文）

**验收标准（Given / When / Then）**
- Given 本机 `models/` 已存在 Index-Translate-2B 的 gguf，When 启动应用，Then 直接渲染翻译台，**不出现引导覆盖层**，且首屏可交互 ≤ 5s
- Given 本机无任何模型，When 启动应用，Then 出现引导覆盖层；When 点击关闭（X 或 Esc），Then 覆盖层以 240ms 淡出，主界面可见，顶部出现「模型未就绪」横幅，**且未发起任何网络请求**
- Given 用户完成或关闭过引导一次，When 重启应用，Then 不再出现引导（`config.onboarded === true` 已落库，可用 SQLite 直接查证）
- Given 引导停在模型步骤，When 用户未点击「开始下载」，Then 5 分钟内无网络请求、无 `.gguf.part` 文件产生
- 边缘情况：`models/` 存在但文件损坏/截断 → 横幅文案改为「模型文件损坏，请重新下载或导入」，CTA 同上，不得崩溃
- 空状态：引导第 1 步环境检测失败（无 nvidia-smi）→ 如实显示「未检测到 NVIDIA GPU，将以 CPU 模式运行（速度约为 GPU 的 1/10）」，不阻塞继续

**设计触点**
- 涉及屏：引导覆盖层（`DESIGN.md` §6.3）、翻译台（横幅态）
- 涉及组件：Modal 语义的覆盖层（但**不带 scrim 阻塞**）、Button `lg`、Badge、Surface、Toast
- 涉及状态：empty（无模型）/ loading（环境检测中）/ error（检测失败）/ success（模型就绪）
- 动效：`motion-plan.json` → `引导步骤推进`、`空态`

**关联 Sitemap 页面**
- `onboarding`（覆盖层，无独立路由）
- `translate` — `/` 翻译台（默认落点）

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` — 设计契约（token/组件/布局/a11y/反模式）
- `spark-output/context/motion-plan.json` — 动效规范（16 条 element_specs）
- 待生成：`frontend/src/pages/Onboarding.tsx`（重写）、`frontend/src/components/ModelNotReadyBanner.tsx`

**待澄清问题**
- 「跳过下载，先用在线端点」这个关键假设验证出口是否要做？做则违背零网络承诺，需要显式的用户授权开关（默认关）。倾向：本版**不做**，改为在引导文案里说明体积与耗时，把决策权交给用户。

---

### S2 · 流式翻译可靠可见

**Persona**：阿澄
**Job**：输入→看译文流出来→复制走人；出错要知道为什么，取消要能马上重来
**优先级**：**P0** · 关键假设标记 ⭐

**功能描述**
双栏读写：左侧输入，右侧流式输出，末尾钢笔蓝光标。取消/出错/切页都不丢已有文本，不损坏后端状态。自动检测出的源语言要真的回显。

**In Scope**
- **任务态上提到全局 `jobStore`**：切页/卸载组件不中断订阅、不丢输出（现状任务态在 `MainTranslate` 组件内，切页即丢订阅而后端仍在跑）
- **事件层重构**：`lib/wails.ts` 单事件名一次订阅 + 本地多路分发，退订只摘自己的 handler（现状 `eventsOn` 退订调 `EventsOff(name)`，会摘掉**所有**订阅者——`model:progress` 被 Onboarding/ModelHub/appStore 三处订阅，任一处卸载即打断另两处）
- **消费 `detected` 字段**：`translate:done` 已返回 `detected`（`app.go:338`），前端在 LangPicker 副行显示 `DETECTED · 日本語`（现状硬编码 `'…'` 且从不更新，`MainTranslate.tsx:115`）
- **取消不丢文本**：修 `sse.go:261`（只在循环结束后赋值 `result.Text`，导致取消/出错时丢弃全部已流式文本）
- **取消不打死推理进程**：修 `sse.go` 三 goroutine 互相等待对方读管道 → 永久 `SIGKILL` 共享 llama-server；修 `TaskDone()` 永不触发 → `activeTasks` 永久 >0 → 后续翻译静默返回空串
- **`deltaBatcher` 双重 close panic**：`app.go:139` 的 `go b.close()` 与 `app.go:316` 的 `batcher.close()` 撞车 → `close of closed channel`；切模型（normal→配音走不同模型触发热切换）必现
- **`Translate` 用 `context.Background()`**（`app.go:307`）→ 改为受应用生命周期约束的可取消 ctx；挂死任务不再永久占住 `activeTasks`（现状 `sse.go:122` `Timeout: 0` 时挂死即永久占用，空闲卸载永不触发）
- **`sse.go:245` `eventBuf` 无上限增长** → 加缓冲上限与超限错误
- 输出区可选文本（现状 `body { user-select: none }`（`tokens.css:82`）使译文 div 无法选中，与「复制对照」自相矛盾）
- 复制译文 / 复制对照 / 重新翻译 / 取消，全部为真实 `<button>` + `aria-label`
- 错误呈现：Toast（error 类不自动消失）+ 输出区内联错误块，含「查看日志」CTA

**Out of Scope**
- 实时翻译（输入停顿 500ms 自动触发）——设计稿里有，本版不做，避免在模型唤醒期产生大量无效请求
- 译文编辑与回填历史（Phase 2）

**验收标准（Given / When / Then）**
- Given 模型已运行，When 输入文本并 Ctrl+Enter，Then 右侧出现流式输出，末尾有 2px 钢笔蓝光标以 1000ms steps(1) 闪烁；`prefers-reduced-motion: reduce` 时光标常亮不闪
- Given 源语言为「自动检测」，When 翻译完成，Then LangPicker 副行显示 `DETECTED · <语言名>`，**不是** `…`
- Given 流式进行到一半，When 按 Esc 或点「取消」，Then 已输出的文本**保留在界面上**（不清空），Toast 提示「已取消」，且 3 秒内再次翻译能返回非空输出
- Given 连续取消 5 次，When 第 6 次翻译，Then 仍返回非空输出，`llama-server` 进程 PID 未发生变化（未被 SIGKILL 重启）
- Given 翻译进行中，When 切到「模型」页再切回，Then 输出继续增长，不丢字符、不重复字符
- Given 后端返回错误，When 翻译失败，Then 出现 error Toast（不自动消失，带关闭按钮）+ 输出区内联错误块 + 「查看日志」CTA；**不出现 `alert()`**
- 边缘情况：模型唤醒中（首次约 10s）→ 输出区显示「模型唤醒中…（首次加载约 10 秒）」，状态栏同步显示 `starting`
- 空状态：未输入时右侧为空，主操作按钮 disabled（`opacity .45` + `aria-disabled`），不显示任何占位提示动画

**设计触点**
- 涉及屏：翻译台（三栏 `260 / 1fr / 320`）
- 涉及组件：Surface、Textarea（`--text-read` 15.5px/1.9，限宽 72ch）、LangPicker、Button、Badge、Toast、Tooltip、Kbd
- 涉及状态：idle / loading（唤醒中）/ streaming / done / error / canceled
- 动效：`motion-plan.json` → `流式译文输出（hero）`（三层动效齐备）、`按钮按下`、`Toast 通知`

**关联 Sitemap 页面**
- `translate` — `/` 翻译台

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.1/5.6/5.9/§3.5
- `spark-output/context/motion-plan.json` → `流式译文输出（hero）`
- 待生成：`frontend/src/stores/jobStore.ts`、`frontend/src/lib/wails.ts`、`frontend/src/pages/Translate.tsx`、`frontend/src/components/ui/Toast.tsx`

**待澄清问题**
- 取消后保留的半截译文是否写入历史？倾向：**不写**（现状 `app.go:340` 只在成功分支写历史，保持），但界面需明确标注「已取消」以免用户误认为完整译文。

---

### S3 · 字幕批量翻译：结果实时可见，取消不丢译文

**Persona**：阿澄
**Job**：导入 SRT/ASS → 批量翻 → 在同一张表里看结果 → 导出
**优先级**：**P0** · 关键假设标记 ⭐

**功能描述**
cue 表是本产品最核心的操作界面。翻译进度与译文必须实时刷进表格；暂停/继续/取消/重试失败/重试选中项都必须真的可用；导出走应用内保存对话框。

**In Scope**
- **后端契约补齐**：`CueProgress` 增加 `Translated` 字段（`engine.go:93-101` 现在没有），并在 `queue.go:142` 的终态 emit 里带上译文
- **绑定 `SubGetDoc`**（后端 `engine.go:175` `GetDoc` 已存在但未暴露）→ 前端可在队列结束后一次性拉取权威结果，作为事件丢包时的兜底
- **进度计数 off-by-one**：`queue.go:145` 的 `done++` 在 `emit`（`:142`）之后 → `p.Done` 永远比实际少 1，300 行跑完显示 `299 / 300`
- **`queue.go:139-144` 在 `e.mu.Unlock()` 之后读 `cue.Index/OffTarget/NeedsCheck`** → 与并发导出/重试构成数据竞争
- **`RetryCues`（`queue.go:253`）先清空 `Translated` 再重译** → 若重译失败，该条**原有译文永久丢失**。改为成功后才覆盖
- **`emit` 节流会整条丢弃非终态事件**（`queue.go:69-71`）→ 行的 `translating` 态可能永远不显示，看起来像卡在 `pending`
- **`TranslateQueue` 同时取 pending 与 failed**（`queue.go:48`）→ 部分失败后点「全部翻译」会静默重跑失败项，UI 需明示这一点
- **取证修正**：取消队列时已完成的译文**保留在后端文档中**（初版审计报告称「取消丢已翻译条目」，复核代码后确认不准确）；真正的故障是前端拿不到——`CueProgress` 无 `Translated` 字段，且 `GetDoc` 未绑定。`DocID`/`Done`/`Total` 由 `emit` 闭包（`queue.go:73-75`）正常填充，此前称「`p.docId` 永远 undefined」亦不准确，已修正
- **虚拟滚动**：行数 > 200 启用（可视行 + 上下各 6 行缓冲），约 40 行内部实现，不引新依赖（现状整表 `map`，千行级卡死）
- **批量选择 + 重试选中项**：接通后端 `SubRetryCues`（`app.go:562` 已绑定，前端无入口，`wailsapi.ts` 连封装都没有）
- **继续按钮接通** `SubResumeQueue`（后端 `queue.go:182` 已实现，前端未调用）
- **暂停/继续/取消/重试的可用性随真实队列态变化**（现状四个按钮永远可点，点了也没反馈）
- **`queue.go:37` 的 `cancel` 在队列结束后从不被调用** → 每次运行泄漏一个 context
- **导出前 `engine.go:183/228` 无锁快照 `doc.Cues`，而 `queue.go:127-137` 持锁写入** → 导出与队列并发时数据竞争
- 8 处 `alert()` 全部替换为 Modal / Toast
- 表格数字列（时间码、计数）`--font-mono` + `tabular-nums`（现状时间码列左右抖动）
- 双语三模式（仅译文 / 双语双行 / 原文另存）用**一个** Segmented 驱动队列与导出（现状同一份三元表达式在 `:99` 与 `:165` 重复两遍，且两处可能不一致）

**Out of Scope（Phase 2，本版不画死控件）**
- cue 行内编辑、±100ms 步进、拆分/合并/插入/删除、重译此条、整体平移、两点校准 —— **后端全部不存在**
- ASS 样式面板、样式库、16:9 预览画布 —— 后端不存在
- 术语库在字幕队列中的注入（`QueueOptions.GlossaryID` 字段存在，注释标 M3；本版接通 UI 但需先确认后端是否真的消费该字段——见待澄清）

**验收标准（Given / When / Then）**
- Given 导入一份 300 行 SRT，When 点「全部翻译」，Then 每行译文在完成后 **≤ 200ms** 出现在该行「译文」列，行状态徽标同步从 `translating` 变为 `done`，工具栏计数 `N / 300` 递增
- Given 队列进行到 150/300，When 点「取消」，Then 已完成的 150 行译文**全部可见且保留**，未开始的行状态回到 `pending`，Toast 提示「已取消，已完成 150 行」（后端已保留，需前端接通 `Translated` / `SubGetDoc` 才可见）
- Given 队列 300 行全部完成，When 观察计数，Then 显示 `300 / 300`（**不是** `299 / 300`）
- Given 某行已有译文，When 对它执行「重试选中项」且重译失败，Then 该行**原有译文仍在**（不被清空）
- Given 队列进行中，When 点「暂停」，Then 当前行完成后停止推进，「继续」变为可用；When 点「继续」，Then 从下一行恢复
- Given 有 8 行 `failed`，When 点「重试失败 (8)」，Then 按钮文案带真实失败数，仅这 8 行重新入队
- Given 勾选 12 行（支持 Shift 连选），When 点「重试选中项 (12)」，Then 仅这 12 行入队（调用 `SubRetryCues`）
- Given 一份 5000 行 ASS，When 打开，Then 首屏渲染 ≤ 500ms，滚动 ≥ 50fps，主线程无 >200ms 长任务
- Given 队列运行中，When 点「导出」，Then 不产生数据竞争（导出等待当前行完成或读取一致快照），导出文件内容与表格所见一致
- Given 选择「原文另存」并导出，When 保存成功，Then 产出两个文件：译文文件 + `<名>.orig.<ext>` 原文文件（后端 `app.go:598-603` 已实现），Toast 列出两个路径
- 边缘情况：导入非字幕文件 / 编码无法识别 → Toast error + 保留当前文档不变，不清空界面
- 空状态：未导入时显示 EmptyState（48px 线性图标 + 标题 + 40ch 正文 + 一个 `lg` 主操作「导入字幕」），**不使用点阵网格背景**；支持拖拽文件到窗口导入（Wails v2 `DragAndDrop` 能力）

**设计触点**
- 涉及屏：字幕工作台（工具栏 + `1.6fr / 1fr`；<1180 时详情转抽屉）
- 涉及组件：DataTable（虚拟滚动 + 批量选择）、Segmented、Button、Badge、Progress、Drawer、Modal、Toast、EmptyState、Surface
- 涉及状态：no-doc / ready / running / paused / done / partial-failed / error
- 动效：`motion-plan.json` → `队列进度条`、`cue 行选中`、`状态徽标切换`、`抽屉`、`空态`。**数据行永不入场动画**

**关联 Sitemap 页面**
- `subtitles` — `/subtitles` 字幕工作台

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.7（DataTable 规格，含虚拟滚动与批量选择）
- `spark-output/context/motion-plan.json` → `队列进度条（字幕批量翻译）`、`cue 行选中`
- 待生成：`frontend/src/pages/Subtitles.tsx`、`frontend/src/components/ui/DataTable.tsx`、`frontend/src/lib/virtualizer.ts`

**待澄清问题**
- `QueueOptions.GlossaryID`（`engine.go:88`，注释「M3 启用术语」）后端是否真的把术语注入提示词？需在实现前用一次真实运行验证；若未消费，则字幕页的术语选择器本版不上（不做死控件）。
- 拖拽导入需要 Wails v2 的 `DragAndDrop.EnableFileDrop` + `OnFileDrop`，会改变 WebView2 的默认拖放行为（可能影响文本拖选）。需实测；若冲突则降级为「导入」按钮 + 文件选择对话框。

---

### S4 · 术语本：让已有后端能力第一次可见

**Persona**：阿澄（一致性）／老周（给全组统一术语）
**Job**：把角色名/专有名词固定下来，翻译时自动遵守
**优先级**：**P0**

**功能描述**
术语本 = 一组 `term → translation`。可创建多本、增删改词条、CSV 导入导出，翻译时选择启用哪一本；译文中命中术语处高亮。

**In Scope**
- 新增「术语」页：两栏 `280px / 1fr`（术语本列表 / 词条 DataTable）
- 接通 `ListGlossaries` / `SaveGlossary` / `DeleteGlossary`（`app.go:389-395` 已绑定，`wailsapi.ts:46-48` 已封装但**从未被 import**）
- 接通 `ExportGlossaryCSV`（`app.go:397`，连前端封装都没有）
- **修 CSV 公式注入**：`app.go:406-409` 只转义了引号，未处理开头的 `=` `+` `-` `@` 与 tab —— 导出文件被 Excel 打开即执行
- **`SaveGlossary` 加事务**：`store.go:289-317` 是 UPDATE + DELETE + N×INSERT 无事务，中途失败会**清空整本术语**
- 翻译台约束抽屉内的术语本选择器 → 写入 `TranslateRequestUI.GlossaryID`（`app.go:251` 字段已存在，前端请求从不传）
- 术语命中高亮：译文区内命中 term 的片段用 `--accent-soft` 底 + 下划线（这是「颜色只属于批注」概念的落点）
- 词条批量粘贴导入（每行 `term<TAB>translation`）

**Out of Scope**
- 术语库层级/继承、词性标注、上下文备注（后端无字段）
- 字幕队列中的术语注入（见 S3 待澄清）
- 术语自动抽取（从历史译文里挖候选）

**验收标准（Given / When / Then）**
- Given 打开术语页且无任何术语本，When 首次进入，Then 显示 EmptyState + 一个主操作「新建术语本」
- Given 新建术语本「FF14」并添加 20 条词条，When 保存后重启应用，Then 20 条完整存在（验证事务落库）
- Given 添加词条过程中数据库写入失败（模拟：磁盘满），When 保存，Then 术语本**保持原样**，不出现「词条被清空」；Toast error 说明原因
- Given 术语本「FF14」含 `エオルゼア → 艾欧泽亚`，When 在翻译台选中该术语本并翻译含该词的句子，Then 请求携带 `glossaryId`，且译文中该词以 `--accent-soft` 底 + 下划线高亮
- Given 词条 translation 以 `=` 开头（如 `=SUM(A1)`），When 导出 CSV 并用 Excel 打开，Then 该单元格**不被当作公式执行**（前置 `'` 或 tab 中和）
- Given 删除术语本，When 点删除，Then 出现 Modal 确认（**不是 `confirm()`**），默认焦点在「取消」上
- 边缘情况：term 或 translation 为空 → 字段级内联错误 + `aria-invalid`，不提交
- 空状态：术语本存在但无词条 → 表格区 EmptyState「还没有词条」+ 「批量粘贴导入」CTA

**设计触点**
- 涉及屏：术语（新页）、翻译台（约束抽屉内的选择器 + 译文高亮）
- 涉及组件：DataTable、Field、Button、Modal、Toast、EmptyState、Drawer、Badge
- 涉及状态：no-glossary / empty-glossary / editing / saving / saved / error
- 动效：`motion-plan.json` → `抽屉`、`Toast 通知`、`模态确认框`

**关联 Sitemap 页面**
- `glossary` — `/glossary` 术语本（**新增导航项**）
- `translate` — `/`（约束抽屉）

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.7（DataTable）、§5.9（Modal/Drawer/Toast）
- 待生成：`frontend/src/pages/Glossary.tsx`、`frontend/src/stores/glossaryStore.ts`、`frontend/src/components/ConstraintDrawer.tsx`

**待澄清问题**
- 术语命中的判定由前端做（字符串匹配）还是后端返回命中位置？前端匹配简单但对形态变化（日文活用）失效；后端 `translator` 已有 `Constraints.Glossary` 注入，但不返回命中区间。倾向：**前端做纯字符串匹配高亮**，并在 tooltip 里注明「高亮为字面匹配，实际约束由模型执行」，避免给用户错误保证。

---

### S5 · 配音模式与约束抽屉

**Persona**：阿澄（做配音/翻唱字幕）
**Job**：译文要卡在音节数内，还要控制文体与硬约束
**优先级**：**P1**

**功能描述**
配音模式（Homura 模型）要求译文音节数贴近目标值；约束抽屉承载 4 条硬约束 + 5 条软预设 + 文体域。

**In Scope**
- 配音模式条：开关（Switch）+ 目标音节数（数字 Field）+ 「目标 vs 实测」音节读数 + 「重新生成」按钮
- 请求真的带上 `dubbing` / `syllables` / `glossaryId`（`TranslateRequestUI` 三个字段都已存在（`app.go:246-251`），前端请求体（`MainTranslate.tsx:108-112`）一个都没传）
- 配音模式自动切到 Homura 模型（后端 `ModelForMode`（`app.go:181-186`）已实现），UI 需明示「已切换到 Index-Homura-2B」并说明显存影响
- 约束抽屉（右侧 320px，`DESIGN.md` §6.3）：4 硬约束 checkbox + 5 软预设 + 文体域 Field
- 实测音节与目标不符时的提示：Badge `warn` + 「近似达标」文案 + 一键「重新生成」

**Out of Scope**
- 音节数硬截断/自动重写（后端无此能力）
- 配音时间轴对齐（需要视频时长，Phase 2）

**验收标准（Given / When / Then）**
- Given 打开配音模式并设目标音节 12，When 翻译，Then 请求含 `dubbing: true, syllables: 12`，状态栏与模型徽标显示 Index-Homura-2B
- Given 翻译完成且实测音节 15 ≠ 目标 12，When 结果返回，Then 译文区上方出现 `warn` Badge「实测 15 / 目标 12 · 近似达标」+ 「重新生成」按钮（消费后端 `targetSyllables` / `actualSyllables`，`app.go:336-337` 已返回但前端从不读取）
- Given 切换到配音模式时 Homura 模型未下载，When 打开开关，Then 出现 Modal 说明需要先下载 Homura（约 2.08GB）+ 「去模型中心」CTA，开关**不进入开启态**
- Given 打开约束抽屉，When 按 Esc，Then 抽屉以 240ms 退场，焦点回到触发按钮
- 边缘情况：目标音节输入 0 或负数 → 字段级内联错误，不发请求
- 空状态：抽屉内未选任何约束时显示「未启用约束（模型自由发挥）」，不显示空白

**设计触点**
- 涉及屏：翻译台（配音模式条 + 右侧抽屉）
- 涉及组件：Drawer、Switch、Field（数字）、Badge、Checkbox、Button、Tooltip
- 动效：`motion-plan.json` → `抽屉`、`状态徽标切换`

**关联 Sitemap 页面**
- `translate` — `/`

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.9（Drawer 360/420）
- 待生成：`frontend/src/components/DubbingBar.tsx`、`frontend/src/components/ConstraintDrawer.tsx`

**待澄清问题**
- 4 条硬约束与 5 条软预设的具体内容需从 `translator.Constraints` 的实际字段反推，不能照抄 mockup 文案（mockup 是设计稿，字段可能不存在）。**实现前必须先读 `internal/translator/prompt_translate.go` 确认后端真的消费这些约束**，否则不渲染对应控件。

---

### S6 · 模型中心可信

**Persona**：老周（主）／阿澄（显存不足时）
**Job**：下对模型、知道它真的完整、显存不够时知道怎么降
**优先级**：**P0**

**功能描述**
三张模型卡 + VRAM 概览 + 下载源条。下载必须可验证完整、可断点续传、可取消；本地已有 gguf 可导入并归类；删除不能误删目录。

**In Scope**
- **下载完整性 fail-closed**：`download.go:403-410` 现状是 `SHA256SUMS.txt` 取不到或无该条目时，未校验文件照样改名就位并被 `llama-server` 执行。改为：取不到校验和 → **拒绝落盘**，明确报错并给出「手动放入 models/ + 在模型中心指定」的替代路径
- **下载体积上限**：`download.go:392` 当 `ContentLength == -1` 时 `total <= 0` → 体积检查整个跳过（审计实测到 764MB）。改为无 Content-Length 时按已下载字节硬上限熔断
- **`isAllowedURL`（`download.go:63`）仍接受 `http:`** → 收紧为仅 `https`
- **`DeleteModel` 校验 quant**：`manager.go:482` 现状 `spec.Files[quant]` 未命中即得 `""`，`filepath.Join(ModelsDir(), "")` = models 目录本身 → `os.Remove` 打到目录。改为未命中直接返回错误
- **`AssignUnknown` 不是任意文件移动原语**：`manager.go:454-470` 对完全由调用方给的路径 `os.Rename`，无归拢检查、无 `.gguf` 检查；`sanitizeGGUFPath`（`args.go:59`）声明了却从未被调用。改为：路径必须已位于 `models/` 内 + 必须 `.gguf` 后缀 + 调用 `sanitizeGGUFPath`
- **本地导入 UI**：接通 `ListUnknownModels` + `AssignUnknown`（均已绑定，无入口），提供「从本地导入 .gguf」
- **下载进度事件节流**：`app.go:155` 每个 chunk 都 `EventsEmit`，`appStore.ts:65` 又对每个 progress 事件调一次 `refreshStatus()` → 下载期间事件风暴。改为 progress 事件节流 ≥ 100ms，且 `refreshStatus` 不与 progress 事件耦合
- 模型卡状态真实化：`STATE_META`（`ModelHub.tsx:18-26`）七态与后端实际返回值对齐；不再用 `m.id === 'translate' ? 'T' : ... : 'H'` 这种「非 T 非 N 即 H」的三元（未知模型会显示成 H）
- 卡片栅格响应式 1/2/3 列（现状 `repeat(3, 1fr)` 写死，`DESIGN.md` §6.2）
- 存储路径不再硬编码 `.\models\` 文案（`ModelHub.tsx:88-90`），改为读真实路径
- 下载源条从静态 Chip（`ModelHub.tsx:228-237`）改为真实的源偏好 Segmented（写回 `config.Download.SourcePref`）+ 双源探测延迟读数

**Out of Scope**
- 模型自动更新/版本比对
- 自定义模型（非 Index 系列）接入

**验收标准（Given / When / Then）**
- Given 网络中间人替换了 gguf 内容但保留了 200 响应，When 下载完成，Then 文件**不落盘**，Toast error「校验失败」，`models/` 内无残留 `.gguf`
- Given `SHA256SUMS.txt` 不可达，When 下载，Then 拒绝落盘并提示替代路径（手动放入 + 指定），**不静默接受未校验文件**
- Given 服务端不返回 Content-Length，When 下载超过硬上限，Then 连接被熔断，已下载部分保留为 `.part` 可续传
- Given `DeleteModel("translate", "不存在的档位")`，When 调用，Then 返回错误且 `models/` 目录**依然存在**（回归测试必须覆盖这条）
- Given `AssignUnknown("C:\\Windows\\System32\\drivers\\etc\\hosts", ...)`，When 调用，Then 返回错误，不发生任何文件移动
- Given `models/` 内有一个未被识别的 `my-model.gguf`，When 打开模型中心，Then 出现「未归类模型」区，可指定为 Translate/Nailong/Homura 之一 + 量化档位
- Given 正在下载，When 观察 5 秒，Then `orch:event`/`model:progress` 事件数 ≤ 50（节流生效），界面不卡顿
- Given 窗口宽度 1180 / 1380 / 1680，When 打开模型中心，Then 卡片列数分别为 1 / 2 / 3
- 边缘情况：磁盘剩余空间 < 模型体积 → 下载前即报错，不开始下载
- 空状态：`models/` 为空 → EmptyState + 「下载 Index-Translate-2B」+「从本地导入」双 CTA

**设计触点**
- 涉及屏：模型中心
- 涉及组件：Surface、Progress、Badge、Segmented、Button、Modal（删除确认）、Toast、EmptyState、Tooltip
- 涉及状态：not-downloaded / downloading / verifying / ready / loading / running / sleeping / crashed / unknown-unassigned
- 动效：`motion-plan.json` → `模型卡入场`（**只首次进入播放一次**）、`下载进度条`、`状态徽标切换`

**关联 Sitemap 页面**
- `models` — `/models` 模型中心

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §6.2（断点）、§5.7
- `spark-output/context/motion-plan.json` → `模型卡入场`、`下载进度条`
- 待生成：`frontend/src/pages/Models.tsx`、`frontend/src/components/ModelCard.tsx`

**待澄清问题**
- 「校验失败即拒绝落盘」会让国内镜像不稳定时的下载体验变差。是否提供「我知道风险，仍然使用」的显式二次确认？倾向：**提供**，但二次确认必须输入模型名以防止误点，且该次决定写入日志（本地）。

---

### S7 · 设置真的生效

**Persona**：阿澄（夜间/字号）／老周（-ngl、ctx、线程、日志）
**Job**：改了就要生效，不能是装饰品
**优先级**：**P1**

**功能描述**
五组设置：推理 / 资源 / 下载 / 外观与数据 / 关于。每个控件都真实绑定 `config` 并即时生效。

**In Scope**
- **消灭死控件**：`Settings.tsx:101`（关闭程序时）、`:137`（主题）、`:140`（界面字号）三个无 `onChange` 的 Segmented
- **主题接通**：`config.Appearance.Theme`（`dark|light|system`）字段已存在但从未被前端使用 → 实现三档切换，`<html data-theme>` 驱动，`SetConfig` 后立即生效无需重启
- **界面字号接通**：`config.Appearance.FontSize`（`small|standard|large`）→ 驱动 `--text-*` 缩放系数（0.92 / 1.0 / 1.1），仅影响阅读区与正文，不动 micro 标签
- **修 `Row` 组件定义在组件体内**（`Settings.tsx:26-34`）→ 每次 render 都是新函数身份，React 卸载重挂整棵子树，输入框打字时抖动/失焦。提到模块顶层
- **`SetConfig` 全量替换的丢配置风险**：`app.go:513` 直接 `a.cfg = cfg`；`SetActiveModel`（`app.go:451-452`）也写 `a.cfg.ActiveModel` 后回存 → 两处并发写会互相覆盖（例如在设置页保存的同时切换当前模型，会丢掉刚切的模型）。要求：**任何写入路径都不得丢失其他路径刚写的字段**（实现机制见设计 spec）
- **`a.cfg` 无锁共享**：`app.go:33-45` 的 `cfg` 被 `SetConfig`/`SetActiveModel`（前端线程）写，被 `idleWatch`/`buildArgs`（`args.go:21,26`）/`sourcePref`（`manager.go:136`）/`ModelForMode` 读，无锁 → string header 撕裂，`-c` 参数可能取错。加独立 mutex + 返回快照
- 空闲释放 slider 与 switch 的语义统一（现状 slider `min=1` 无法选「常驻」，switch 又硬写 5 或 0，会丢掉用户滑到的值）
- 关闭行为：如实呈现为「退出即释放（唯一实现）」的**只读说明行**，不是假装可选的 Segmented
- 一键收集日志：显示真实产物路径 + 「打开所在目录」；**并修隐私问题**（见 §7 R-6）
- `history.maxEntries` 变更后立即触发一次 `TrimHistory`

**Out of Scope**
- 自定义快捷键映射
- 插件/扩展机制

**验收标准（Given / When / Then）**
- Given 在「GPU 层数卸载」输入框内连续输入 `-1`，When 每敲一个字符，Then 输入框**不失焦、不抖动**（Row 提出组件体后）
- Given 主题切到「浅色」，When 点击，Then 全界面 ≤ 100ms 内换为浅色 token，重启后仍为浅色（已落库）
- Given 主题设为「跟随系统」，When 操作系统切换深色，Then 应用实时跟随（监听 `prefers-color-scheme`）
- Given 界面字号设为「大」，When 查看翻译台，Then 阅读区字号为 15.5×1.1 ≈ 17px，而 micro 标签仍为 11px
- Given 只修改「下载源」并保存，When 重新读取 config，Then 推理/资源/外观/历史各组字段**均未被重置**（patch 合并生效）
- Given 应用在跑推理任务，When 修改 ctx 档位，Then 不产生数据竞争，新档位在下次模型加载时生效并明确提示「需重新加载模型」
- Given 空闲释放设为 0，When 查看状态栏，Then 显示「常驻加载」而非倒计时
- Given 点「一键收集打包」，When 完成，Then 显示 zip 真实路径 + 「打开所在目录」按钮
- 边缘情况：`maxEntries` 输入 0 或负数 → 后端 `Normalize()` 回落 2000（`config.go` 已实现），前端显示回落后的值而非用户输入的错误值

**设计触点**
- 涉及屏：设置（单列 `max-width 720px` 居中）
- 涉及组件：Surface、Field（数字）、Segmented、Switch、Slider、Button、Badge、Toast、Tooltip
- 动效：`motion-plan.json` → `按钮按下`、`状态徽标切换`（设置页几乎无动效，符合「稀疏」）

**关联 Sitemap 页面**
- `settings` — `/settings` 设置

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §9（主题切换）
- 待生成：`frontend/src/pages/Settings.tsx`（重写）、`frontend/src/theme/tokens.css`、`frontend/src/components/ui/Row.tsx`（模块顶层）

**待澄清问题**
- 界面字号缩放是否会破坏 `72ch` 限宽与断点计算？需要在「大」档下重测 1180 宽度是否仍不溢出。

---

### S8 · 全键盘可达 + 命令面板

**Persona**：阿澄（长时间作业，手不离键盘）
**Job**：不碰鼠标完成全流程
**优先级**：**P1**

**功能描述**
所有可交互元素是真实语义元素，有可见焦点环，Tab 序符合视觉顺序；Ctrl+K 命令面板承担「界面简洁」与「能力齐全」之间的桥梁。

**In Scope**
- 全部原语改为真实语义元素（`DESIGN.md` §5 已规定角色）：Rail 项 = `<button>`；Segmented = `role="radiogroup"`；Switch = `role="switch"`；LangPicker = `role="listbox"` + 搜索框；DataTable 行 = `role="row"` + 可选中
- 焦点环：`:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`；禁止无替代的 `outline-none`（现状 6 处）
- Tab 序：rail → 页面内容（视觉顺序）→ 状态栏
- Esc 关闭最上层浮层（现状 LangPicker 无 Esc 处理）；无浮层时 Esc 取消进行中任务
- **命令面板（Ctrl+K）**：跳页 / 切模型 / 切术语本 / 重试失败 cue / 切主题 / 打开日志目录 / 收集日志。模糊匹配，↑↓ 选择，Enter 执行
- 快捷键提示：Rail tooltip 与命令面板均显示（Ctrl+Enter 翻译、Esc 取消、Ctrl+Shift+C 复制译文、Ctrl+K 面板、Ctrl+Q 退出）
- **修 `Ctrl+Q` 在输入框内被劫持**（`App.tsx:50-60` 全局监听，未判断 `e.target` 是否为输入元素）
- **修 `Ctrl+Shift+C` 在无译文时静默失败**（`MainTranslate.tsx:135-138`）→ 无译文时 Toast 提示

**Out of Scope**
- 自定义快捷键
- 屏幕阅读器深度适配（本版做到 axe 0 critical/serious + 语义正确，不做 NVDA 逐屏走查）

**验收标准（Given / When / Then）**
- Given 焦点在页面任意位置，When 按 Ctrl+K，Then 命令面板以 180ms 入场并获得焦点；When 输入「模型」，Then 匹配到「前往 模型中心」；When Enter，Then 跳页且面板关闭、焦点回到 rail 的对应项
- Given 仅用键盘，When 依次执行「导入字幕 → 选目标语言 → 全部翻译 → 导出」，Then 全流程可完成，每一步都有可见焦点环
- Given 焦点在 LangPicker 的搜索框，When 按 Esc，Then 弹层关闭且焦点回到触发器
- Given axe 扫描 1180 / 1366 / 1680 × light / dark 六组，When 运行，Then critical = 0 且 serious = 0
- Given 光标在译文输入框内，When 按 Ctrl+Q，Then 不触发退出（或触发前二次确认）——按实现选择，但**不得静默丢输入**
- 边缘情况：命令面板打开时又有 Toast 弹出 → Toast 不抢焦点
- 空状态：命令面板无匹配 → 「无匹配命令」+ 输入回显

**设计触点**
- 涉及屏：全部
- 涉及组件：CommandPalette（新）、全部原语
- 动效：`motion-plan.json` → `语言选择弹层`（面板沿用 quick 档，见 open_questions 第 2 条）

**关联 Sitemap 页面**
- 全部页面

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.12（焦点环）、§7（a11y 契约 8 条）
- 待生成：`frontend/src/components/CommandPalette.tsx`、`frontend/src/lib/shortcuts.ts`

**待澄清问题**
- 命令面板宽 560，按「距离缩放时长」规则可能应取 standard 档 320ms 而非 quick 档 180ms。实现后在真实尺寸下确认。

---

### S9 · 进程与资源安全（后端为主，用户可见面为状态栏与错误提示）

**Persona**：老周（排错）／阿澄（不想遇到「软件坏了」）
**Job**：不崩溃、不冻结、不留孤儿进程、不误删文件
**优先级**：**P0**

**功能描述**
修掉会导致崩溃、死锁、孤儿进程、误删的后端缺陷。用户可见面：状态栏如实反映编排态，错误有明确提示而非静默失败。

**In Scope（12 项 P0 + 用户可感知的 P1）**
1. `app.go:102/139/316` — `deltaBatcher.stop` 双重 close → panic 杀进程（切模型必现）。用 `sync.Once` 或在 `b.mu` 下加 `closed` 标志
2. `sse.go` — 取消翻译时三 goroutine 互等对方读管道 → 永久 `SIGKILL` 共享 llama-server；`TaskDone` 永不触发 → 后续翻译静默返回空串
3. `orchestrator.go:194/238/319` — `o.cond.Wait()` **全仓库无任何 `Broadcast/Signal`** → 空闲卸载期间到来的调用永久停住并持有 `opMu`，编排与所有状态绑定一起死锁
4. `manager.go:245-253` × `app.go:146` + `orchestrator.go:138` — **AB-BA 死锁**（`List()` 持 `m.mu` 取 `opMu`；`OnEvent` 持 `opMu` 调 `MarkRan()` 取 `m.mu`）
5. `app.go:33-45` — `a.cfg` 无锁共享（见 S7）
6. `winproc/process_windows.go:82-88` — 越界读：`retLen < 16` 时 `uint16(负数)` 变巨值 → `unsafe.Slice` panic；它在 Wails 起来**之前**遍历所有 PID 跑，无 recover → 启动即崩
7. `main.go:58-67` — 单实例锁 **fail-closed**：`CreateMutex` 任何错误都走「已有实例」分支 → 激活一个不存在的窗口然后退出，程序根本起不来。改为只把 `ERROR_ALREADY_EXISTS` 当「已有实例」
8. `queue.go:139-144` — 解锁后读 `cue` 字段（数据竞争）；`:145` `done++` 在 emit 之后（计数 off-by-one）；`:253` `RetryCues` 先清空 `Translated` 再重译（重译失败即永久丢失原译文）；`:37` `cancel` 在队列正常结束后从不被调用（context 泄漏）
9. `manager.go:482` — `DeleteModel` 不校验 quant → `os.Remove` 打到 models 目录（见 S6）
10. `manager.go:454-470` — `AssignUnknown` 任意文件移动（见 S6）
11. `download.go:403-410` + `:392` + `:63` — 完整性校验 fail-open、无体积上限、允许 `http:`（见 S6）
12. `app.go:406-409` — CSV 公式注入（见 S4）

**用户可感知的 P1**
- `sse.go:261` — 只在循环后赋值 `result.Text` → **取消/出错时丢掉全部已流式文本**（见 S2）
- `sse.go:122` — `Timeout: 0` → 挂死任务永久占住 `activeTasks` → 空闲卸载永不触发
- `sse.go:245` — `eventBuf` 无上限增长
- `store.go:289-317` — `SaveGlossary` 无事务 → 中途失败清空整本术语（见 S4）
- `store.go:166` — `ListHistory` 的 `(page-1)*pageSize` 溢出成负 OFFSET
- `engine.go:183/228` — 导出时无锁快照 `doc.Cues`，与队列写入竞争（见 S3）
- `queue.go:37` — `cancel` 队列结束后从不被调用 → 每次运行泄漏一个 context
- `queue.go:140` — 无锁读 `cue`
- `app.go` 一批绑定缺 `ensureReady()` 门禁 → 装配完成前调用即 nil 解引用（`DeleteHistory:381`、`StarHistory:382`、`ClearHistory:385`、`ListGlossaries:389`、`SaveGlossary:391`、`DeleteGlossary:395`、`ExportGlossaryCSV:397`、`ListUnknownModels:426`、`CancelDownload:438`、`DeleteModel:440`、`KeepAlive:456`、`AssignUnknown:458`、`SetConfig:511`、`SubPauseQueue:552`–`SubExport:569`、`State/CurrentModel/EndpointPort/IdleSeconds/ActiveTasks:229-240`、`GetConfig:508`）。注：`DisablePanicRecovery` 未设置，Wails 会 recover 成 JS 错误而非崩溃，但功能仍是坏的；`PrepareExit:650`（`a.log` nil）与 `Quit:661`（nil ctx）例外
- `startup` 在 `:131-149` 注册的回调里使用 `a.tr/a.sub/a.models`，而它们在 `:153/166/195` 才被赋值
- `spawn_windows.go:85-89` — `CREATE_NO_WINDOW` 使子进程无控制台 → `SendCtrlBreak`（`console_windows.go:41`）**永远失败** → 每次停止/空闲卸载都退化为 `TerminateProcess`（约 3.3s 等待）
- `spawn_windows.go` — 子进程在 `CreateProcess` **之后**才加入 job → 崩溃时可能留下孤儿；改用 `CREATE_SUSPENDED`
- `winproc/process_windows.go:300` — `cleanupProcLocked` 关闭 `procHandle` 时 watcher goroutine 可能仍阻塞在其 `WaitForExit` 上（handle use-after-close）
- `winproc` — `watchInfinite` 被当 `time.Duration` 传 → 实际是 **2147ms 而非 INFINITE**
- `envprobe.go:49-55/158/180` — PATH-cwd 相对的 `exec.Command("nvidia-smi"/"reg")` 且**无超时**；`QueryVRAM` 被 `GetSystemStatus`（`app.go:483`）在每次状态轮询（5s）时调用 → 每轮 spawn 进程，且 `nvidia-smi` 挂住即永久阻塞绑定
- `console_windows.go:30-34` — 永久吞掉整个应用生命周期的 SIGINT/SIGTERM
- `astisub.go` — 从不转换 ASS `\N` ↔ `\n`（解析保留 `\N`，`textToLines` 按 `\n` 切）→ **多行 ASS cue 误译**
- `astisub.go:278` — `patchASSHeaders` 总输出 V4+ 的 23 字段 `Format:` 行 → 破坏 v4.00 SSA
- `lrc.go:76` — `offset` 可使 `startMs` 变负
- `lrc.go:102` — `serializeLRC` 外层条件是 no-op（永远优先译文，忽略双语模式）
- `encoding.go:18` — 漏 UTF-16 BE（被误判为 GBK）；UTF-32 LE BOM 被误匹配为 UTF-16
- `engine.go:128` — `os.ReadFile` 无大小上限；`docs` map 永不淘汰
- `engine.go:277-286` — `ExportOriginal` 先序列化再把第一个结果丢弃
- 状态栏如实反映编排态（`idle/starting/running/stopping/crashed`），崩溃时给可操作提示（查看日志 / 重新提交）

**Out of Scope**
- 死代码清理（`ImportGGUF`、`docpipeline` 整包、`paths.PartDir`、`textBytes`）—— 用户选择「P0 + 可感知 P1」，不含全量清理。**但 `sanitizeGGUFPath` 例外**：它是安全修复的一部分，必须接上（见 S6）
- `-race` 验证：`go test -race` 需要 cgo，而 ADR-001 明确关闭 cgo → **上述竞态无法用工具验证**。改用带同步屏障的确定性测试，且不声称「race detector 通过」

**验收标准（Given / When / Then）**
- Given 应用启动，When `CreateMutex` 因权限返回错误（非 `ERROR_ALREADY_EXISTS`），Then 应用**正常启动**（不静默退出）
- Given 翻译进行中，When 从普通模式切到配音模式（触发热切换），Then 不发生 `close of closed channel` panic，进程存活
- Given 空闲卸载正在进行（`state == stopping`），When 前端调 `GetSystemStatus`，Then 在 ≤ 3s 内返回（不死锁）
- Given 模型中心打开（触发 `List()`）同时编排器发出状态事件（触发 `MarkRan()`），When 并发发生 100 次，Then 无死锁
- Given 启动时系统中存在大量进程，When `SweepResiduals` 遍历 PID，Then 不 panic（`retLen < 16` 分支被正确处理）
- Given 翻译被取消，When 立即再次翻译，Then 返回非空输出，`llama-server` PID 不变
- Given 空闲卸载触发，When 有任务正在推理，Then 不出现「译文中途被 SIGKILL」
- Given `DeleteModel` 传入未知 quant，When 调用，Then 返回错误且 `models/` 目录存在
- Given 状态栏，When 编排态为 `crashed`，Then 显示 danger Badge + 「查看日志」CTA，不显示「运行中」
- 边缘情况：`llama-server` 启动失败（缺 DLL）→ 状态栏 `crashed` + Toast 指向日志，不无限重试
- 回归基线：`go build ./...` / `go vet ./...` / `go test ./...` 三者保持全绿（现状已全绿）

**设计触点**
- 涉及屏：状态栏（全部页面常驻）、模型中心、Toast
- 涉及组件：Badge、Button、Toast、Tooltip
- 动效：`motion-plan.json` → `状态徽标切换`（running 态呼吸为 ambient 层，2000ms sine）

**关联 Sitemap 页面**
- 全部

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.13（StatusBar 规格）
- 待生成：后端修复无设计资产；`frontend/src/components/StatusBar.tsx`（重写）

**待澄清问题**
- `CollectLogs` 的脱敏承诺是否可兑现（见 §7 R-6）。若不能，设置页的文案必须改为「日志包含待翻译文本，请勿公开分享」。

---

### S10 · 大文件与长队列不卡死

**Persona**：阿澄（几千行游戏汉化文本）
**Job**：打开大文件不卡、跑长队列不崩
**优先级**：**P1**

**功能描述**
字幕解析与渲染在千行级仍可交互；后端不再把整个文件读进内存。

**In Scope**
- 前端：cue 表虚拟滚动（S3 已含）
- 后端：`engine.go:128` `os.ReadFile` 加大小上限（超限给出明确错误 + 上限值），或改流式解析
- `docs` map 加淘汰（现状永不释放，长时间使用内存单调增长）
- `sse.go:245` `eventBuf` 上限（S2 已含）
- 下载写盘不再整体缓冲（审计发现 764MB 文件被完整读入内存的路径）
- 长队列的进度事件节流（S6 已含）

**Out of Scope**
- 增量/断点续翻（队列中断后从断点恢复）—— Phase 2

**验收标准（Given / When / Then）**
- Given 一份 5000 行 ASS，When 打开，Then 首屏 ≤ 500ms，滚动 ≥ 50fps
- Given 一份 200MB 的非字幕文件被误选，When 打开，Then 返回明确错误（含上限值），不把文件读进内存、不 OOM
- Given 连续打开 20 份字幕文档，When 观察进程内存，Then 不单调增长（`docs` 淘汰生效）
- Given 一次 3000 行队列翻译，When 完成，Then 无 goroutine 泄漏（`queue.go:37` 的 context 已释放）

**设计触点**
- 涉及屏：字幕工作台
- 涉及组件：DataTable、Skeleton、Toast（超限错误）

**关联 Sitemap 页面**
- `subtitles`

**已生成的设计资产**
- `docs/03-GUI设计图/DESIGN.md` §5.7（虚拟滚动阈值 200 行）
- 待生成：`frontend/src/lib/virtualizer.ts`

**待澄清问题**
- 文件大小上限定多少？建议 32MB（覆盖任何真实字幕文件），需在错误文案里写明。

---

### 未列入本版的 Stories（Phase 2）

| Story | 为什么延后 |
|---|---|
| cue 行内编辑 / ±100ms 步进 / 拆分 / 合并 / 插入 / 删除 / 重译此条 | **后端全部不存在**，需先写字幕引擎能力 |
| 整体平移 / 两点校准 | 同上 |
| ASS 样式面板 / 样式库 / 16:9 预览画布 | 同上 |
| 长文档翻译（Nailong） | 后端 `DocTranslate` 返回「M5 里程碑提供」，`docpipeline` 整包不可达 |
| 实时翻译（输入停顿 500ms 自动触发） | 会在模型唤醒期产生大量无效请求 |
| 译文编辑与回填历史 | 依赖 cue 编辑能力 |
| 队列断点续翻 | 依赖队列状态持久化 |
| 托盘驻留 | `config.CloseBehavior` 有枚举值无实现 |
| 死代码全量清理 | 用户选择「P0 + 可感知 P1」范围 |
| 术语自动抽取 | 无后端 |

---

## 7. Constraints & Risks

### 技术约束

- **Windows only**：`winproc` / `spawn_windows.go` / `envprobe_windows.go` 全是 Windows 专属；`explorer` 硬编码在 `app.go:631`
- **Wails v2 + WebView2**：绑定层是 `window.go.main.App`，事件是 `window.runtime.EventsOn`；`EventsOff(name)` 会摘掉该事件名的**全部**订阅者（S2 的事件层重构即为此）
- **离线**：除模型下载外零网络请求。**禁止外链字体/CDN**（旧 `mockups.html` 用了 Google Fonts `<link>`）
- **CGO_ENABLED=0**（ADR-001）→ **`go test -race` 不可用**，竞态类修复无法用工具验证
- **便携布局**：`models/` `logs/` 随项目文件夹，不写注册表/ProgramData
- **不引新前端依赖**：虚拟滚动自实现（约 40 行）；现有技术栈 React 18 + TS 5.7 + Tailwind v4 + zustand 5 + lucide-react + Vite 6
- **最小窗口 1180×700**（`main.go:88-89`），设计必须在 1180 宽下成立

### 设计约束（不可妥协）

- `docs/03-GUI设计图/DESIGN.md` 全部条款，特别是：三级文本 token 均 ≥4.5:1（两主题）；面板无边框无阴影；禁止任意值/写死色值（lint 拦在构建期）；所有可交互元素为真实语义元素 + 可见焦点环；禁止 `alert/confirm/prompt`；禁止数据行入场动画；禁止死控件与假入口
- `prefers-reduced-motion` 全覆盖（单一媒体查询块内，禁止散落判断）
- `prefers-color-scheme` 跟随（`system` 档）

### 数据与隐私

- **全本地**：SQLite（历史、术语、配置）+ 文件系统（模型、日志），均在项目文件夹内
- 个人数据 = 用户待翻译的正文、术语表、历史记录。**零遥测、零上报**（本产品刻意不设计埋点，见 §6 抬头）
- 唯一网络行为 = 模型下载（HF / ModelScope），须仅 `https`、允许列表域、IP pin 防 DNS rebinding（后端已具备），完整性校验须 fail-closed（S6）
- **合规风险**：`CollectLogs` 声称脱敏但可能打包含提示词原文的 `llama-server.out.log`（R-6）

### 关键风险表

| ID | 风险 | 可能性 | 影响 | 缓解措施 |
|---|---|---|---|---|
| **R-1** | 关键假设错：用户不愿为「本地 + 术语一致」承受 1.3GB 下载与显存门槛 | M | **H** | 最便宜的测试：引导里提供不阻塞的「稍后下载」出口并本地记录点击（不上报）；同时把「从本地导入 .gguf」提到与下载同等显眼（S1/S6） |
| **R-2** | 竞态类修复（P0-3/4/5）无法用 `-race` 验证，改完仍可能残留 | **H** | H | 用带同步屏障的确定性测试复现（先写能稳定失败的测试，再修）；`opMu`/`m.mu` 的加锁顺序写成文档化不变量并加断言；交付前手工压测（并发 `List()` + 状态事件 100 次） |
| **R-3** | `cond.Wait()` 无 Broadcast 的死锁是**全仓库无 Signal**，修法可能牵动编排器状态机 | M | H | 优先「在 `setState` 内 Broadcast」的最小改动；若状态机不允许，退化为带超时的重试轮询，并在 spec 里记录取舍 |
| **R-4** | 推翻 v1.0 视觉后，已实现的 6 屏全部要重写，工作量可能被低估 | **H** | M | 按 S1→S2→S3→S6→S4→S9→S7→S8→S10 顺序交付，每个 Story 独立可验收；先做原语库（`components/ui/`）再做页面，避免边写页面边改原语 |
| **R-5** | 「大面积留白」与 cue 表密度冲突，用户实际用起来觉得浪费屏幕 | M | M | 已用「两态一系统」化解（阅读态留白 / 操作态密度，`DESIGN.md` §1 第 3 条）；交付后在 1366×768 实测可见行数，若 < 15 行则把 `--h-row` 从 32 降到 28 |
| **R-6** | `CollectLogs` 把含提示词原文的 `llama-server.out.log` 打进「脱敏」包 → 隐私承诺破产 | M | **H** | 交付前**必须验证**该日志实际内容；若含正文，改为默认不打包该文件（或做正则脱敏），并同步修改设置页文案。审计已标注此项「未验证」 |
| **R-7** | 模型下载改 fail-closed 后，国内镜像不稳定会让下载成功率下降 | M | M | 保留双源择优 + 断点续传；提供「我知道风险，仍然使用」的显式二次确认（需输入模型名，决定写入本地日志） |
| **R-8** | Wails v2 `DragAndDrop` 与 WebView2 文本拖选冲突 | M | L | 先实测；冲突则降级为「导入」按钮 + 系统文件对话框（S3 已含降级路径） |
| **R-9** | 界面字号「大」档破坏 `72ch` 限宽与 1180 断点 | M | L | 在「大」档下重测 1180 宽度是否溢出（S7 待澄清） |
| **R-10** | 旧 `mockups.html` 仍被当作实现依据（它渲染的是作废的 v1.0 设计） | M | M | 已在 `设计系统规范.md` 顶部加 SUPERSEDED 横幅并指向 `DESIGN.md`；`mockups.html` 保留为历史参考，PRD 与 spec 一律以 `DESIGN.md` 为准 |

### 已识别但未修复的问题（进 backlog，不在本版）

- `store.go:49` `migrate` 在 `user_version == 1` 时跳过建表
- `ImportGGUF`、`docpipeline` 整包、`paths.PartDir`、`sse.go:190` `textBytes` 不可达（用户选择不清理死代码）
- `app.go:215/216/271/340/345/452/621`、`manager.go:215/221` 的 `_ =` 忽略错误
- `envprobe.go:99` 遗留的 no-op 注释分支
- `app.go:109` `cleanedResiduals` 参数未使用
- `engine.go:277-286` `ExportOriginal` 序列化后丢弃首个结果

---

## 8. Release Approach

### 推荐顺序（先发关键假设 + 先修「会让人放弃产品」的缺陷）

| 批次 | Story | 理由 |
|---|---|---|
| **0. 地基** | 原语库 `components/ui/` + `theme/tokens.css`（两主题）+ `lib/wails.ts` 事件层重构 + lint 防线 | 后面每一屏都依赖它。先做原语能避免「边写页面边改原语」的返工（R-4） |
| **1. 止血** | **S9**（12 项 P0）+ **S2** 的后端部分（取消不打死进程、不丢文本） | 这些是「软件坏了」级别：启动即崩、取消后永久失效、随机 panic、死锁冻结。任何视觉改进都会被它们抵消 |
| **2. 关键假设** | **S1**（引导不再拦路、不自动下载） | ⭐ 关键假设验证点。同时它是首次体验的第一道门 |
| **3. 核心价值** | **S3**（字幕结果实时可见、取消不丢译文、虚拟滚动、批量重试） | 产品的核心 job。现状「翻完看不到译文」等于功能不存在 |
| **4. 差异化** | **S6**（模型中心可信 + 本地导入）→ **S4**（术语本 UI） | S6 是 S1 的下游（下载必须可信）；S4 是竞争差异化所在 |
| **5. 完整度** | **S7**（设置生效 + 主题/字号）→ **S8**（键盘可达 + 命令面板）→ **S10**（大文件） | S7 的主题切换依赖地基的两套 token；S8 依赖全部原语已是语义元素 |
| **6. 增强** | **S5**（配音模式 + 约束抽屉） | P1，且需先确认后端真的消费约束字段（S5 待澄清） |

### MVP 定义

**S1 + S2 + S3 + S9 + 地基（批次 0-3）** = 最小可交付集合：
- 启动不被拦、不自动下载（S1）
- 翻译能流式出、能取消、取消后还能用、切页不丢（S2）
- 字幕能批量翻、**译文能看见**、取消不丢、大文件不卡（S3）
- 不崩溃、不死锁、不误删、不留孤儿进程（S9）

这四项交付了「批量翻译的结果可信、可见、可继续」这一核心价值，并验证了关键假设。S4（术语）紧随其后，因为它是差异化所在，但不属于 MVP。

### Phase 2

见 §6 末尾「未列入本版的 Stories」表。核心是 **cue 编辑与时间轴操作**（需要先写字幕引擎能力）与 **长文档翻译**（需要激活 `docpipeline`）。

### 上线考虑

- **上线前需要通知谁**：这是单机便携软件，无服务端。需要通知的是**字幕组/汉化组的分发渠道维护者**（他们把工具打包给组员）——因为：① 视觉大改，组员会以为装错了版本；② 模型下载改 fail-closed 后，用不可靠镜像的人会遇到新的失败提示；③ 引导不再自动下载，习惯「装完就有模型」的用户需要手动点一次。
- **是否 beta**：建议先在组内 5-8 人（老周这类技术角色）跑一周，重点看 R-2（竞态残留）与 R-6（日志脱敏）。这两类问题在小样本下最容易暴露。
- **上线后头 2 周监测什么**（**全部本地、零上报**，靠用户主动打包日志）：
  1. `logs/indexvt-*.log` 里的 panic / `prepare exit failed` / 编排器 `crashed` 出现次数
  2. 「取消后下一次翻译返回空串」是否复现（S2 的核心回归）
  3. `SHA256 校验失败` 的频率 → 判断 R-7 是否需要放宽
  4. 引导关闭率 vs 下载点击率 → 判断 R-1 关键假设
- **回滚**：便携布局天然可回滚——保留旧版文件夹即可，`models/` 与 SQLite 在两版间格式兼容（本版不改 schema；若 S4 的事务改造需要迁移，须走 `user_version` 且修掉 `store.go:49` 的建表跳过问题）。

---

> ⚠️ **薄弱章节提示**（`thin_sections`）
>
> - **Section 2 Background**：无 `brief` / `frame` 上游。「为什么是现在」由代码状态与 v1.0 作废决定推导，缺市场/竞品的一手数据。补齐方式：跑 `/设计简报`（brief）与 `/框架`（frame）。
> - **Section 3 Personas**：无 `stories` / `frame` 上游。阿澄与老周由产品形态（字幕/汉化、Windows、便携、双源下载、一键日志）反推，**非真实用户访谈**。补齐方式：跑 `/用户故事`（stories），或做 3-5 个字幕组译者访谈。
> - **Section 5 Value Proposition**：竞争差异化基于工具类别常识，无 `frame.competitive_landscape` 一手调研。补齐方式：跑 `/框架`（frame）。
> - **Section 4 度量目标值**：`引导→首译 ≤ 90s`、`术语触达 ≥ 40%`、`滚动 ≥ 50fps` 等阈值由工程判断设定，无 `metric` 上游蓝图。补齐方式：跑 `/指标`（metric）。
> - **埋点章节**：**刻意留空**——本产品零遥测，不设计行为埋点事件（见 §6 抬头说明）。这是产品承诺，不是遗漏。
> - Section 6 / 7 / 8 为 **strong**：有 file:line 级代码证据、后端全量审计、Playwright 实测渲染数据支撑。
