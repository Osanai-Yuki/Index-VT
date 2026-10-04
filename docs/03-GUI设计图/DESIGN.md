# Index-VT 设计契约 · DESIGN.md

| | |
|---|---|
| **概念** | **素笺（Blank Sheet）**——界面近乎无色，颜色只属于批注 |
| **版本** | 2.0（取代 v1.0《设计系统规范.md》，后者已作废） |
| **日期** | 2026-10-04 |
| **主题** | 浅色为设计基准；深色由**同一套语义 token 换值**得出，不是第二套设计。默认跟随系统 |
| **动效人格** | Premium（用户在 motion-plan Phase 2 显式确认）；数值见 `spark-output/context/motion-plan.json` |
| **约束来源** | Wails v2 + WebView2，离线应用（**零网络请求**，不得引用 Google Fonts 等外链），最小窗口 1180×700 |

> 本文件是实现的**唯一权威来源**。组件禁止写死色值/字号/圆角；违反由 §10 的 lint 拦在构建期。

---

## 1. 概念与三条不变量

产品本质是**阅读与校对**（双栏对照长文本、上千行 cue 表），不是仪表盘。所以：

1. **界面退到近乎无色。** 面板不带边框、不带阴影、不带内高光；层级只由「surface 浮在 canvas 上」+ 间距表达。少几个盒子＝多一大片空气。
2. **颜色只出现在人会用笔标注的地方。** 主操作是墨块（ink 实底），不带彩色。唯一交互色 `--accent`（钢笔蓝）只用于：焦点环、链接、术语命中高亮、当前选中行左缘条、流式光标。语义色（danger/warn/ok）只用于状态，且**必须同时带图标与文字**。
3. **留白用在阅读，密度留给操作。** 阅读态（翻译台/引导/设置）留白拉满；操作态（cue 表/历史/模型卡）行高 32px、hairline 分隔——空白由**对齐与分组**产生，不由 padding 堆出来。

---

## 2. 色彩 token

语义命名（角色，不是颜色）。`light` 为基准值，`dark` 为换值。对比度均按 WCAG 2.1 相对亮度公式对**其所在表面**实算。

### 2.1 表面

| Token | light | dark | 用途 |
|---|---|---|---|
| `--canvas` | `#FBFBFA` | `#131312` | 应用底。1% 暖白，避开纯白眩光 |
| `--surface` | `#FFFFFF` | `#1A1A19` | 面板/卡片/表格底 |
| `--sunken` | `#F4F4F2` | `#101010` | 输入框、时间码井、hover 行 |
| `--raised` | `#FFFFFF` | `#20201F` | 浮层（popover/drawer/modal/toast） |

### 2.2 线

| Token | light | dark | 用途 |
|---|---|---|---|
| `--line` | `rgba(24,24,22,.10)` | `rgba(255,255,255,.10)` | 表格行分隔、输入描边 |
| `--line-strong` | `rgba(24,24,22,.18)` | `rgba(255,255,255,.20)` | 浮层描边（深色下替代阴影）、表头底线 |

> 面板**不使用**任何线。线只出现在：表格行、输入框、浮层边界、状态栏顶部。

### 2.3 文本

| Token | light | dark | 对 surface 对比度（light / dark） |
|---|---|---|---|
| `--ink-1` | `#1A1A18` | `#ECECEA` | **17.4:1 / 14.7:1** |
| `--ink-2` | `#55554F` | `#A8A8A2` | **7.5:1 / 7.3:1** |
| `--ink-3` | `#6E6E68` | `#87877F` | **5.1:1 / 4.8:1** |
| `--ink-inverse` | `#FBFBFA` | `#131312` | 用于 ink 实底按钮上的文字（14.7:1 / 14.7:1） |

**三级全部过 AA。** 这是硬约束：旧规范把 2.9:1 的 `--ink-3` 用在栏目标题上，属违规，本版不允许任何文本级 token 低于 4.5:1。

### 2.4 交互色与语义色

| Token | light | dark | 对 surface 对比度（light / dark） | 允许用途 |
|---|---|---|---|---|
| `--primary` | `#1A1A18` | `#ECECEA` | 17.4:1 / 14.7:1 | 主按钮实底。**不带彩色** |
| `--accent` | `#2B4A8B` | `#8AA6E8` | **8.6:1 / 7.2:1** | 焦点环、链接、术语高亮、选中行左缘条、流式光标 |
| `--danger` | `#B42318` | `#E4796E` | **6.6:1 / 6.0:1** | 失败、破坏性操作、off-target |
| `--warn` | `#8A6212` | `#D9A441` | **5.5:1 / 7.7:1** | 下载中、近似达标、需人工检查 |
| `--ok` | `#2E6B4F` | `#6FBF97` | **6.3:1 / 7.9:1** | 完成、校验通过、运行中 |

soft 底（badge 背景 / 选中行底）：light 用 `color-mix(in srgb, <token> 8%, transparent)`，dark 用 14%。token 名 `--accent-soft` / `--danger-soft` / `--warn-soft` / `--ok-soft`。

**禁止**：紫色系、渐变实底、彩虹状态色、第二个品牌色。`--accent` 与 `--danger` 都属暖侧但明度与用法分离（danger 永远在告警容器内并带图标），不得互换。

---

## 3. 字体 token

### 3.1 打包策略（离线约束）

- **打包**：Inter（latin 子集，400/500/600）+ JetBrains Mono（latin 子集，400/500）。woff2 置于 `frontend/src/assets/fonts/`，`@font-face` + `font-display: swap`。合计约 80–120KB。
- **不打包 CJK**：思源黑体单字重即 10MB+，与便携布局冲突。中文走系统栈。
- **禁止外链字体**：`index.html` 不得出现 Google Fonts `<link>`（旧 mockups.html 用了，离线应用里等于失效）。

### 3.2 字体栈（必须单栈，这是修 bug）

```css
--font-app:  'Inter', 'Microsoft YaHei UI', 'Source Han Sans CN', 'Noto Sans SC', 'PingFang SC', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace;
```

> **旧实现的真 bug**：`font-family: var(--font-latin), var(--font-cjk)` 展开后通用族 `sans-serif` 排在 CJK 栈**之前**；按 CSS 字体匹配规则，命中通用族即停止，中文字体栈永不可达（已在浏览器实测确认）。**禁止**把字体栈拆成多个变量再拼接。

### 3.3 字阶（Tailwind v4 `--text-*`，产出 `text-display` 等 utility）

| Token | 字号 / 行高 | 字重 | 用途 |
|---|---|---|---|
| `--text-display` | 20px / 28px | 600 | 页面标题、引导标题 |
| `--text-title` | 15px / 22px | 600 | 面板标题、模型名 |
| `--text-read` | 15.5px / **1.9** | 400 | **仅**译文/原文阅读区 |
| `--text-body` | 13.5px / 1.6 | 400 | UI 默认 |
| `--text-caption` | 12px / 1.5 | 400 | 说明、次要信息 |
| `--text-micro` | 11px / 1.4 | 500 | 刻度标签、表头、指标（等宽） |

**字重纪律**：只用 400 / 500 / 600。Windows ClearType 下小字号 700 发糊，禁止 700+。层级靠字号 + 字重 + ink 级，不靠颜色。

### 3.4 数字排版（本类工具性价比最高的一条）

所有数字列强制 `font-variant-numeric: tabular-nums` + `--font-mono`：时间码、tok/s、TTFT、VRAM、计数、百分比、下载速度、端口。工具类 `.num`。
> 旧实现时间码列因数字宽度不等而左右抖动，此为根因。

### 3.5 行文限宽

阅读区文本块 `max-width: 72ch` 并在栏内居中。**大面积留白靠限制行文宽度产生，不靠加 padding**——1920 宽下双栏每栏 860px 的中文不可读。

---

## 4. 几何 token

### 4.1 间距（4px 基线，只允许这些步长）

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

| 场景 | 值 |
|---|---|
| 页面内边距（阅读态 / 操作态） | 32 / 24 |
| 面板内边距（阅读态 / 操作态） | 24 / 16 |
| 面板之间 | 24 |
| 面板内分组之间 | 32 |
| 控件之间 | 8 |
| 图标与文字 | 8 |
| 表格列沟槽 | 24 |

### 4.2 圆角（4 步，禁止任意值）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-xs` | 3px | tooltip |
| `--radius-sm` | 6px | 按钮、输入、seg item、表格单元控件 |
| `--radius-md` | 10px | 面板、popover、drawer 内块、rail item |
| `--radius-lg` | 14px | modal、drawer、toast |
| `--radius-full` | 999px | **仅** 状态点、badge、switch |

### 4.3 高度

| Token | 值 | 用途 |
|---|---|---|
| `--h-control-sm` | 28px | 表格行内操作、紧凑控件 |
| `--h-control` | 32px | 按钮/输入/seg 默认 |
| `--h-control-lg` | 36px | 主 CTA（引导、空态） |
| `--h-row` | 32px | 操作态表格行 |
| `--h-row-lg` | 40px | 舒适态表格行（历史列表） |
| `--h-rail` | 56px（宽） | 左导航 |
| `--h-status` | 32px | 状态栏 |

### 4.4 层级（elevation）

| Token | 值 | 用途 |
|---|---|---|
| `--e-0` | `none` | **面板默认。禁止给面板加阴影** |
| `--e-2` | `0 1px 2px rgba(24,24,22,.06), 0 8px 24px rgba(24,24,22,.10)` | popover / dropdown |
| `--e-3` | `0 2px 4px rgba(24,24,22,.08), 0 16px 48px rgba(24,24,22,.14)` | modal / drawer / toast |

深色主题下阴影几乎不可见 → 浮层改用 `1px solid var(--line-strong)` + `--e-2/3` 的深色值（`rgba(0,0,0,.5)` 系）。z 序：面板 0 → popover 10 → drawer 20 → modal 30 → toast 40 → palette 50。

---

## 5. 组件规格

所有可交互原语必须是**真实语义元素**（`<button>` / `<input>` / `role="switch"` / `role="listbox"` / `role="tab"`），带 `:focus-visible` 焦点环。旧实现 6 个 `button` vs 6 个 `cursor-pointer` 的 div、`src/` 内 a11y 属性数为 0，本版不允许复现。

### 5.1 Button

- 尺寸：`sm` 28 / `md` 32（默认）/ `lg` 36；padding `0 14px`（sm `0 10px`）；图标 16px，与文字间距 8；radius `--radius-sm`；字体 `--text-body` / 500。
- 变体：
  - `primary`：`--primary` 实底 + `--ink-inverse` 文字
  - `secondary`：`--surface` 底 + `1px --line` + `--ink-1`；hover → `--sunken` 底 + `--line-strong`
  - `ghost`：透明 + `--ink-2`；hover → `--sunken` 底 + `--ink-1`
  - `danger`：透明 + `1px color-mix(--danger 40%)` + `--danger` 文字；hover → `--danger-soft` 底
- 状态：active `scale(.98)` 120ms；disabled `opacity .45` + `cursor: not-allowed` + `aria-disabled`；loading → 14px spinner 替换前导图标（**spinner 是唯一允许 linear 的动效**）。
- 图标按钮：正方形 = 高度，必须带 `aria-label` 与 tooltip。

### 5.2 Badge（状态徽标）

- 高 20px，padding `0 8px`，radius `--radius-full`，字体 `--text-micro`。
- 结构：可选 6px 状态点 + **文字标签（必有）**。tone：`neutral` / `accent` / `ok` / `warn` / `danger`。
- 底色 = 对应 `*-soft`，文字 = 对应语义色（均 ≥4.5:1）。**禁止仅用颜色传达状态。**

### 5.3 Segmented

- 容器：`--sunken` 底 + `1px --line` + radius `--radius-md` + padding 2px + 高 32。
- 项：radius `--radius-sm`，padding `0 12px`，`--text-body`/500；选中 = `--surface` 底 + `--e-1` + `--ink-1`；未选 = `--ink-2`，hover → `--ink-1`。
- a11y：`role="radiogroup"` + 每项 `role="radio" aria-checked`，← → 键移动，Home/End 跳首尾。
- **禁止**渲染没有 `onChange` 的 Segmented（旧实现有 3 处死控件）。

### 5.4 Switch

- 36×20，knob 16px，行程 16px。on = `--primary` 实底 + `--ink-inverse` knob；off = `--sunken` 底 + `1px --line` + `--ink-3` knob。
- a11y：真实 `<button role="switch" aria-checked>`，可 Space/Enter 切换。

### 5.5 Field / Input / Textarea

- Input：高 32（sm 28），padding `0 10px`，radius `--radius-sm`，`--sunken` 底，**无边框**；focus → `1px --accent` + 焦点环。
- Textarea：`--surface` 底 + `1px --line`；focus → `--accent`。翻译台读写区用 `--text-read`。
- **标签必填**：12px/500 `--ink-2` 置于控件上方；禁止 placeholder-only（旧实现两个输入框都无 `aria-label`）。
- 错误：`1px --danger` + 下方 12px `--danger` 文案（带图标）+ `aria-describedby` + `aria-invalid`。
- 数字输入：`--font-mono` + `tabular-nums` + 右对齐或居中。

### 5.6 LangPicker（语言选择器）

- 触发器 = Button `secondary` 语义（32 高），内含语言名 + `--text-micro` 大写英文码。
- 弹层 = popover（`--raised` + `--e-2` + radius `--radius-md`），宽 280，内含搜索 Field + `role="listbox"` 列表（虚拟滚动，150 项）。
- 键盘：Enter/Space 打开，↑↓ 移动，Enter 选中，Esc 关闭（旧实现无 Esc 处理），输入即过滤，首字母跳转。
- 源语言含「自动检测」项；检测结果以 `DETECTED · 日本語` 形式显示在触发器副行——**必须消费后端 `translate:done` 的 `detected` 字段**（旧实现硬编码 `'…'` 且从不更新）。

### 5.7 DataTable（cue 表 / 历史 / 术语）

- 表头：高 28，`--text-micro` + `--ink-3` + `uppercase` + `letter-spacing .08em`，sticky，底线 `1px --line-strong`。
- 行：`--h-row` 32（紧凑，cue 表默认）/ `--h-row-lg` 40（历史）；底线 `1px --line`；hover → `--sunken`；选中 → 左缘 `2px --accent` + `--accent-soft` 底。
- 单元：文本 `--text-body`；数字/时间码 `--font-mono` 12.5px + `tabular-nums`。
- 行内操作：hover/focus 时显现，但**始终在 Tab 序内**（用 `opacity` 而非 `display:none`）。
- **行数 > 200 必须虚拟滚动**（可视行 + 上下各 6 行缓冲）。用约 40 行的内部实现，不引新依赖。旧实现整表 `map` 渲染，千行级字幕会卡死。
- 批量选择：首列 16px checkbox（`role="checkbox"`），Shift 连选，选中数出现在工具栏（喂给「重试选中项」→ 后端 `SubRetryCues`）。

### 5.8 Surface（面板）

- `--surface` 底 + radius `--radius-md` + **无边框无阴影** + 内边距 24（阅读态）/16（操作态）。
- 标题行：`--text-micro` `--ink-3` 标签（可中英双写）+ 右侧操作区；与内容间距 16。

### 5.9 浮层家族

| 组件 | 规格 | 入场 |
|---|---|---|
| Scrim | light `rgba(24,24,22,.32)` / dark `rgba(0,0,0,.55)` | fade 200ms |
| Modal | max-w 480，radius `--radius-lg`，`--e-3`，padding 24 | translateY(8px)+opacity 320ms |
| Drawer（右） | 宽 360（术语本 420），左侧 radius `--radius-lg`，`--e-3` | translateX(16px)+opacity 320ms |
| Popover | radius `--radius-md`，`--e-2` | translateY(4px)+opacity 180ms |
| Toast | 右下，radius `--radius-md`，`--e-2`，图标+文字，4 变体 | translateY(8px)+opacity 280ms |
| Tooltip | `--ink-1` 底 + `--ink-inverse` 字，radius `--radius-xs`，`--text-micro` | fade 120ms，延迟 400ms |

统一行为：Esc 关闭最上层；焦点陷入浮层内；关闭后焦点**回到触发元素**；Toast 自动消失 4s（error 类不自动消失，带关闭按钮）。
**禁止 `alert()` / `confirm()` / `prompt()`**——旧实现有 8 处，桌面应用里弹系统框最伤质感。确认走 Modal，通知走 Toast。

### 5.10 EmptyState

居中；48px 线性图标（`--ink-3`，stroke 1.5，lucide）；标题 `--text-title` `--ink-2`；正文 `--text-caption` `--ink-3` 限宽 40ch；**一个**主操作（`lg`）。留白即装饰——不使用点阵网格背景（旧签名细节，本版废弃）。

### 5.11 Skeleton

`--sunken` 底 + 目标同圆角；shimmer 用 `opacity .6→1` 1200ms sine ease-in-out（**不用 transform 位移**，避免与内容布局争抢）。只允许出现在任务区，**禁止整页遮罩**。

### 5.12 焦点环

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```
任何 `outline: none` 必须同时给出替代可见焦点样式。旧实现 6 处 `outline-none` 无替代。

### 5.13 外壳

- **Rail**：宽 56，**无底板**（透明浮在 canvas 上），无右边框。项 40×40 radius `--radius-md`，图标 18px stroke 1.75；激活 = `--ink-1` 图标 + `--sunken` 底 + 左缘 `2px --accent`；hover = `--sunken` 底。每项带 tooltip（名称 + 快捷键）。有进行中任务的页在右上角显示 6px `--ok` 点。
- **StatusBar**：高 32，顶边 `1px --line`，`--text-micro` + `--font-mono` + `--ink-2`；项间距 16（**不用竖线分隔符**，留白即分隔）；可点项是真实 button（高 24）。
- 导航目标：翻译台 / 字幕 / 模型 · 术语 / 设置（4 项）。**文档翻译从导航移除**——后端返回「M5 里程碑提供」，旧实现是一个 disabled rail 项指向不可达的 emoji 占位页，属假入口。

---

## 6. 布局与断点

### 6.1 应用骨架

```
grid-template-columns: 56px 1fr;
grid-template-rows: 1fr 32px;
grid-template-areas: "rail main" "rail status";
```
`main` 内容区在 ≥1680 时 `max-width: 1440px` 居中。

### 6.2 断点（旧实现一条媒体查询都没有，本版必须落地）

| 断点 | 行为 |
|---|---|
| `< 1180` | 历史侧栏 / cue 详情 / 术语侧栏 → 抽屉唤出；模型卡 1 列；翻译台双栏保持但内边距降到 24 |
| `1180 – 1379` | 历史侧栏 240px；模型卡 2 列；cue 详情 320px |
| `1380 – 1679` | 历史侧栏 260px；模型卡 3 列；cue 详情 1fr（`1.6fr / 1fr`） |
| `≥ 1680` | 内容整体限宽 1440 居中；模型卡 3 列 |

面板级响应优先用 **container query**（`@container`），只有应用骨架用 media query。

### 6.3 各屏布局

| 屏 | 结构 |
|---|---|
| 翻译台 | 三栏 `260px / 1fr / 320px`（历史 / 双栏读写 / 约束抽屉唤出态）。双栏间 32px 沟槽 + `1px --line` 竖分隔（**实线，不用点状虚线**——旧品牌母题，与「简洁」冲突，本版废弃）；每栏文本块限宽 72ch 居中 |
| 字幕 | 工具栏（单行，`flex-wrap`，高 32 控件）+ `1.6fr / 1fr`（cue 表 / 选中详情）。<1180 时详情转抽屉 |
| 模型 | VRAM 概览条 + 卡片栅格（1/2/3 列随断点）+ 下载源条 |
| 术语 | 两栏 `280px / 1fr`（术语本列表 / 词条表）；词条表用 DataTable |
| 设置 | 单列 `max-width 720px` 居中；分组用 Surface，行高 48，标签左 / 控件右 |
| 引导 | 覆盖层，卡片 `max-width 560px` 居中；**不阻塞**——可关闭，未就绪时主界面顶部常驻横幅 + 就地 CTA |

---

## 7. 可访问性契约（每条可验证）

1. 所有文本 token 对其所在表面对比度 ≥ 4.5:1，两个主题都成立（§2 已给实算值）。
2. 所有可交互元素：真实语义元素 + ≥28px 命中高度 + `:focus-visible` 焦点环。
3. Tab 序：rail → 页面内容（按视觉顺序）→ 状态栏。浮层打开时焦点陷入，关闭后回到触发元素。
4. 状态不得仅靠颜色传达：badge 必带文字；danger/ok 必带图标。
5. Esc 关闭最上层浮层；Ctrl+K 命令面板；Ctrl+Enter 翻译；Esc 取消进行中任务（无浮层时）。
6. `prefers-reduced-motion: reduce` 全覆盖：去位移、保 opacity、时长减半（旧实现只覆盖 2 个选择器）。
7. 所有输入有可见标签或 `aria-label`；错误用 `aria-describedby` + `aria-invalid`。
8. **验收方式**：Playwright + axe 在 1180 / 1366 / 1680 三档 × light/dark 两主题实测，要求 **0 critical、0 serious**。不靠人工目测。

---

## 8. 动效（摘要）

权威数值在 `spark-output/context/motion-plan.json`。要点：

- **Personality = Premium**：签名缓动 `cubic-bezier(0.4, 0, 0.2, 1)`，overshoot **0%**，duration palette **quick 180 / standard 320 / slow 520**。
- **稀疏原则**：同一时刻只允许一个元素在动。页面切换是唯一编舞时刻；流式光标是唯一持续动效。
- **入场范式统一**：`translateY(8px) + opacity`，无 scale、无弹性。
- **数据行永不做入场动画**：cue 表 / 历史列表 / 术语表禁止 stagger（千行级 stagger 是灾难，且违反 stagger 总预算 ≤500ms）。
- **禁止**：弹跳、缩放夸张、box-shadow 动画、width/height 动画（用 transform 替代）、整页遮罩加载。
- 空间位移类**永不 linear**；唯一例外是 spinner 与进度条填充。

---

## 9. 主题切换与启动白闪

- 主题由 `<html data-theme="light|dark">` 驱动；token 定义在 `:root`（light）与 `[data-theme="dark"]`。
- 三档：`light` / `dark` / `system`（跟随 `prefers-color-scheme`，运行时监听变化）。后端 `config.Appearance.Theme` **字段已存在但从未被前端使用**，本设计把它接上；`SetConfig` 后立即生效，无需重启。
- `index.html` 内联首屏背景色 + `<meta name="color-scheme" content="light dark">`，并在 Wails 侧设置 `options.App.BackgroundColour`。
  > 旧实现未设 `BackgroundColour`，Windows 上 WebView2 默认白底；切深色主题会有白闪。浅色基准下不明显，但深色必须修。
- `@theme` 映射规则（**修旧实现的自引用 bug**）：颜色用 `@theme inline { --color-surface: var(--surface); }`（`--surface` 与 `--color-surface` **不同名**，无环）；几何/字体直接在 `@theme` 内给字面值（`--radius-sm: 6px;`），**禁止** `--radius-sm: var(--radius-sm)` 这类同名自引用。

---

## 10. 反模式与漂移防线

### 禁止项

| 禁止 | 说明 |
|---|---|
| 组件内写死 `#hex` / `rgb()` | 一律走 token |
| Tailwind 任意值 `text-[13px]` / `rounded-[14px]` / `px-[4.5px]` | 旧实现 58 处；一律用 token utility |
| 同一元素上冲突的重复 utility | 旧实现 `px-4.5 … px-4` 两处 |
| `outline-none` 无替代焦点样式 | 6 处 |
| `div`/`span` + `onClick` 作为唯一可达方式 | 旧实现全仓如此 |
| `alert` / `confirm` / `prompt` | 8 处 |
| 面板加边框或阴影 | 层级靠 surface + 间距 |
| emoji 当图标 | 旧实现 📄 🎬；图标只用 lucide-react，stroke 1.75 |
| 数据行入场动画 / stagger | — |
| 整页加载遮罩 | 只用任务区 skeleton |
| 没有 `onChange` 的 Segmented / Switch | 旧实现 3 处死控件 |
| 假入口（指向未实现功能的导航项） | 旧实现文档翻译 |

### 漂移防线（纳入 `npm run build`）

一条零依赖 Node lint 脚本，扫描 `frontend/src/**/*.{ts,tsx,css}`（`tokens.css` 白名单），命中即 **构建失败**：

1. `#[0-9a-fA-F]{3,8}` 或 `rgba?\(`
2. `-\[\d` （Tailwind 任意值）
3. `outline-none`
4. `<div[^>]*onClick` / `<span[^>]*onClick`
5. `\balert\(` / `\bconfirm\(` / `\bprompt\(`
6. emoji 码位区间
7. `@import url(` / `fonts.googleapis`

外加 `tsc --noEmit` 开启 `noUnusedLocals` + `noUnusedParameters`（旧实现有未使用的 `Upload` 导入与 `apiStarHistory` 死导入，靠这两个开关拦住）。

---

## 11. 与 v1.0 的差异（迁移说明）

| v1.0（作废） | v2.0（本文件） |
|---|---|
| 碳墨暗色 + 琥珀品牌，单一主题 | 浅色基准 + 深色同套 token，默认跟随系统 |
| 琥珀 = 品牌/配音/倒计时/当前态（一色多义） | 主操作＝墨块无彩色；`--accent` 钢笔蓝只表交互/批注 |
| 面板带边框 + `--shadow-1` 内高光分层 | 面板无边框无阴影，靠 surface + 间距分层 |
| 点阵网格空态背景、双栏点状虚线中缝 | 全部废弃；留白即装饰，中缝改 1px 实线 |
| `--ink-3` 2.9:1 用于栏目标题 | 三级文本全部 ≥4.5:1 |
| 交换按钮悬停旋转 180° 作为「品牌记忆点」 | 废弃（Premium overshoot 0%，且旋转不传递信息） |
| IBM Plex 未打包 + mockups 用 Google Fonts 外链 | Inter + JetBrains Mono 本地 woff2 子集；禁止外链 |
| 设计基准 1366/1920，断点写在文档里但代码零实现 | 断点 1180/1380/1680 为可验证契约，配 container query |
| 6/14 界面落地，8 个后端 API 无 UI，3 处死控件 | 导航 4 项目全部可用；术语本 UI 补齐；无死控件 |

`mockups.html` 保留为历史参考，不再作为实现依据。
