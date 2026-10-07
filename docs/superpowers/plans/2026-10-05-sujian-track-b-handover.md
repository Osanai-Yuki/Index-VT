# Track B 前端地基 · 完成报告与 Track C 交接清单（2026-10-05）

Track B 全部 10 个 Task 完成，`npm run verify:all`（九道门禁）exit 0。本文件是计划
`2026-10-04-sujian-track-b-frontend-foundation.md` Task 2.10 Step 5 要求的交接清单，
Track C（页面重写）开工前应通读。

> **状态（2026-10-07 补记）：Track C 已于 2026-10-06 完成，本文件整体转为「历史记录 + 仍有效的
> 决策依据」两类混合，读时要分段。** 已合并进 `master`（tip `412f0a5`），承载分支已删。
>
> - **仍然有效、照着做**：§① 的导入面约定（但短路径那条已于 2026-10-07 修订，见下）、
>   §② 的 `_Primitives` 常设保留决定、§⑤ 之后的「计划外决策与偏差记录」（`ALWAYS_ON` 预挂监听、
>   `errors.ts` 分类词锚点、token 回写 DESIGN.md）—— 这些是当前实现的约束，不是历史。
> - **已兑现，转为历史记录**：§④ 的 R17/SubGetDoc 交接项、§⑤ 的"未消费"清单（收藏历史、
>   未知模型归位、约束五字段、`apiSubGetDoc`/`apiSubRetryCues` 封装）全部在 Track C 落地。
>   不要再按这些条目估工。
> - **本文原有两处数字/指令已过期**，已就地修订：§③ 的白名单行数、§① 的短路径建议。
>
> 门禁靶子那句话（"5 个真实页面不在覆盖内…否则对着空屋子鼓掌"）已经解决：
> `npm run verify:pages` 用 dev 假后端（`?mock`，`lib/mockbackend.ts`）把五个真实页面
> 纳入了 a11y / 对比度 / 键盘三组断言，组件层门禁仍指向 `/?primitives`。

## 提交序列（本 Track）

| Task | Commit | 内容 |
|---|---|---|
| 2.1 | c467504 + c6029d1 | 双主题 token 层 / 主题运行时 / 字体 vendoring（Fix round 1：原始变量加 `--suj-` 前缀） |
| 2.2 | a3cc2a2 | design-token 漂移 lint + a11y 矩阵 harness + B32 严格开关 |
| 2.3 | d7f3ad5 | Wails 事件层（单点订阅多路分发 + 早到缓冲）+ 类型化错误映射 |
| 2.4 | b55ed1f | format 纯函数 + 固定行高虚拟化 |
| 2.5 | 9eee6e8 | 原语 A + 陈列页 |
| 2.6 | a04beb9 | 原语 B（表单与展示） |
| 2.7 | 20f6d11 | 原语 C（Popover/LangPicker/Tooltip + useDismissable） |
| 2.8 | 809b725 | 原语 D（Modal/Drawer/Toast + 焦点陷阱 + Esc 栈） |
| 2.9 | 75c79af | 原语 E（DataTable 虚拟化 + 批选 + 键盘行导航） |
| 2.10 | 33556b2 | 对比度 / 键盘 / reduced-motion 门禁 + verify:all |

## 验收门禁（verify:all 全绿）

2026-10-05 晚些时候在工作区重跑了一次（含未提交的 `virtualizer.ts` 类型改动与重新生成的 `wailsjs` 绑定），
实测输出如下。首次记录里 `lint:design` 写的「43 文件」是早期数字，实际扫描面为 48 个文件，已按本次输出更正：

```
lint:design            48 文件扫描 0 命中（白名单 13 文件跳过）
tsc --noEmit           exit 0（noUnusedLocals / noUnusedParameters 已开）
verify:theme   10/10   token 换值 / CJK 栈顺序 / @theme 自引用回归锁 / 新旧共存锁
verify:wails    7/7    多路分发 / 退订隔离 / EventsOff 语义 / 早到缓冲 / 异常隔离
verify:lib     24/24   时间码/字节/百分比边界 + 虚拟化边界
verify:a11y    6/6     /?primitives × 1180/1366/1680 × light/dark 全部 0 critical 0 serious
verify:datatable 3/3   5000 行 DOM ≤ 视口+12；滚动 0 个 >200ms 长任务
verify:contrast        273 文本节点全 ≥4.5:1（light 最低 4.95 / dark 最低 4.81）
verify:keyboard 10/10  Tab 120 停靠点 / Segmented 方向键 / Switch Space / Modal 陷阱 /
                       Esc 归还焦点 / 破坏性确认初始焦点在取消 / reduced-motion 三断言
```

门禁的靶子只有 `/?primitives` 陈列页，5 个真实页面不在覆盖内（`verify-a11y.mjs` 明写允许旧页面违规）。
Track C 迁移完页面后要按 §② 把断言路径改到真实页面，否则这套绿色会一直"对着空屋子鼓掌"。

## ① 23 个原语（Track C 统一导入面）

并存期**必须**从 `'../components/ui/index'` 导入（旧 `components/ui.tsx` 在模块解析上
遮蔽 `'../components/ui'` 短路径）。

**2026-10-07 修订：短路径不恢复。** 原句"Track C 删除旧 ui.tsx 后可改回短路径"作废。
旧 ui.tsx 确实已在 Track C 删除，但显式 `ui/index` 保留下来，两个理由：
① 7 个导入点（App + 6 个页面/组件）当时已统一写成显式形式，只改回一处会成唯一异类；
② 显式形式对"将来某个工具又生成一个 `components/ui.tsx`"天然免疫，短路径会重新踩同一个
静默遮蔽坑 —— 那类遮蔽不报错，只是导错了模块。`_Primitives.tsx` 里那条描述并存期的注释
已于同日删除（它承诺的"改回短路径"正是这条被作废的建议）。

- **交互基础（2.5）**：`Button(kind/size/loading/icon, forwardRef)`、`IconButton(label 必填→aria-label+Tooltip, icon/size/loading)`、`Badge(tone/dot/title)`、`Segmented<T>(options/value/onChange 必填/size/aria-label；radiogroup + 方向键 + Home/End)`、`Switch(checked/onChange/label/srOnly；role=switch)`、`Checkbox(checked/onChange/label/indeterminate；真实 input)`、`Kbd(keys)`、`Spinner(size)`
- **表单展示（2.6）**：`Field(label 必填/error/hint/size, forwardRef)`、`Textarea(label/error/read→15.5/1.9+72ch 限宽)`、`NumberField(value:number/onChange/min/max/step，.num 右对齐)`、`Slider(value/onChange/min/max/label/formatValue；原生 range+accent)`、`Surface(dense→padding16 否则24)`、`EmptyState(icon 48px lucide/title/body 40ch/action lg)`、`Skeleton(rows)`、`Progress(pct/tone/label；scaleX 填充)`
- **浮层（2.7–2.8）**：`Popover(open/onClose/anchorRef/width/labelledBy；portal+翻转定位)`、`LangPicker(langs/value/onChange/isSource/detected/recent/label；虚拟化 listbox)`、`Tooltip(content/children；400ms 延迟/120ms 淡出/键盘可触发)`、`Modal(open/onClose/title/footer/initialFocus='cancel'/'confirm'/'first'/dismissible)`、`Drawer(open/onClose/title/width 360|420)`、`ToastHost` + `toast.push/dismiss`（右下 3 条上限，error 不自动消失，FLIP 让位）
- **数据（2.9）**：`DataTable<T>(columns/rows/rowKey/rowHeight 32|40/virtual 默认>200 自动/selectable/selected/onSelectedChange/onRowClick/selectedRowKey/emptyState/aria-label；↑↓ Space Enter + Shift 连选)`
- **支撑**：`lib/useDismissable.ts`（点外关闭 + **Esc 只关最上层**的模块级栈 + 焦点归还；`useFocusTrap`、`FOCUSABLE_SELECTOR` 一并导出）、`lib/wails.ts`（`call/callApp/on/wailsAvailable/EV`）、`lib/errors.ts`（`AppError/toAppError/isCancel`）、`lib/format.ts`、`lib/virtualizer.ts`（`computeWindow/useVirtualRows`，只支持固定行高）、`stores/toastStore.ts`

## ② `_Primitives.tsx` 的保留决定（2026-10-06 修订）

**原计划**：Track C 全部页面迁移完成后删除 `src/pages/_Primitives.tsx` 与 `main.tsx` 里的
`/?primitives` 条件渲染，四个门禁改指真实页面。

**实际决定（2026-10-06）**：**保留**，身份改为常设 dev-only 工具——
① 原语速查（全部变体与状态）；② 组件层的常设门禁靶子（a11y / 对比度 / 键盘 / datatable /
verify-wails 隔离探针共 5 处断言都指向它）。真实页面另加一组页面级门禁（`npm run verify:pages`，
`?mock` 假后端供数），两者互补：组件层保"全状态覆盖"，页面层保"真实组合"。

若将来仍要删陈列页，前置条件是先把上述 5 处断言的靶子换掉，见 README「验证门禁」。
`main.tsx` 与 `_Primitives.tsx` 的文件头注释已同步这一决定。

## ②′ 页面级门禁首轮抓出的缺陷（2026-10-06）

`verify:pages` 第一次跑通即抓出 4 个真缺陷（`Settings` 的 Row 定义在组件体内导致输入框丢焦点 /
Modal 焦点归还失败；`ModelHub` 把 `ListUnknownModels` 当字符串数组用导致有未知模型时白屏；
`--suj-ink-3` 与瑞士红在 soft/sunken 底上跌破 4.5:1；Settings 三个输入框缺 aria-label 判 critical）。
明细与修法见 README「当前状态 → 页面级门禁首轮抓出的 4 个真缺陷」。

## ③ lint 白名单（迁移进度度量）

`frontend/scripts/design-lint-legacy.txt` 交接时为 **13 行**（6 页面 + Rail/StatusBar/ui.tsx +
LangSelect/App/appStore/wailsapi/styles-tokens.css）。
**2026-10-07 复核：现为 1 行**（只剩 `src/wailsapi.ts`）—— Track C 按下面的规则逐文件迁完后
把其余 12 行全删了，其中 `ui.tsx` 与 `styles/tokens.css` 是整文件删除而非迁移。
`wailsapi.ts` 这一行是**永久**的：它是 `declare global` 的类型补全文件，无样式类，
保留只为免掉"样板式 `any` 用法"误报，不是因为欠债未清。

规则本身仍然有效：**新文件禁止进白名单**；白名单外零容忍；非白名单文件命中
`legacy-token`（`bg-bg-*` / `text-ink-*` / `*-hairline` / 旧 `*-soft` / `*-line`）即构建失败。

## ④ Track A 交接项落点

- **R17（error 态保留部分译文）**：事件层 `EV.DONE`（`translate:done`）已可用；Track C
  翻译台在 `phase==='error'` 时须渲染已收到的 `output` + 错误提示。**后端小改**：`app.go`
  现只在成功分支发 `done["output"]`，error 分支需带上已产出的文本。
- **SubGetDoc + CueProgress.Translated**：事件层 `EV.CUE`（`subtitle:cue`）已暴露，
  payload 携带 `Translated`。Track C 字幕页据此实时刷新译文列，队列结束后调
  `SubGetDoc` 拉权威快照。**注意**：`SubGetDoc`/`SubRetryCues` 的 Go 绑定已存在
  （app.go:741/752）但 `wailsapi.ts` 未封装——Track C 先在 `lib/wails.ts` 加
  `call('SubGetDoc', docId)` / `call('SubRetryCues', docId, ids, opt)` 封装再消费。

## ⑤ 尚未接线的后端能力（Track C 必做/待核）

- **术语 CRUD**：`apiListGlossaries/apiSaveGlossary/apiDeleteGlossary` 已封装，页面未消费
  （术语本 = Drawer(420) + DataTable 重写时接入）。
- **收藏历史（PRD S2）**：`apiStarHistory` 已封装未消费；B32 清理时已删死导入并在
  `MainTranslate.tsx` 历史区留 `TODO(TrackC)` 注释（位置：starred 徽标旁）。
- **未知模型归位**：`apiListUnknownModels/apiAssignUnknown` 已封装未消费（模型中心迁移时接）。
- **配音模式字段 / 约束字段**：接前先核 `translator.Constraints` 真实性（计划 Global
  Constraints 原话），勿按文档臆测字段。
- **documented 偏差**：`apiSubGetDoc/apiSubRetryCues` 封装缺失（见 ④）。

## 计划外决策与偏差记录（review 线索）

1. **EV 表事件在模块加载时预挂 Wails 监听且退订不摘**（`ALWAYS_ON`）：否则无订阅者窗口期
   事件在 Wails 层已丢，早到缓冲无从谈起；动态名仍按"退订即 EventsOff"。verify-wails #3 锁定。
2. **errors.ts 分类词全部取自后端真实文案**（grep `fmt.Errorf|errors.New`），锚点：
   `已取消` / `应用服务装配超时，请重启` / `翻译服务不可用` / `模型未在预期时间内返回首字` /
   llama 系列 / `SHA256SUMS 不可达`。后端改文案须同步。优先序：canceled → not-ready →
   timeout → model → validation → network → io。
3. **token 补齐并已回写 DESIGN.md**：`--suj-measure-body: 40ch`（§3.5/§5.10）、
   `--suj-modal-max: 480px`、`--suj-drawer-w: 360px`、`--suj-drawer-w-lg: 420px`（§5.9）、
   `--tracking-caps: 0.08em`（§5.7 表头字距）。均为规格字面值 token 化（§10 禁任意值）。
4. **B32 清了 4 处死代码**：计划预告的 `ModelHub Upload`、`MainTranslate apiStarHistory`，
   加计划外的 `Onboarding translateReady`（纯计算死变量）与 `SubtitleWorkbench progress`
   （state 从未渲染，setter 已从 cue 订阅回调移除；cue→doc 更新保留）。
5. **并存期导入路径**：barrel 必须写 `components/ui/index`（旧 ui.tsx 遮蔽短路径）。
6. **本机 harness**：`npx playwright install chromium` 不可达（cdn 超时，Task 2.1 实测），
   全部 verify 脚本走 `channel: 'chrome'` → `msedge` → 自带 chromium 顺序；vite 显式
   `--host 127.0.0.1`（本机 IPv6 loopback EACCES）；Git Bash 调 node 需
   `MSYS_NO_PATHCONV=1`（npm scripts 走 cmd 不需要）。
7. **verify:all 比计划多一道 `verify:datatable`**（5000 行虚拟化 + 长任务门禁的持久化），
   其余与计划一字不差。
8. 提交钩子多次提示 Mimosa 未获完整扫描结论（library_source/callgraph 部分覆盖）——本
   Track 未被要求做安全审计，未处理；如需完整审计请显式运行深度扫描。
9. **Mimosa L3 拦截事件（2026-10-05，本报告提交时）**：钩子在 docs 提交时报 5 个 high 并
   强制拦截。逐项人工核读后的裁定——全部为**存量文件误报**，均在本 Track 之前已存在，
   且无一位于本次暂存内容（两份 markdown）：
   - `app/internal/envprobe/envprobe.go:58`「命令注入」＝Track A B25 加固产物本身
     （`exec.LookPath` 绝对路径 + 硬编码参数 `nvidia-smi` + 超时，无外部输入拼接）；
   - `app/translate_ctx_test.go:28`「命令注入」＝Go 标准测试子进程模式
     （`exec.Command(os.Args[0])`）；
   - `testdata/official/*.py` 三处「SSRF/路径穿越」＝Go 构建不参与的 Python CLI 示例
     夹具，`--base-url/--output` 本就是给用户填的参数。
   未采纳的动作及理由：修改 Track A 文件以安抚扫描器（越界且有损加固）、手写 ledger
   裁定事件（篡改安全控制记录）、用 `--no-verify`/等价物绕过（扫描器为 ZCode 层钩子，
   亦不可绕）。**留待用户裁定**：或为 testdata/ 配置扫描豁免，或由 Track A 辖区复核后
   出裁定。本报告与计划勾选更新当时停留在工作区未提交 —— **已于 2026-10-07 随三个提交入库**
   （`58a64ff` / `8cafa57` / `412f0a5`，`master` tip `412f0a5`）。
