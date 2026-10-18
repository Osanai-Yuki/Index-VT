# Index-VT 设计契约 · DESIGN.md

| | |
|---|---|
| **概念** | **素笺（Blank Sheet）→ v2.1 瑞士国际风格**：界面近乎无色，颜色只属于批注 |
| **版本** | **2.1**（2026-10-06 瑞士重映射）。取代 v2.0 素笺色值、v1.0《设计系统规范.md》（v1.0 已归档 [`legacy/`](./legacy/)）。v2.0 的**语义名与 utility 名一个没改**，换的只是 token 值与几何，所以组件层零改动 |
| **日期** | 2026-10-06（v2.0：2026-10-04） |
| **主题** | 浅色为设计基准；深色由**同一套语义 token 换值**得出，不是第二套设计。默认跟随系统 |
| **动效人格** | v2.1 改为 **Swiss Clean Cut**：只允许 opacity 与颜色变化，无位移/缩放，时长上限 150ms（slow 200ms），签名缓动 `cubic-bezier(0, 0, 0.2, 1)`。v2.0 的 Premium 数值已被取代，见 §8 |
| **约束来源** | Wails v2 + WebView2，离线应用（**零网络请求**，不得引用 Google Fonts 等外链），最小窗口 1180×700 |

> 本文件是实现的**唯一权威来源**。组件禁止写死色值/字号/圆角；违反由 §10 的 lint 拦在构建期。
>
> 落地状态（2026-10-06）：token 层、23 个原语、事件层、5 个页面迁移全部完成，本文件描述的就是
> 当前实现（不再是目标态）。验收分两层：`verify:all` 打组件层靶子 `/?primitives`，`verify:pages`
> 打真实页面（dev 假后端供数）。构建与门禁的跑法见仓库根 `README.md`。

---

## 1. 概念与三条不变量

产品本质是**阅读与校对**（双栏对照长文本、上千行 cue 表），不是仪表盘。所以：

1. **界面退到近乎无色。** 内容面板不带阴影、不带内高光；层级只由「surface 浮在 canvas 上」+ 间距 + 1px 网格线表达。少几个盒子＝多一大片空气。瑞士重映射后允许**结构线**（Rail 右缘、状态栏顶缘、表格行、输入框），不允许装饰线。
2. **颜色只出现在人会用笔标注的地方。** 主操作是墨块（`--primary` 实底，浅色纯黑 / 深色纯白），不带彩色。唯一交互色 `--accent`（v2.1 = 瑞士红 `#D40000`，v2.0 是钢笔蓝 `#2B4A8B`）只用于：焦点环、链接、术语命中高亮、当前选中行左缘条、流式光标、Rail 激活项。语义色（danger/warn/ok）只用于状态，且**必须同时带图标与文字**。
3. **留白用在阅读，密度留给操作。** 阅读态（翻译台/引导/设置）留白拉满；操作态（cue 表/历史/模型卡）行高 32px、hairline 分隔——空白由**对齐与分组**产生，不由 padding 堆出来。

---

## 2. 色彩 token

语义命名（角色，不是颜色）。`light` 为基准值，`dark` 为换值。对比度按 WCAG 2.1 相对亮度公式对字面值实算，2026-10-06 随瑞士重映射整表重算。

### 2.1 表面

| Token | light | dark | 用途 |
|---|---|---|---|
| `--canvas` | `#FFFFFF` | `#000000` | 应用底。瑞士式纯白/纯黑，负空间本身即元素 |
| `--surface` | `#FFFFFF` | `#0D0D0D` | 面板/卡片/表格底 |
| `--sunken` | `#F0F0F0` | `#1A1A1A` | 输入框、时间码井、hover 行 |
| `--raised` | `#FFFFFF` | `#111111` | 浮层（popover/drawer/modal/toast） |

### 2.2 线

| Token | light | dark | 用途 |
|---|---|---|---|
| `--line` | `#CCCCCC` | `rgba(255,255,255,.24)` | 网格线、表格行分隔、输入描边 |
| `--line-strong` | `#000000` | `#FFFFFF` | 强调线、浮层描边环、表头底线 |

> 瑞士网格靠可见线组织，面板仍不加装饰阴影；线用于分隔，不用于堆叠层次。

### 2.3 文本

| Token | light | dark | 对 surface（light / dark） | 对 sunken（light / dark） |
|---|---|---|---|---|
| `--ink-1` | `#000000` | `#FFFFFF` | **21.00 / 19.44** | 18.43 / 17.40 |
| `--ink-2` | `#404040` | `#CCCCCC` | **10.37 / 12.10** | 9.10 / 10.84 |
| `--ink-3` | `#6A6A6A` | `#949494` | **5.41 / 6.41** | 4.75 / 5.74 |
| `--ink-inverse` | `#FFFFFF` | `#000000` | 用于 `--primary` 实底上的文字：**21.00 / 21.00** | — |

**三级全部过 AA。** 硬约束：任何文本级 token 在它可能出现的每种底上都不得 <4.5:1。

> `--ink-3` 从 2026-10-04 的 `#767676` 调到 `#6A6A6A`。原值只按白底算过（4.54），实际落在
> `--sunken` 上是 3.99:1（页面门禁在 `verify:pages` 首轮抓到，位置是主翻译台语言栏的
> `AUTO` / `TARGET` 标签），属违约。现值对 sunken 4.75。

### 2.4 交互色与语义色

| Token | light | dark | 对 surface（light / dark） | 对自身 soft 底（light / dark） | 允许用途 |
|---|---|---|---|---|---|
| `--primary` | `#000000` | `#FFFFFF` | 21.00 / 19.44 | — | 主按钮实底。**不带彩色** |
| `--accent` | `#D40000` | `#FF1A1A` | **5.53 / 5.01** | 4.96 / 4.61 | 焦点环、链接、术语高亮、选中行左缘条、流式光标、Rail 激活态 |
| `--danger` | `#D40000` | `#FF1A1A` | 5.53 / 5.01 | 4.96 / 4.61 | 失败、破坏性操作、off-target |
| `--warn` | `#0057B8` | `#6FA8E8` | **6.87 / 7.81** | 6.27 / 6.61 | 下载中、近似达标、需人工检查 |
| `--ok` | `#2E6B4F` | `#5FBF8F` | **6.30 / 8.64** | 5.78 / 7.28 | 完成、校验通过、运行中、离线可用 |

瑞士红取 `#D40000` 而非 `#FF0000` / `#E60000`：`#FF0000` 白底只有 4.0:1，`#E60000` 白底 4.81 但压 soft 底 4.34、压 sunken 4.22，都跌破 AA。

**`--accent` 与 `--danger` 同值**，靠用法区分：danger 只出现在带图标的告警容器与破坏性按钮，accent 只做交互指示与批注。深色主题的 `--accent` / `--danger` 压在 `--sunken` 上是 **4.49:1**，差 0.01 未达标——当前代码没有该组合的真实用法（accent 文本落在 surface 或自身 soft 上），但它是个已知的边界值，若将来把红字放进深色 sunken 底需先提亮一档（`#FF3D3D` 可到 4.96）。

**`--ok` 是语义色里唯一的绿。** v2.1 曾把它并入墨色（中性"通过"），2026-10-06 按用户要求改回绿色并沿用 v2.0 的 `#2E6B4F`：状态栏"模型运行中"的 chip 压在 12% 自身 soft 上与未激活态几乎同色，读不出"就绪"。深色按 accent / warn 的同一手法换值——色相与饱和度不动（H 152 / S 40），只把明度 30 提到 56，得 `#5FBF8F`。逐底实测：light 白 6.30 / `--sunken` 5.53 / 自身 soft 5.78；dark surface 8.64 / sunken 7.74 / 自身 soft 7.28，全部 ≥4.5。**禁止仅用颜色传达状态**这条不变：绿字仍必须与文字标签、图标同现（§7）。

soft 底（badge 背景 / 选中行底）：light 用 `color-mix(in srgb, <token> 6%, transparent)`，dark 用 12%（深底上 6% 不足以成形）。token 名 `--accent-soft` / `--danger-soft` / `--warn-soft` / `--ok-soft`。6% 只决定"够不够淡"，红字能否过 AA 由 `--accent` 本身的值决定。

文本选区（`::selection`）：token `--selection` = `color-mix(in srgb, var(--accent) 24%, transparent)`（实现名 `--suj-selection`，见 §9）；选区文字仍用 `--ink-1`。选区需要比 soft 更重的浓度才看得见，故单独取 24%，且引用 `var(--accent)` 以便深色自动跟随。

**禁止**：紫色系、渐变实底、彩虹状态色、第二个品牌色。

---

## 3. 字体 token

### 3.1 打包策略（离线约束）

三份本地 woff2（全部裁到 wght 400–600），置于 `frontend/src/assets/fonts/`，`@font-face` + `font-display: swap`：

| 文件 | 体积 | 覆盖 |
|---|---|---|
| `public-sans-latin-wght400-600.woff2` | 26.1 KB | 拉丁（中立 Grotesque，USWDS Public Sans） |
| `noto-sans-sc-cjk-wght400-600.woff2` | 1.72 MB | 中文：GB2312 全集 + 假名 + CJK 标点 + 全角；字库覆盖 **7764 个码位 / 7764 个字形**（实测 cmap） |
| `geist-mono-latin-wght400-500.woff2` | 33.8 KB | `.num` 等宽数字/时间码（功能性需求，非风格选择） |

- **v2.2 换字体（2026）**：Archivo → **Public Sans**、JetBrains Mono → **Geist Mono**。中文保持 Noto Sans SC。
  换的理由**不是授权**（三份本来就都是 OFL 1.1，见下），而是视觉口径：Public Sans 是 USWDS 委托设计的中立
  Grotesque，比 Archivo 更贴近瑞士国际主义对「无性格、只承担信息」的要求。
  **换字体的授权收益为零**——OFL→Apache 多一条 NOTICE 义务，OFL→厂商 EULA 义务更重；真正的收益是
  「许可证确实随产物分发 + 保留字体名逐份核过」这两件可证明的事。完整论证见
  `docs/research/font-license-verification-2026.md`。
- **Inter 已弃用并移出仓库**（2026-10-06 瑞士重映射）：风格文档点名 Inter 属过度使用的默认字体。`--font-app` 里不得出现 `'Inter'`，仓库不得再引入 Inter woff2。
- **CJK 策略修订**：v2.0 的"不打包 CJK（单字重 10MB+）"改为**打包常用子集**——全量 Noto Sans SC 变量字体实测 16.9MB，子集化后 1.72MB，exe 净增约 1.74MB（≈+9%）。
  **覆盖边界（必须如实告知）**：子集为 GB2312 档，简体常用字与假名齐；**生僻字、繁体、韩文不在字库内**，浏览器按字形回退系统 `Microsoft YaHei UI`，同一段文本里可能出现字形混排。扩覆盖 = 重跑子集脚本扩大字符集，体积近似线性增长。
- **拉丁覆盖的两处已知缺口（如实记录）**：Public Sans 上游不含 `U+2191 ↑` / `U+2193 ↓`（Archivo 曾含），
  全仓只有 `?primitives` 原语陈列页的标题与说明文字实际渲染这两个箭头，回退系统字体。等宽侧 Geist Mono
  不含 `U+2215 ⁄`（除号斜杠，界面未用）。两种情况都落在字体栈的兜底族上，不影响任何交付页面。
  缺口清单可用 `python tools/fonts/compare-coverage.py` 复现。
- **禁止外链字体**：`index.html` 不得出现 Google Fonts `<link>`（旧 mockups.html 用了，离线应用里等于失效）。
- **许可证**：三份均为 SIL OFL 1.1 —— 该许可**明确允许商用**，并逐字授予
  "use, study, copy, merge, **embed**, **modify**, redistribute, and **sell**"，
  义务只有三条：不得单独售卖字体本身；每份拷贝须附版权声明与许可证；Modified Version 不得用保留字体名。
- **许可证文本随产物分发**：`frontend/public/licenses/OFL-{PublicSans,NotoSansSC,GeistMono}.txt`。
  **必须是 `public/`，不能放 `src/assets/fonts/`**——后者没有被任何模块 `import`，Vite 会静默丢弃，
  结果是字体进了 exe、许可证没进（2026 修复前就是这个状态，OFL §2 当时不满足）。
  单文件 exe 里用户看不到 woff2 的 `name` 表，所以「机器可读元数据」这一路走不通，必须落成独立文本文件。
- **保留字体名（OFL §3）**：子集化会钳制 `fvar` 的 `wght` 轴并重写 `instances`，所以这三份产物都是
  **Modified Version**，§3 生效。逐份核对上游 OFL 原文的结果：
  Public Sans 与 Geist Mono **未声明保留字体名**（用原名合法）；
  Noto Sans SC 的 OFL 是 **Adobe 版权、保留名 `'Source'`**，而子集族名 `Noto Sans SC` 不含 `Source`，亦合法。
  **推论**：将来若给 CJK 子集改名，不得改成任何含 `Source` 的名字；反向地，若要换成别的 OFL 字体，
  必须先读该字体自带的 OFL 原文再决定能否沿用原名（`tools/fonts/report-fonts.py` 可直接打印版权行）。
- **回归锁**：`verify-theme.mjs` #7 断言三份 woff2 均被请求（200）且可用、无站外字体请求、`@font-face` 里不得残留
  Inter 与已退役的 Archivo / JetBrains Mono；
  #11 断言 `dist/licenses/` 三份许可证齐全；#12 是换字体时的许可证审计闸门（新族名未登记即红）。

### 3.2 字体栈（必须单栈，这是修 bug）

```css
--font-app:  'Public Sans', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans SC', 'Microsoft YaHei UI', 'Source Han Sans CN', 'PingFang SC', system-ui, sans-serif;
--font-mono: 'Geist Mono', 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace;
```

拉丁命中内嵌 **Public Sans**；中文命中内嵌 **Noto Sans SC 子集**（`unicode-range` 只声明 CJK/假名/全角，与 Public Sans 互不抢字）。两道内嵌都没命中时才回落系统 Helvetica/Arial/雅黑——也就是 Public Sans 缺失、或字符在 CJK 子集之外时的表现。

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

**字重纪律**：只用 400 / 500 / 600。层级靠字号 + 字重 + ink 级，不靠颜色。

> 自 v2.1 起 600 是**真 600**：Public Sans 与 Noto Sans SC 子集都带 400–600 的变体字重轴，`display`/`title` 得到实打实的 semibold。
> 只有整条字体栈都回落到系统 Arial 时（内嵌字体加载失败）才退化为 Arial Bold(700)——那是降级路径，不是常态。
> 原禁令针对**小字号**在 Windows ClearType 下发糊，因此约束仍然有效：`.text-body`/`caption`/`micro` 只用 400/500。
> **禁止**给 13px 及以下的文本加 600/700。

### 3.4 数字排版（本类工具性价比最高的一条）

所有数字列强制 `font-variant-numeric: tabular-nums` + `--font-mono`：时间码、tok/s、TTFT、VRAM、计数、百分比、下载速度、端口。工具类 `.num`。
> 旧实现时间码列因数字宽度不等而左右抖动，此为根因。

> **换等宽字体为什么没有功能风险**：Geist Mono 与已退役的 JetBrains Mono 都是**天然等宽**——十个数字的
> advance 恒为 600 units（`tools/fonts/report-features.py` 可复算），所以时间码列对齐**不依赖 `tnum` 特性**。
> 两份产物的 GSUB 里都没有 `tnum`，而 `tabular-nums` 依旧成立。`DESIGN.md` §3.3 的字面值来自实测而非假设。

### 3.5 行文限宽

阅读区文本块 `max-width: 72ch`（token `--measure-read`，实现名 `--suj-measure-read`，见 §9）并在栏内居中。**大面积留白靠限制行文宽度产生，不靠加 padding**——1920 宽下双栏每栏 860px 的中文不可读。§10 禁止 `max-w-[72ch]` 任意值，故必须立此 token，2.5–2.9 与 Track C 一律引用它。

第二档：空态正文限宽 `40ch`（token `--measure-body`，实现名 `--suj-measure-body`，见 §9），§5.10 EmptyState 消费。同理禁任意值，Token 于 Task 2.6 补齐。

---

## 4. 几何 token

### 4.1 间距（4px 基线，只允许这些步长）

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`

| 场景 | 值 | 实现（已核） |
|---|---|---|
| 页面内边距 | 32 / 24 | 外壳 `main` 用 `px-7 pt-6 pb-8` = 左右 28、上 24、下 32。28 在 4px 基线上但不是本表列出的步长，属可接受档位；改回 32 需同时验 1180 宽下不挤 |
| 面板内边距（阅读态 / 操作态） | 24 / 16 | `Surface` 的 `dense` 走 16、默认 24（`--suj-*` 无 token，靠 utility `p-4`/`p-6`） |
| 面板之间 | 24 | 设置页 `flex flex-col gap-4` = 16；翻译台 `gap-5` = 20 |
| 面板内分组之间 | 32 | — |
| 控件之间 | 8 | — |
| 图标与文字 | 8 | — |
| 表格列沟槽 | 24 | — |

> 本表是**目标值**，右列是实现现值。两者不一致的行（面板之间 24 vs 16/20、页面内边距 32 vs 28）是尚未收口的漂移，不是已定契约；收口方式是在组件里换成对应步长的 utility，而不是改本表。

### 4.2 圆角（瑞士直角网格）

| Token | 值 | 用途 |
|---|---|---|
| `--radius-xs` | **0** | tooltip（原 3px 已随瑞士重映射归零） |
| `--radius-sm` | **0** | 按钮、输入、seg item、表格单元控件 |
| `--radius-md` | **0** | 面板、popover、drawer 内块、rail item |
| `--radius-lg` | **0** | modal、drawer、toast |
| `--radius-full` | 999px | **仅**状态点、badge 圆点、switch 的圆点字形；不用于任何盒子 |

瑞士风格禁止圆角与装饰性曲率，四个盒子级 token 全部解析为 `0px`。它们**仍要保留为 token**：`@source inline(...)` 与 §10 的"禁止 `rounded-[14px]` 任意值"都依赖这四个名字存在；将来若要恢复曲率，改值即可，组件不动。滚动条 thumb 同样直角（`base.css`）。

### 4.3 高度

| Token | 值 | 用途 |
|---|---|---|
| `--h-control-sm` | 28px | 表格行内操作、紧凑控件 |
| `--h-control` | 32px | 按钮/输入/seg 默认 |
| `--h-control-lg` | 36px | 主 CTA（引导、空态） |
| `--h-row` | 32px | 操作态表格行 |
| `--h-row-lg` | 40px | 舒适态表格行（历史列表） |
| `--h-rail` | **64px**（宽） | 左导航（原 56；实现为 `w-16` = 64，2026-10-06 按实现订正） |
| `--h-rail-item` | 44px | rail 项 44×44（实现 `w-11 h-11`），图标 19px stroke 1.8 |
| `--h-status` | **40px** | 状态栏（原 32；实现为 `h-10` = 40） |

> `--h-control*` / `--h-row*` 由组件直接消费；`--h-rail` / `--h-status` 是 2026-10-06 才按实现改值的两个（56→64、32→40），值现在与 `w-16` / `h-10` 一致。§10 禁止 `h-[32px]` 一类任意值，所以高度必须立 token。

### 4.4 层级（elevation）

瑞士风格**禁装饰阴影**，层级由线表达：

| Token | light 值 | dark 值 | 用途 |
|---|---|---|---|
| `--e-0` | `none` | `none` | **面板默认。禁止给面板加阴影** |
| `--e-1` | `none` | `0 0 0 1px var(--line)` | Segmented 选中态一类的低层微升（浅色下无表现，靠底色区分） |
| `--e-2` | `0 0 0 1px var(--line-strong)` | 同左 | popover / dropdown 的 1px 描边环 |
| `--e-3` | `0 0 0 1px var(--line-strong)` | 同左 | modal / drawer / toast 的 1px 描边环 |

描边环用 `box-shadow` 而不是 `border`，因此组件不必为主题写两套样式，布局也不会因多一条 border 而跳动（`.e-1/.e-2/.e-3` 工具类在 `theme/base.css`）。

**z 序**（契约名，实现加 `--suj-` 前缀，见 §9）：面板 `--e-0` 层 0 → `--z-popover` 10 → `--z-drawer` 20 → `--z-modal` 30 → `--z-toast` 40 → `--z-palette` 50。§10 禁止 `z-[30]` 任意值。

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
- 状态：hover/focus 只改颜色与边框色（`transition-[background-color,border-color,color] duration-150 ease-(--suj-ease-signature)`）；**v2.1 已删除 `active:scale(.98)`**（瑞士下交互不放位移/缩放）；disabled `opacity .45` + `cursor: not-allowed` + `aria-disabled`；loading → 14px spinner 替换前导图标（**spinner 是唯一允许 linear 的动效**）。
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
- 弹层 = popover（`--raised` + `--e-2` + radius `--radius-md`），宽 280（`POP_WIDTH`），内含搜索 Field + `role="listbox"` 列表（虚拟滚动，行高 32，语言全量 152 条）。
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

瑞士重映射把**所有入场位移去掉**：只有 opacity，时长一律 150ms（`--suj-dur-quick` / `--suj-dur-standard` 现在同为 150ms）。

| 组件 | 规格 | 入场 |
|---|---|---|
| Scrim | light `rgba(0,0,0,.40)` / dark `rgba(0,0,0,.60)`（token `--scrim`） | opacity 150ms |
| Modal | max-w 480（`--modal-max`），radius `--radius-lg`(=0)，`--e-3` 描边环，padding 24 | opacity 150ms |
| Drawer（右） | 宽 360（`--drawer-w`）/ 术语本 420（`--drawer-w-lg`），`--e-3` | opacity 150ms |
| Popover | radius `--radius-md`(=0)，`--e-2` | opacity 150ms + 翻转定位 |
| Toast | 右下，radius `--radius-md`(=0)，`--e-2`，图标+文字，4 变体；上限 3 条，error 不自动消失 | opacity 150ms（原 280ms 已收口到 150ms 上限） |
| Tooltip | `--ink-1` 底 + `--ink-inverse` 字，radius `--radius-xs`(=0)，`--text-micro` | fade，延迟 400ms / 淡出 120ms |

统一行为：Esc 只关**最上层**（模块级栈）；焦点陷入浮层内；关闭后焦点**回到触发元素**（`useDismissable` 记录 `document.activeElement`）。
**禁止 `alert()` / `confirm()` / `prompt()`**——旧实现有 8 处，桌面应用里弹系统框最伤质感。确认走 Modal，通知走 Toast。

> 两条踩过的坑（2026-10-06 页面门禁实测）：
> ① 触发元素若在 Modal 打开时被 React **重建节点**，`useDismissable` 记录的那个元素就脱离文档，焦点会落到 `<body>`。根因是子组件定义在组件函数体内（见 §10 新增禁止项），不是焦点逻辑本身。
> ② `initialFocus='cancel'` 靠 `[data-modal-initial="cancel"]` 选择器定位，**footer 里的取消/确认按钮必须打这个标记**；不打则退化为"第一个可聚焦元素"，恰好是取消也不构成契约。

### 5.10 EmptyState

居中；48px 线性图标（`--ink-3`，stroke 1.5，lucide）；标题 `--text-title` `--ink-2`；正文 `--text-caption` `--ink-3` 限宽 40ch；**一个**主操作（`lg`）。留白即装饰——不使用点阵网格背景（旧签名细节，本版废弃）。

### 5.11 Skeleton

`--sunken` 底 + 目标同圆角（瑞士下即直角）；**静态占位，无 shimmer 呼吸**（`.skeleton { opacity: .75 }`）。
瑞士重映射去掉了原来的 `opacity .6→1 / 1200ms` 动画——装饰性循环动效在本风格里不成立。只允许出现在任务区，**禁止整页遮罩**。

### 5.12 焦点环

```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```
任何 `outline: none` 必须同时给出替代可见焦点样式。旧实现 6 处 `outline-none` 无替代。
实现落在 `theme/base.css` 且**不分层**，因此优先于 utility 层的 `outline-none`。

### 5.13 外壳

瑞士重映射允许外壳用结构线（v2.0 的"无底板、无右边框"已废）：

- **Rail**：宽 64（`w-16`，token `--h-rail`），`--surface` 底 + 右缘 `1px --line`。顶部 logo 36×36 方块（`--accent` 底 + `--canvas` 字）。项 44×44（`--h-rail-item`），图标 19px stroke 1.8；激活 = `--accent` 图标 + `--accent-soft` 底 + 左缘 `2px --accent` 竖条（`-left-2.5` = -10px，正好是 rail 64 减 item 44 的一半；曾用 `-left-[10px]` 任意值，2026-10-06 已收口，同时 lint 的任意值前缀表补上了 `left|right|top|bottom|inset`）；hover = `--sunken` 底；未激活图标 `--ink-3`。每项 `title` 提示；有进行中任务的页在右上显示 6px `--ok` 点。
- **StatusBar**：高 40（token `--h-status`），`--surface` 底 + 顶缘 `1px --line`，`--text-micro` + `--font-mono` + `--ink-2`，项间距 16（**不用竖线分隔符**，留白即分隔）；可点项是真实 button。**整条横跨窗口全宽**（不缩在 rail 右侧），顶缘结构线因此是一条连续线，rail 的右缘线止于状态栏上沿，左下角不成缺口。左内缩 = `--h-rail` + `--pad-shell-x`（92），使首个 chip 与页面内容左缘对齐——同一值由 `main` 的 `padding-inline` 共用，对齐是写死的契约不是巧合。40px 高的条不允许任何一项换行：整条 `whitespace-nowrap` + `overflow-hidden`，挤压只由两处吸收——VRAM 进度条先缩（`w-24` → `min-w-4`），不够再截「全本地推理 · 零遥测」（`min-w-0 shrink truncate`）；chip、显存读数、倒计时一律 `shrink-0`。
- 导航目标：翻译台 / 字幕 / 文档翻译 / 模型 · 术语 / 设置（5 项可点）。**文档翻译原为 disabled 项**（2026-10-08 及之前「如实标注的未实现项」处置：标题带「（M5 提供）」、`opacity-30` + `cursor-not-allowed`），M5 落地后于 2026-10-09 解灰——标题去后缀、与其余四项同权（可点、无 `opacity-30`）。旧实现"可点但指向占位页"是假入口，两者按 §10 分别处置；占位页已随接线删除。

---

## 6. 布局与断点

### 6.1 应用骨架（已实现）

```
grid-template-columns: var(--h-rail) 1fr;      /* 64px 1fr */
grid-template-rows: 1fr var(--h-status);       /* 1fr 40px */
grid-template-areas: "rail main" "statusbar statusbar";
```

`main` = `overflow-hidden pt-6 pb-8` + `padding-inline: var(--pad-shell-x)`（28）。状态栏占满第二行整行（2026-10-06 起，原为 `"rail statusbar"` 让 rail 下探），左内缩 = rail + `--pad-shell-x`，与 `main` 的内容左缘同值。**§6.1 原写的「≥1680 时 main 限宽 1440 居中」未实现**（`App.tsx` 无此规则），当前是全宽。

### 6.2 断点（部分落地）

**模型卡栅格已落地**（2026-10-06）：`--breakpoint-wide: 1380px`（Tailwind v4 断点即 `@theme` 变量）
+ `grid-cols-2 wide:grid-cols-3`，实测 1180 宽两列（每列 522px）、1440 宽三列（每列 429px）。
其余行仍未实现——`frontend/src` 内除 `prefers-reduced-motion` 外没有别的媒体/容器查询，
版面保护仍来自最小窗口 1180×700（`main.go` 的 `MinWidth/MinHeight`）。

| 断点 | 目标行为 | 状态 |
|---|---|---|
| `< 1180` | 历史侧栏 / cue 详情 / 术语侧栏 → 抽屉唤出；模型卡 1 列；翻译台内边距降到 24 | 未实现（窗口本身不允许小于 1180） |
| `1180 – 1379` | 历史侧栏 240px；**模型卡 2 列**；cue 详情 320px | 模型卡已落地；侧栏与 cue 详情仍是固定值（见 §6.3） |
| `1380 – 1679` | 历史侧栏 260px；**模型卡 3 列**；cue 详情 1fr | 模型卡已落地；其余未实现 |
| `≥ 1680` | 内容限宽 1440 居中；模型卡 3 列 | 模型卡已落地；限宽未实现 |

面板级响应优先用 **container query**（`@container`），只有应用骨架用 media query。这条仍是要求，只是尚未落地。
模型中心顶栏另有独立的窄窗加固（`flex-wrap` 整块换行 + VRAM 条可收缩 + 按钮 `whitespace-nowrap`），
实测 1036 宽下顶栏折成两行且按钮文字不换行。

### 6.3 各屏布局（右列为实测现值）

| 屏 | 目标结构 | 实现现值 |
|---|---|---|
| 翻译台 | 三栏 `260px / 1fr / 320px`（历史 / 双栏读写 / 约束抽屉唤出态）；双栏间 32px 沟槽 + `1px --line` 竖分隔；每栏限宽 72ch 居中 | `236px 1fr`（历史 / 工作区）；约束与术语走 **Drawer 覆盖**而非第三列；沟槽与竖分隔按 `gap-5`＝20 |
| 字幕 | 工具栏（单行，`flex-wrap`，高 32 控件）+ `1.6fr / 1fr`（cue 表 / 详情） | `1.55fr 1fr`；cue 表列宽 `44px 132px 1fr 1fr 96px`，**列沟槽 10**（不在 §4.1 步长表内，属待收口漂移） |
| 模型 | VRAM 概览条 + 卡片栅格（1/2/3 列随断点）+ 下载源条 | `flex flex-col gap-4` **单列竖排**，无栅格 |
| 术语 | 两栏 `280px / 1fr`（术语本列表 / 词条表）；词条表用 DataTable | 术语本目前是约束抽屉里的**选择器**，无独立两栏页（`Save/Delete/ExportGlossaryCSV` 无 UI，见 README 已知限制） |
| 设置 | 单列 `max-width 720px` 居中；分组用 Surface，行高 48 | `max-w-4xl`（896px）居中；分组用带 `border-t` 的 Row |
| 引导 | 覆盖层，卡片 `max-width 560px` 居中；**不阻塞** | 覆盖层，**未见 max-width**；未就绪时主界面顶部常驻横幅这条未实现 |

---

## 7. 可访问性契约（每条可验证）

1. 所有文本 token 对其所在表面对比度 ≥ 4.5:1，两个主题都成立（§2 已给实算值）。
2. 所有可交互元素：真实语义元素 + ≥28px 命中高度 + `:focus-visible` 焦点环。
3. Tab 序：rail → 页面内容（按视觉顺序）→ 状态栏。浮层打开时焦点陷入，关闭后回到触发元素。
4. 状态不得仅靠颜色传达：badge 必带文字；danger/ok 必带图标。
5. Esc 关闭最上层浮层；Ctrl+Enter 翻译；Ctrl+Shift+C 复制译文；Esc 取消进行中任务（无浮层时）；Ctrl+Q 退出。**Ctrl+K 命令面板未实现**（原计划项，属待办）。
6. `prefers-reduced-motion: reduce` 全覆盖：去位移、保 opacity、时长归零（旧实现只覆盖 2 个选择器）。实现是 `theme/base.css` 里**全站唯一**的一个降级块，禁止在组件内散落判断。
7. 所有输入有可见标签或 `aria-label`；错误用 `aria-describedby` + `aria-invalid`。
8. **验收方式**：Playwright + axe 实测，要求 **0 critical、0 serious**。不靠人工目测。分两层执行：
   - `npm run verify:all` → 组件层，靶子 `/?primitives`（全部原语与全部状态），1180/1366/1680 × light/dark
   - `npm run verify:pages` → 页面层，靶子 5 个真实页面（`?mock` 假后端供数），1180/1680 × light/dark
   另有对比度实测（`verify-contrast`，全部可见文本 ≥4.5:1）与键盘流程实测（`verify-keyboard`）。

> 门禁当前留下的 moderate（不阻塞，但已知）：真实页面各 1 条 `page-has-heading-one`（页面标题是刻度标签 `<span>`，全仓唯一 `<h1>` 在陈列页），引导页另有 `landmark-one-main` + `region ×12`（向导根元素是 `<div>`，没有 `<main>`）。本契约没有强制 h1/landmark，所以是待办不是违约。

---

## 8. 动效（摘要）

**v2.1 已把动效人格从 Premium 改为 Swiss Clean Cut。** `spark-output/context/motion-plan.json` 里那份 Premium 规格（quick 180 / standard 320 / slow 520、`cubic-bezier(0.4, 0, 0.2, 1)`、入场 `translateY(8px)+opacity`）**已被取代**，只在历史上有效——该文件未重新生成，读它的人请以此节为准。

实现值（`theme/base.css` 末尾的动效 token）：

```css
--ease-signature: cubic-bezier(0, 0, 0.2, 1);  /* ease-out */
--dur-quick:    150ms;
--dur-standard: 150ms;   /* 上限 150ms */
--dur-slow:     200ms;   /* 仍低于风格文档的 300ms 禁线 */
```

- **只允许 opacity 与颜色变化。** 入场一律纯淡入：页面切换 `.screen-in`、浮层 `.enter-pop/.enter-scrim/.enter-modal/.enter-drawer/.enter-toast` 全部 `opacity 0→1`，**无 translateY / translateX / scale**。v2.0 那些 `translateY(8px)`、`translateX(16px)`、按钮 `active:scale(.98)` 已全部删除。
- **两处登记在案的空间过渡例外**（都是功能性的，不是装饰）：
  ① Toast 列表变化时已有条目用 FLIP 以 `transform` 平滑让位（`Toast.tsx:94`，150ms），避免内容突然跳动；
  ② `Button` 带 `arrow` 时箭头 `group-hover:translate-x-1`（150ms），提示"点击会往前推进"。
  新增第三类位移必须先在这里登记理由。
- **稀疏原则不变**：同一时刻只允许一个元素在动。流式光标 `.caret`（1s `steps(1)` 闪烁）是唯一持续动效，`spinner` 是唯一允许 `linear` 的动效（`animate-spin` 1s）。
- **数据行永不做入场动画**：cue 表 / 历史列表 / 术语表禁止 stagger。
- **Skeleton 不做 shimmer**（见 §5.11）。
- **禁止**：弹跳、缩放夸张、box-shadow 动画、width/height 动画、整页遮罩加载。
- **reduced-motion 降级**（全站唯一块，`base.css`）：动画/过渡时长归 `.01ms` 并停止循环；`.caret` 改常亮（保留"仍在生成"的信息）；`.pulse` 停止呼吸但保持可见；`.spinner` **降速到 1600ms 而非移除**（完全移除会被当成卡死）。回归锁 = `verify-keyboard` 的 RM1/RM2/RM3。

---

## 9. 主题切换与启动白闪

- 主题由 `<html data-theme="light|dark">` 驱动；token 定义在 `:root`（light）与 `[data-theme="dark"]`，dark 块必须排在 light 块之后（同特异性，靠源码顺序取胜）。
- 三档：`light` / `dark` / `system`（跟随 `prefers-color-scheme`，`watchSystemTheme()` 运行时监听；用户显式选了 light/dark 时不被系统偏好覆盖）。
- **持久化的真实链路**（Track C 落地，但有两个写入点、一个读取点）：设置页改主题时同时做两件事——`applyTheme(mode)` 写 `localStorage['indexvt.theme']` 并立即改 `data-theme`；`save()` 把 `cfg.appearance.theme` 写进 Go 侧 SQLite。启动时**只有 localStorage 被读回**（`index.html` 内联首屏脚本 + `main.tsx` 的 `storedTheme()`），`cfg.appearance` 目前无人读取，等于存档不参与决策。字号同理（`indexvt.fontSize`）。清掉 localStorage 而数据库里还留着配置时，主题不会跟随。
- `index.html` 内联首屏脚本在**首帧之前**写好 `data-theme`，避免 CSS 生效前的闪色；`<meta name="color-scheme" content="light dark">` 已设；Wails 侧 `options.App.BackgroundColour` 已设（`main.go:96`）。
  > **未验证项**：`BackgroundColour` 目前是固定纯白（= 浅色基准），深色主题下 WebView2 在 HTML 首帧之前的那一层背景仍是白。深色首帧到底闪不闪需要真机观察（README 的 UNVERIFIED 清单里那条），静态白值很可能不够，正解是按已存主题决定窗口底色或在主题解析完成前保持透明。
- `@theme` 映射规则（**修旧实现的自引用 bug**）：颜色用 `@theme inline { --color-surface: var(--suj-surface); }`（`--suj-surface` 与 `--color-surface` **不同名**，无环）；几何/字体直接在 `@theme` 内给字面值（瑞士下 `--radius-sm: 0px;`），**禁止** `--radius-sm: var(--radius-sm)` 这类同名自引用（= CSS 变量成环 = guaranteed-invalid）。

### 9.1 `--suj-` 前缀：来历与现状

**来历（v2.0，2026-10-04）**：旧 `frontend/src/styles/tokens.css`（碳墨暗色，6 个页面 203 处旧 utility 依赖）在非分层 `:root` 里定义了同名 `--ink-1/--accent/--danger/--warn`。新旧同名 + 同特异性 → 只看源码顺序 → 素笺浅色墨覆盖旧碳墨底 → `text-ink-1` 落在 `bg-bg-3` 上 = **1.11:1 不可读**（Fix round 1 实测的阻塞缺陷）。所以当时规定：新层**每一个原始自定义属性**都加 `--suj-` 前缀，与旧层零重名。

**现状（2026-10-06，Track C 之后）**：旧 `styles/tokens.css` 与旧 `components/ui.tsx` **已删除**，共存前提消失。但：

- 前缀**保留**，不去掉。改名会牵动 tokens.css/base.css/23 个原语/陈列页/`verify-theme` 的多条断言，收益只有"少几个字符"，且历史文档与代码注释都按 `--suj-*` 书写。
- `--font-mono` 是非前缀的**唯一例外**（它是 `font-mono` utility 的 `@theme` 键，加前缀会变成 `font-suj-mono`）。`tokens.css` 末尾那条非分层重申当初是用来压旧文件的同名 `:root`；旧文件没了之后它理论上可删，但它现在是 `verify-theme` #6 的回归锁对象，**留着**。
- 契约层照旧：本文档 §2/§3/§4 用**语义名**（`--canvas` / `--ink-1` / `--e-1` / `--h-control` / `--z-popover` / `--measure-read` / `--selection` …），实现名 = 语义名 + `--suj-` 前缀，一一对应。
- **utility 名永不加前缀、永不改名**：`bg-canvas` / `text-ink1` / `rounded-sm` / `font-mono` 是稳定消费面，前缀对它们透明。

---

## 10. 反模式与漂移防线

### 禁止项

| 禁止 | 说明 |
|---|---|
| 组件内写死 `#hex` / `rgb()` | 一律走 token |
| Tailwind 任意值 `text-[13px]` / `rounded-[14px]` / `-left-[10px]` | 旧实现 58 处；一律用 token utility 或 4px 刻度档（偏移用 `-left-2.5`，不用 `-left-[10px]`） |
| 同一元素上冲突的重复 utility | 旧实现 `px-4.5 … px-4` 两处 |
| `outline-none` 无替代焦点样式 | 6 处 |
| `line-clamp-*` 与显式 display（`block`/`flex`/`grid`）同元素 | clamp 依赖 `display:-webkit-box`，被覆盖即静默失效（历史条目实测：不缩略且无任何报错）。回归锁 = lint 规则 `clamp-display-conflict` |
| `div`/`span` + `onClick` 作为唯一可达方式 | 旧实现全仓如此 |
| `alert` / `confirm` / `prompt` | 8 处 |
| 面板加装饰阴影 | 层级靠 surface + 间距 + 1px 结构线 |
| emoji 当图标 | 旧实现 📄 🎬；图标只用 lucide-react |
| 数据行入场动画 / stagger | — |
| 整页加载遮罩 | 只用任务区 skeleton |
| 没有 `onChange` 的 Segmented / Switch | 旧实现 3 处死控件。v2.1 例外允许：**如实标注的只读说明**（如「关闭程序时：退出即释放」只有这一种实现），但不得伪装成可选项 |
| 假入口（可点但指向未实现功能） | 旧实现文档翻译。**不可点 + 自带 M5 说明**的置灰项不算假入口（§5.13） |
| **在组件函数体内定义子组件**（`const Row = (…) => …`） | v2.1 新增。每次渲染都是新的组件类型 → React 卸载重建整棵子树。后果实测过两例：输入框敲第二个字符就丢焦点；Modal 打开销毁触发节点，关闭后焦点落到 `<body>`。子组件必须提到模块作用域 |
| **假设绑定的返回值形状** | v2.1 新增。`ListUnknownModels` 返回 `[]ModelInfo`，页面按 `string[]` 用 `path.split()` → 有未知模型时整页白屏。消费 Wails 绑定前先看 Go 侧结构体的 json tag，或在边界显式取字段 |
| **文本色只按白底算对比度** | v2.1 新增。`--ink-3` 与瑞士红都曾因此跌破 AA（白底过、`--sunken` 或自身 soft 底不过）。§2 的两列对比度（对 surface / 对自身 soft）就是为这条而加 |

### 漂移防线（纳入 `npm run build`）

一条零依赖 Node lint 脚本 `frontend/scripts/lint-design-tokens.mjs`，扫描 `frontend/src/**/*.{ts,tsx,css}`，命中即 **构建失败**：

1. `raw-color`：`#[0-9a-fA-F]{3,8}` 或 `rgba?\(`
2. `arbitrary`：`text|rounded|p|m|gap|w|h|leading|tracking|border|left|right|top|bottom|inset` + `-[…]`
3. `no-outline`：`outline-none`
4. `div-click`：`<div|span … onClick=`
5. `native-dialog`：`alert(` / `confirm(` / `prompt(`
6. emoji 码位区间
7. `@import url(` / `fonts.googleapis`

并存期豁免清单 `frontend/scripts/design-lint-legacy.txt`：Track B 时 13 行（6 页面 + 旧外壳 + 旧原语 + 旧 tokens.css），Track C 迁移完逐行删，**现在只剩 1 行 `src/wailsapi.ts`**（绑定薄封装，无样式，因 `declare global` 的 any 用法保留）。新文件禁止进清单。

外加 `tsc --noEmit` 开启 `noUnusedLocals` + `noUnusedParameters`（旧实现有未使用的 `Upload` 导入与 `apiStarHistory` 死导入，靠这两个开关拦住）。

---

## 11. 与 v1.0 的差异（迁移说明）

| v1.0（作废） | v2.x（本文件） |
|---|---|
| 碳墨暗色 + 琥珀品牌，单一主题 | 浅色基准 + 深色同套 token，默认跟随系统 |
| 琥珀 = 品牌/配音/倒计时/当前态（一色多义） | 主操作＝墨块无彩色；`--accent` 只表交互/批注 |
| 面板带边框 + `--shadow-1` 内高光分层 | 面板无阴影，靠 surface + 间距 +（外壳）1px 结构线分层 |
| 点阵网格空态背景、双栏点状虚线中缝 | 全部废弃；留白即装饰，中缝改 1px 实线 |
| `--ink-3` 2.9:1 用于栏目标题 | 三级文本在所有可能的底上都 ≥4.5:1 |
| 交换按钮悬停旋转 180° 作为「品牌记忆点」 | 废弃（旋转不传递信息） |
| IBM Plex 未打包 + mockups 用 Google Fonts 外链 | 系统 Helvetica/Arial 栈 + 本地 JetBrains Mono woff2 子集；禁止外链 |
| 设计基准 1366/1920，断点写在文档里但代码零实现 | 断点仍未实现（§6.2 已如实标注），契约是 1180/1380/1680 + container query |
| 6/14 界面落地，8 个后端 API 无 UI，3 处死控件 | 5 个页面全部迁移并接线；术语本仍只有选择器没有管理页；死控件按 §10 例外规则处置 |

`legacy/mockups.html` 与 `legacy/设计系统规范.md` 于 2026-10-05 归档，只作历史参考，不作为实现依据。

---

## 12. v2.0「素笺」→ v2.1 瑞士重映射（2026-10-06）

用户指令：整体切换为 Swiss International Style。**语义名与 utility 名一个都没改**，换的是 token 值、几何与动效语法，因此组件层零改动、页面层照旧消费同一批类名。

| 维度 | v2.0 素笺 | v2.1 瑞士（现值） |
|---|---|---|
| 底色 | 暖白 `#FBFBFA` / 深炭 `#131312` | 纯白 `#FFFFFF` / 纯黑 `#000000` |
| 墨色 | ink-1 `#1A1A18`、ink-2 `#55554F`、ink-3 `#6E6E68` | `#000000` / `#404040` / `#6A6A6A`（ink-3 又因 sunken 违约调深一档） |
| 强调色 | 钢笔蓝 `--accent` `#2B4A8B` / `#8AA6E8` | 瑞士红 `#D40000` / `#FF1A1A` |
| danger / warn / ok | `#B42318` / `#8A6212`(琥珀) / `#2E6B4F`(绿) | `#D40000`（同 accent）/ `#0057B8`（蓝）/ 墨色（中性"通过"）**→ ok 已于 2026-10-06 改回 `#2E6B4F` / `#5FBF8F`，见 §2.4** |
| soft 底 | 8% / 14% | 6% / 12% |
| 圆角 | 3 / 6 / 10 / 14px | 全部 0（`--radius-full` 仍留给圆点字形） |
| elevation | 真阴影 `0 8px 24px …` | 禁阴影；浮层用 `0 0 0 1px` 描边环 |
| 字体 | Inter（本地 woff2）+ JetBrains Mono | Helvetica/Arial 系统栈 + JetBrains Mono；**Inter 已弃用并移出仓库** |
| 动效 | Premium：quick 180 / standard 320 / slow 520，入场 `translateY(8px)+opacity` | Clean Cut：150 / 150 / 200ms，只 opacity 与颜色；`active:scale` 与位移入场删除（例外见 §8） |
| 外壳线 | Rail 无底板无右边、状态栏仅顶边 | Rail 与状态栏都有 `--surface` 底 + 1px 结构线；Rail 宽 56→64、状态栏高 32→40 |

**这次重映射顺带暴露并修掉的契约违约**（都由 `verify:pages` 首轮抓到，详见 README「当前状态」）：
`--ink-3` 与瑞士红只按白底算过对比度；`Settings` 在组件体内定义 `Row` 导致输入丢焦点与 Modal 焦点归还失败；
`ModelHub` 误判 `ListUnknownModels` 的返回形状；`Settings` 三个数字输入缺 `aria-label`。

**尚未随同更新的下游产物**：`spark-output/context/motion-plan.json`（仍是 Premium 数值）与
`spark-output/prd/sujian-gui-redesign.md`（仍描述素笺色值）——它们与 v2.1 冲突时以本文件为准。
