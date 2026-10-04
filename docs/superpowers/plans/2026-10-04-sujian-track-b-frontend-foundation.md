# Track B 前端地基 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付「素笺」设计系统的前端地基——双主题语义 token、23 个全键盘可达的 UI 原语、单点订阅多路分发的 Wails 事件层、以及把 token 漂移拦在构建期的 lint —— 使后续页面重写（Track C）只需组合，不再各自造轮子。

**Architecture:** 三层：`theme/`（token 与主题运行时）、`lib/`（Wails 绑定/事件分发、错误映射、虚拟化、格式化）、`components/ui/`（23 个原语）。页面层不在本计划内。**新旧 token 层并存**：现有 6 个页面仍引用 `styles/tokens.css` 的旧 utility（实测 203 处），Track B 只**新增**新层，Track C 迁移页面后才删除旧文件。

**Tech Stack:** React 18 + TypeScript 5.7 + Tailwind CSS 4（`@theme`/`@theme inline`）+ zustand 5 + lucide-react + Vite 6；devDependency 新增 `playwright` + `@axe-core/playwright`（a11y 验收矩阵）；**运行时依赖不变**。

**Spec:** `docs/superpowers/specs/2026-10-04-gui-redesign-and-defect-fixes-design.md`（§3.1 目录结构、§4 数据流、§5 错误处理、§6 主题实现、§8.2 验证矩阵、B32）
**视觉契约:** `docs/03-GUI设计图/DESIGN.md`（§2 token 实算值、§3 字体、§4 几何、§5 组件规格、§6 布局断点、§7 a11y 8 条、§10 反模式与 lint）
**动效契约:** `spark-output/context/motion-plan.json`（Premium · 16 条 element_specs · reduced-motion 单一降级块）
**需求与验收:** `spark-output/prd/sujian-gui-redesign.md`（S2 事件层/部分译文渲染、S8 键盘可达与焦点环、S7 主题字号）
**姊妹计划:** Track A 后端止血（已完成并合并 master，31 提交）

## Global Constraints

- **token 值一律照抄 `DESIGN.md` §2/§3/§4 的字面值**，禁止"优化"色值或圆角。三级文本 token 对 `--surface` 的对比度已实算：light 17.4 / 7.5 / 5.1，dark 14.7 / 7.3 / 4.8 —— 全部 ≥4.5:1，改动任一色值都必须重算并在报告里给出新值。
- **运行时依赖不变**：`dependencies` 只允许 `react` `react-dom` `zustand` `lucide-react`。新增仅 `devDependencies`：`playwright` + `@axe-core/playwright`。
- 虚拟滚动自实现（`lib/virtualizer.ts`，约 40 行），**不引 react-window/react-virtual**。
- `@theme inline` 里的颜色变量必须**异名**（`--color-surface: var(--surface)`）；几何/字体走 `@theme` 给**字面值**。**禁止** `--radius-sm: var(--radius-sm)` 这类同名自引用（旧 `styles/tokens.css:65-70` 就是这个 bug，CSS 自定义属性成环即失效）。
- `--font-app` 必须是**单一栈**，CJK 字体排在通用族 `system-ui`/`sans-serif` **之前**。旧实现的 `var(--font-latin), var(--font-cjk)` 把中文栈排在通用族之后 → 中文永不可达（已浏览器实测确认）。
- 离线应用：`index.html` 与任何 CSS 中不得出现 `fonts.googleapis`/`fonts.gstatic`/`@import url(` 等外链字体。字体一律本地 woff2（网络实测可达，vendoring 可行）。
- 所有可交互原语必须是**真实语义元素**（`<button>` / `<input>` / `role="switch"` / `role="radiogroup"` / `role="listbox"`）+ `:focus-visible` 焦点环。禁止 `div`/`span` + `onClick` 作为唯一可达方式。
- 禁止 `alert()` / `confirm()` / `prompt()`（现有 8 处，由 Modal/Toast 取代）。
- **数据行永不做入场动画**（cue 表 / 历史 / 术语表禁止 stagger）。
- 动效只用 `--dur-quick|standard|slow` 与 `--ease-signature`；`prefers-reduced-motion` 降级**只在 `theme/base.css` 的单一媒体查询块内**，禁止组件内散落判断。
- 不新增产品能力：cue 编辑、长文档翻译、实时翻译、托盘、ASS 样式面板、**字幕页术语选择器**（后端 `TranslateCueFn` 不传术语，Track A 已核实）一律不做。
- **Track A 交接项必须落地**（否则后端修好的东西用户仍看不到）：
  - **R17**：翻译台在 `phase === 'error'` 时必须**同时**渲染已收到的 `output` 与错误提示；`app.go` 只在成功分支发 `done["output"]`，因此 Track C 需同步让后端在 error 分支也带 output（记为 Track C 后端小改）。
  - **SubGetDoc + CueProgress.Translated**：事件层必须暴露这两个消费点，字幕页据此实时刷新译文列并在队列结束后拉一次权威快照。
- **B32**：`tsconfig.json` 的 `noUnusedLocals` / `noUnusedParameters` 由 `false` 改为 `true`。现有代码有未使用导入（`ModelHub.tsx` 的 `Upload`、`MainTranslate.tsx` 的 `apiStarHistory`），开启后会编译失败 → **必须在同一任务里清掉这些死导入**，不得为此把开关关掉。
- 每个 Task 结束时：`npx tsc --noEmit`、`npm run lint:design`、`npm run build` 三者全绿，并跑本 Task 对应的 a11y/探针验证。
- **本 Track 不删除任何现有页面或组件**（Track C 负责迁移与删除）。`styles/tokens.css` 保留。

## 并存期的 lint 策略（重要，否则 build 立刻失败）

现有 6 个页面 + 4 个旧组件含约 60 处硬编码色值、58 处 Tailwind 任意值、6 处 `outline-none`、8 处 `alert/confirm`、2 处 emoji。lint 一旦生效，`npm run build` 会立刻失败。

处理方式：**文件级 legacy 白名单**，而不是放宽规则。

- lint 脚本读 `frontend/scripts/design-lint-legacy.txt`（一行一个相对路径），其中的文件跳过检查。
- 初始内容 = 迁移前的全部旧文件（`src/pages/*.tsx`、`src/components/{Rail,StatusBar,ui}.tsx`、`src/LangSelect.tsx`、`src/App.tsx`、`src/stores/appStore.ts`、`src/wailsapi.ts`、`src/styles/tokens.css`）。
- **新建文件一律不得进白名单**；lint 对非白名单文件零容忍。
- Track C 每迁移完一个页面就从白名单删一行 —— 白名单长度即"迁移进度"的可视化度量。
- 额外规则：非白名单文件中**禁止使用旧 token utility**（`bg-bg-*`、`text-ink-[123]`、`border-hairline*`、`*-soft` 旧名），防止新旧混用。

## 文件结构

```
新建
  frontend/src/theme/tokens.css              2.1  语义 token（light + dark）+ @theme 映射
  frontend/src/theme/base.css                2.1  reset / focus-visible / 滚动条 / reduced-motion 单一块 / 动效 token
  frontend/src/theme/theme.ts                2.1  applyTheme / applyFontSize / watchSystemTheme / stored*
  frontend/src/assets/fonts/*.woff2          2.1  Inter + JetBrains Mono latin 子集（vendored）
  frontend/scripts/lint-design-tokens.mjs    2.2  零依赖 token 漂移 lint
  frontend/scripts/design-lint-legacy.txt    2.2  并存期白名单
  frontend/scripts/verify-a11y.mjs           2.2  Playwright + axe 矩阵（宽度 × 主题 × 页面）
  frontend/scripts/verify-theme.mjs          2.1  计算样式探针（token 生效 / CJK 栈顺序 / 主题切换）
  frontend/scripts/verify-wails.mjs          2.3  事件分发器浏览器探针（多路分发 / 退订隔离 / 早到缓冲）
  frontend/src/lib/wails.ts                  2.3  绑定调用 + 单点订阅多路分发 + 早到事件缓冲
  frontend/src/lib/errors.ts                 2.3  Go error → 类型化 AppError
  frontend/src/lib/format.ts                 2.4  时间码 / 字节 / 速率 / 百分比
  frontend/src/lib/virtualizer.ts            2.4  窗口化（约 40 行）
  frontend/src/components/ui/*.tsx           2.5–2.9  23 个原语
  frontend/src/components/ui/index.ts        2.5  barrel 导出
  frontend/src/pages/_Primitives.tsx         2.5  dev-only 原语陈列页（axe 靶子，交付前删除）
修改
  frontend/src/main.tsx                      2.1  引入新 theme 层（保留旧 tokens.css 至 Track C）
  frontend/index.html                        2.1  防白闪内联脚本 + color-scheme meta
  frontend/tsconfig.json                     2.2  B32 两个开关
  frontend/package.json                      2.2  lint:design / verify:* 脚本 + devDependencies
```

---

## Task 2.1: 双主题 token 层 + 主题运行时 + 字体 vendoring

**Files:**
- Create: `frontend/src/theme/tokens.css`、`frontend/src/theme/base.css`、`frontend/src/theme/theme.ts`、`frontend/src/assets/fonts/`、`frontend/scripts/verify-theme.mjs`
- Modify: `frontend/src/main.tsx`、`frontend/index.html`

**Interfaces:**
- Consumes: 无（本 Track 第一个任务）
- Produces（Tailwind utility 名，后续所有 Task 与 Track C 直接消费）:
  - 颜色：`bg-canvas` `bg-surface` `bg-sunken` `bg-raised` `border-line` `border-lineStrong` `text-ink1` `text-ink2` `text-ink3` `text-inkInverse` `bg-primary` `text-primary` `text-accent` `bg-accentSoft` `text-danger` `bg-dangerSoft` `text-warn` `bg-warnSoft` `text-ok` `bg-okSoft`
  - 圆角：`rounded-xs`(3) `rounded-sm`(6) `rounded-md`(10) `rounded-lg`(14) `rounded-full`
  - 字号：`text-display`(20/28/600) `text-title`(15/22/600) `text-read`(15.5/1.9) `text-body`(13.5/1.6) `text-caption`(12/1.5) `text-micro`(11/1.4/500)
  - 字体：`font-app` `font-mono`；`.num`（`tabular-nums` + mono）；`.e-2` `.e-3`
  - 动效：CSS 变量 `--dur-quick`(180ms) `--dur-standard`(320ms) `--dur-slow`(520ms) `--ease-signature`
  - TS：`type ThemeMode = 'light'|'dark'|'system'`、`type FontSize = 'small'|'standard'|'large'`、`applyTheme(mode)`、`applyFontSize(size)`、`watchSystemTheme(cb): () => void`、`storedTheme()`、`storedFontSize()`

- [ ] **Step 1: 写 `theme/tokens.css`**

按 `DESIGN.md` §2/§3/§4 的字面值抄写。三段结构，顺序不可颠倒：

```css
@import "tailwindcss";

/* ── light（设计基准）── */
:root, [data-theme="light"] { /* --canvas/--surface/--sunken/--raised、--line/--line-strong、
  --ink-1..3/--ink-inverse、--primary/--accent/--danger/--warn/--ok、四个 *-soft（color-mix 8%）、
  --e-2/--e-3、--scrim、color-scheme: light */ }

/* ── dark：同一套语义 token 换值，不是第二套设计 ── */
[data-theme="dark"] { /* 同名字段，DESIGN.md §2 的 dark 列；*-soft 用 14%；
  --e-2/--e-3 改为 0 0 0 1px var(--line-strong)（深色下阴影不可见，靠描边分层）；color-scheme: dark */ }

/* ── 几何/字体：@theme 内给字面值。禁止 --x: var(--x) 同名自引用 ── */
@theme { --radius-xs:3px; --radius-sm:6px; --radius-md:10px; --radius-lg:14px;
  --font-app:'Inter','Microsoft YaHei UI',…; --font-mono:'JetBrains Mono',…;
  --text-display:20px; --text-display--line-height:28px; --text-display--font-weight:600; /* …六级 */ }

/* ── 颜色：@theme inline + 异名变量（值随 data-theme 切换，且 --color-x 与 --x 不同名不成环）── */
@theme inline { --color-canvas: var(--canvas); --color-surface: var(--surface); /* …全部 */ }
```

两条必须写进文件注释的要点：① `--font-app` 单一栈、CJK 在通用族之前（旧 bug 的根因）；② `@theme` 与 `@theme inline` 的分工理由（几何不需切主题、颜色需要）。

- [ ] **Step 2: 写 `theme/base.css`**

```css
/* reset / body（font-family: var(--font-app)）/ :focus-visible 焦点环 /
   .num（mono + tabular-nums）/ .e-2 .e-3 / ::selection / 滚动条 /
   动效 token（--ease-signature, --dur-quick|standard|slow）*/

/* 单一降级块：禁止组件内散落 prefers-reduced-motion（motion-plan.json 的 reduced_motion_fallback）*/
@media (prefers-reduced-motion: reduce) {
  *,*::before,*::after { animation-duration:.01ms !important; animation-iteration-count:1 !important;
    transition-duration:.01ms !important; scroll-behavior:auto !important; }
  .caret { animation:none !important; }          /* 流式光标改常亮，保留"仍在生成"的信息 */
  .pulse { animation:none !important; opacity:1 !important; }
  .enter-y,.enter-x,.enter-fade { transform:none !important; }
  .spinner { animation-duration:1600ms !important; }  /* 降速而非移除：完全移除会被当成卡死 */
}
```

- [ ] **Step 3: vendoring 字体（网络实测可达）**

从 `https://fonts.gstatic.com` 或 npm 包取 **latin 子集** woff2：Inter 400/500/600、JetBrains Mono 400/500，落到 `src/assets/fonts/`，写 `@font-face { font-display: swap; unicode-range: U+0000-00FF,… }`（只声明 latin 段，避免浏览器为 CJK 也去匹配 Inter）。合计目标 ≤150KB。

**若实现时网络不可用**：退回系统拉丁栈（`--font-app` 里 `'Inter'` 之后已是 `'Segoe UI'`，天然降级），并在报告里记为偏离 + 在 `DESIGN.md` §3.1 补一行说明。**不得**改用外链 `<link>`。

- [ ] **Step 4: 写 `theme/theme.ts`**

`applyTheme` 写 `localStorage['indexvt.theme']` 并设 `<html data-theme>`；`watchSystemTheme` 监听 `matchMedia('(prefers-color-scheme: dark)')` 的 `change` 并返回取消函数；`applyFontSize` 只缩放 `--text-read`(15.5)/`--text-body`(13.5)/`--text-caption`(12) 三个变量（系数 0.92/1.0/1.1），**不动 `--text-micro`**（否则表格列宽随字号跳动）。

- [ ] **Step 5: 接线 `main.tsx` 与 `index.html`（保留旧文件）**

`main.tsx` 增加两行 import（`./theme/tokens.css`、`./theme/base.css`），**保留** `./styles/tokens.css`（203 处旧 utility 仍在用；Track C 才删）。
`index.html` 加 `<meta name="color-scheme" content="light dark">` 与首帧前的内联主题脚本（读 `localStorage`，`system` 档查 `matchMedia`，设 `data-theme`），消除深色主题启动白闪。

- [ ] **Step 6: 写 `scripts/verify-theme.mjs` 并跑通（这是本 Task 的验收，不是可选）**

用 Playwright 打开 dev server，断言：
1. `getComputedStyle(document.documentElement).getPropertyValue('--canvas')` light 为 `#FBFBFA`、切 dark 后为 `#131312`
2. `getComputedStyle(document.body).fontFamily` 中 `'Microsoft YaHei UI'` 的下标 **小于** `sans-serif` 的下标（旧 bug 的回归锁）
3. `--radius-sm` 解析为 `6px` 且**不是**空/无效值（旧 `@theme` 自引用 bug 的回归锁）
4. `applyFontSize('large')` 后 `body` 的 `font-size` ≈ `14.85px`，而任一 `.text-micro` 元素仍为 `11px`
5. 无 `fonts.googleapis`/`fonts.gstatic` 出现在任何产物里（grep `dist/`）

- [ ] **Step 7: 三绿 + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run build && node scripts/verify-theme.mjs
git add frontend/src/theme frontend/src/assets/fonts frontend/scripts/verify-theme.mjs frontend/src/main.tsx frontend/index.html
git commit -m "feat(theme): sujian semantic tokens with light/dark, vendored fonts, theme runtime"
```

---

## Task 2.2: token 漂移 lint + a11y 验证 harness + B32

**Files:**
- Create: `frontend/scripts/lint-design-tokens.mjs`、`frontend/scripts/design-lint-legacy.txt`、`frontend/scripts/verify-a11y.mjs`
- Modify: `frontend/package.json`（scripts + devDependencies）、`frontend/tsconfig.json`（B32）

**Interfaces:**
- Consumes: Task 2.1 的 token 层（lint 的"正确写法"参照）
- Produces:
  - `npm run lint:design` —— 命中即 exit 1，打印 `file:line [rule-id] 内容 ↳ 原因`
  - `npm run verify:a11y -- <page> [widths] [themes]` —— axe 矩阵，输出 critical/serious 计数，非 0 即 exit 1
  - `frontend/scripts/design-lint-legacy.txt` —— 并存期白名单（Track C 逐行删除）

- [ ] **Step 1: 写 lint 脚本（零依赖）**

规则表（`DESIGN.md` §10）：

| id | 正则 | 拦截 |
|---|---|---|
| `raw-color` | `#[0-9a-fA-F]{3,8}\b` 或 `rgba?\(` | 写死色值 |
| `arbitrary` | `(?:text\|rounded\|p\|m\|gap\|w\|h\|leading\|tracking\|border)-\[[^\]]+\]` | Tailwind 任意值 |
| `no-outline` | `\boutline-none\b` | 移除焦点环 |
| `div-click` | `<(?:div\|span)\b[^>]*\bonClick\s*=` | 非语义可点元素 |
| `native-dialog` | `\b(?:alert\|confirm\|prompt)\s*\(` | 系统对话框 |
| `remote-font` | `fonts\.googleapis\|fonts\.gstatic\|@import\s+url\(` | 外链字体 |
| `emoji` | `[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]` | emoji 当图标 |
| `legacy-token` | `bg-bg-\d\|text-ink-\d\|border-hairline` | **新文件里用旧 token**（防新旧混用） |

白名单机制：读 `design-lint-legacy.txt`（一行一个相对 `src/` 的路径），命中的文件整体跳过；`theme/tokens.css` 与 `theme/base.css` 恒定豁免（token 定义处必须有字面色值）。行尾 `// lint-allow: <rule-id>` 可豁免单行（虚拟化算出的 inline style 会需要），**豁免必须写理由**。

- [ ] **Step 2: 生成初始白名单**

```bash
cd frontend && ls src/pages/*.tsx src/components/{Rail,StatusBar,ui}.tsx src/LangSelect.tsx src/App.tsx src/stores/appStore.ts src/wailsapi.ts src/styles/tokens.css > scripts/design-lint-legacy.txt
```
文件头写三行注释：这是什么、为什么存在、Track C 每迁移一页删一行。

- [ ] **Step 3: 证明 lint 有效（对旧代码必须报出大量命中）**

```bash
cd frontend && node scripts/lint-design-tokens.mjs --no-legacy
```
Expected: **必须报出数十条命中**（DESIGN.md 记录的是约 60 处硬编码色 + 58 处任意值 + 6 处 `outline-none` + 8 处 alert/confirm + 2 处 emoji）。若为 0，说明 lint 本身失效，先修 lint 再继续。`--no-legacy` 是仅供本步自检的开关，正常构建不带它。

- [ ] **Step 4: 接进构建 + 打开 B32**

`package.json`:
```json
"scripts": {
  "lint:design": "node scripts/lint-design-tokens.mjs",
  "verify:theme": "node scripts/verify-theme.mjs",
  "verify:a11y": "node scripts/verify-a11y.mjs",
  "verify:wails": "node scripts/verify-wails.mjs",
  "build": "npm run lint:design && tsc --noEmit && vite build"
}
```
`tsconfig.json`：`"noUnusedLocals": true`、`"noUnusedParameters": true`。

- [ ] **Step 5: 清掉 B32 暴露的死导入（不得为此关掉开关）**

```bash
cd frontend && npx tsc --noEmit
```
已知至少两处：`ModelHub.tsx` 的 `Upload`、`MainTranslate.tsx` 的 `apiStarHistory`。逐个删除未使用导入/参数；**若某处未使用是因为功能没接完**（如 `apiStarHistory` 对应"收藏历史"这个 PRD S2 的 In-Scope 项），不要静默删——在该处留 `// TODO(TrackC): 收藏动作，见 PRD S2` 并保留导入会导致 tsc 失败，因此**改为删除导入 + 在计划外清单里记一条 Track C 必做项**，在报告里写明。

- [ ] **Step 6: 写 `scripts/verify-a11y.mjs`**

```js
// 用法: node scripts/verify-a11y.mjs <path> [widths=1180,1366,1680] [themes=light,dark]
// 对每个 (width × theme) 组合：设 data-theme → 导航 → AxeBuilder 扫描 →
// 汇总 critical/serious/moderate/minor，任一 critical 或 serious > 0 则 exit 1。
// 输出每组一行摘要 + 全部 violation 的 id/impact/target/helpUrl。
```
用 `@axe-core/playwright` 的 `AxeBuilder`；`themes` 通过在页面 `evaluate` 里 `document.documentElement.setAttribute('data-theme', t)` + 同步写 localStorage 实现（复用 `theme/theme.ts` 的 `applyTheme`）。

- [ ] **Step 7: 装 devDependencies 并跑通空靶**

```bash
cd frontend && npm i -D playwright @axe-core/playwright && npx playwright install chromium
node scripts/verify-a11y.mjs / 1366 light
```
Expected: 能跑完并输出 axe 结果（当前页是旧 UI，**允许有 violation** —— 本步只验证 harness 本身可用，不要求旧页面干净）。若浏览器下载失败，报告为 BLOCKED 并说明（这是环境依赖，不得假装通过）。

- [ ] **Step 8: 三绿 + Commit**

```bash
cd frontend && npm run lint:design && npx tsc --noEmit && npm run build
git add frontend/scripts frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/src
git commit -m "build(frontend): design-token drift lint, a11y matrix harness, strict unused checks"
```

---

## Task 2.3: Wails 事件层（单点订阅多路分发 + 早到缓冲）与错误映射

**Files:**
- Create: `frontend/src/lib/wails.ts`、`frontend/src/lib/errors.ts`、`frontend/scripts/verify-wails.mjs`

**Interfaces:**
- Consumes: `window.go.main.App`、`window.runtime.EventsOn/EventsOff/EventsEmit`
- Produces:
  - `call<T>(method: string, ...args: unknown[]): Promise<T>`
  - `on(name: string, handler: (payload: unknown) => void): () => void` —— **退订只摘自己**
  - `wailsAvailable(): boolean`
  - `EV` 常量表：`EV.DELTA='translate:delta'`、`EV.DONE='translate:done'`、`EV.ORCH='orch:event'`、`EV.MODEL_PROGRESS='model:progress'`、`EV.MODELS_UPDATED='models:updated'`、`EV.CUE='subtitle:cue'`
  - `type AppError = { kind: AppErrorKind; message: string; retryable: boolean; logHint?: string }`、`type AppErrorKind = 'not-ready'|'validation'|'io'|'network'|'model'|'canceled'|'timeout'|'unknown'`、`toAppError(e: unknown): AppError`、`isCancel(e: unknown): boolean`

- [ ] **Step 1: 实现分发器（本 Task 的核心，必须按此结构）**

```ts
// 每个事件名只向 Wails 注册一次；本地维护 handler 集合自行分发。
// 原因：window.runtime.EventsOff(name) 会摘掉该事件名的**全部**订阅者。
// 现状缺陷：model:progress 同时被 Onboarding/ModelHub/appStore 订阅，
// 任一组件卸载即静默打断另两处。
const registry = new Map<string, Set<(p: unknown) => void>>()
const pending = new Map<string, { buf: unknown[]; at: number }>()   // 早到事件缓冲
const PENDING_TTL = 5_000, PENDING_MAX = 256

export function on(name: string, handler: (p: unknown) => void): () => void {
  let set = registry.get(name)
  if (!set) {
    set = new Set()
    registry.set(name, set)
    const rt = window.runtime
    if (rt?.EventsOn) rt.EventsOn(name, (p: unknown) => dispatch(name, p))
  }
  set.add(handler)
  // 订阅时先冲掉缓冲：taskId 尚未到达时事件可能已经来过
  const held = pending.get(name)
  if (held) { held.buf.splice(0).forEach((p) => safe(handler, p)) }
  return () => {
    const s = registry.get(name); if (!s) return
    s.delete(handler)
    if (s.size === 0) { registry.delete(name); window.runtime?.EventsOff?.(name) }
  }
}
```
`dispatch` 负责：无订阅者时按 `name` 暂存到 `pending`（超 `PENDING_MAX` 丢最旧、超 `PENDING_TTL` 清理），有订阅者时逐个 `safe()` 调用（单个 handler 抛错不得中断其余 handler，错误走 `console.error` + 可选 toast 钩子）。

- [ ] **Step 2: 写 `scripts/verify-wails.mjs`（浏览器探针，前端无单测框架）**

在 dev server 页面上注入一个假的 `window.runtime`（`EventsOn` 存回调、`EventsEmit` 触发它、`EventsOff` 记录被摘的事件名），然后断言三件事：
1. **多路分发**：A、B 两个 handler 订阅同名事件，emit 一次 → 两者都收到
2. **退订隔离**：退订 A 后 emit → B 仍收到，且 `EventsOff` **未被调用**（因为集合非空）；再退订 B 后 `EventsOff` 恰好被调用一次
3. **早到缓冲**：先 emit（无订阅者）→ 再订阅 → 新 handler 立即收到缓冲的那条，且缓冲被清空（二次订阅不再收到）
4. **异常隔离**：A 抛错，B 仍收到

- [ ] **Step 3: 实现 `lib/errors.ts`**

`toAppError` 按消息特征分类（`装配超时`/`未就绪` → `not-ready`；`校验失败`/`不存在`/`不支持` → `validation`；`SHA256`/`下载`/`重命名` → `io` 或 `network`；`模型运行中`/`llama` → `model`；`已取消` → `canceled`；`首字` → `timeout`；其余 `unknown`），附 `retryable` 与 `logHint`（指向 `OpenLogsFolder`）。**分类字符串必须与 Track A 后端的真实错误文案对齐** —— 实现前 `grep -rn "fmt.Errorf\|errors.New" ../app/` 取真实文案，不要凭想象写匹配规则。
`isCancel(e)` 只认 `kind === 'canceled'`（取消不是错误，spec §5 规则 1）。

- [ ] **Step 4: 三绿 + 探针通过 + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build && node scripts/verify-wails.mjs
git add frontend/src/lib frontend/scripts/verify-wails.mjs
git commit -m "feat(lib): single-subscription event fan-out with early-arrival buffer; typed error mapping"
```

---

## Task 2.4: 纯函数库（格式化 + 虚拟化）

**Files:**
- Create: `frontend/src/lib/format.ts`、`frontend/src/lib/virtualizer.ts`、`frontend/scripts/verify-lib.mjs`

**Interfaces:**
- Produces:
  - `tcSrt(ms: number): string`（`HH:MM:SS,mmm`）、`tcLrc(ms: number): string`（`[MM:SS.xx]`）、`fmtBytes(n: number): string`、`fmtRate(bytesPerSec: number): string`、`fmtPct(done: number, total: number): string`、`fmtCountdown(sec: number): string`（`M:SS`）、`clampPct(n: number): number`
  - `useVirtualRows(opts: { count: number; rowHeight: number; overscan?: number }): { range: { start: number; end: number }; padTop: number; padBottom: number; onScroll(e): void; containerRef }`
  - 负输入约定：`tcSrt(-1) === '00:00:00,000'`（钳到 0，与后端 LRC 负时间戳钳制一致）

- [ ] **Step 1: 实现 `format.ts`**

全部纯函数、无副作用、无 `Date` 依赖（除 `fmtCountdown` 也不需要）。数字一律走 `Math.max(0, …)` 钳制；`fmtBytes` 用 1024 进制并保留 1 位小数；`fmtPct(0,0)` 返回 `'0%'`（不得 `NaN`）。

- [ ] **Step 2: 实现 `virtualizer.ts`**

约 40 行的窗口化 hook：给定 `count`、`rowHeight`、容器 `scrollTop`/`clientHeight`，返回可视区间 `[start, end)` 加上下各 `overscan`（默认 6，`DESIGN.md` §5.7）行，以及上下 padding 高度（用 padding 撑高而非渲染占位行）。**行高必须固定**（cue 表 32px / 历史 40px），变高行不支持——在注释里写明这个限制，不要假装支持。

- [ ] **Step 3: 写 `scripts/verify-lib.mjs`（node 直接跑，无需浏览器）**

```js
// 用 tsx/esbuild 都不引入 —— 直接把两个文件的关键函数用 node 的内联断言覆盖：
// tcSrt(0)/(3_723_456)/(-1)、tcLrc(65_430)、fmtBytes(0)/(1<<30)/(1.5*(1<<20))、
// fmtPct(0,0)/(150,300)/(300,300)、fmtCountdown(0)/(65)/(3600)、clampPct(-5)/(150)
// virtualizer: count=5000 rowHeight=32 → 区间大小 ≈ 视口行数+12；scrollTop=0 时 padTop=0；
//              scrollTop 超尾时 padBottom=0；count=0 时区间为空且不抛错
```
若纯 node 无法直接 import `.ts`，改为把这些断言写成 Playwright 页面里的 `evaluate`（与 2.3 同一套路），**不要为此新增测试框架依赖**。

- [ ] **Step 4: 注册脚本 + 三绿 + Commit**

`package.json` 的 `scripts` 追加 `"verify:lib": "node scripts/verify-lib.mjs"`（2.2 只注册了 theme/a11y/wails，本 Task 新增的这个必须一并注册，否则 2.10 的 `verify:all` 会引用到不存在的脚本）。

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build && npm run verify:lib
git add frontend/src/lib/format.ts frontend/src/lib/virtualizer.ts frontend/scripts/verify-lib.mjs frontend/package.json
git commit -m "feat(lib): formatting helpers and fixed-height row virtualizer"
```

---

## Task 2.5: 原语 A —— 交互基础 + 陈列页骨架

**Files:**
- Create: `frontend/src/components/ui/{Button,IconButton,Badge,Segmented,Switch,Checkbox,Kbd,Spinner,index}.tsx`、`frontend/src/pages/_Primitives.tsx`

**Interfaces（每个原语的导出类型，后续 Task 与 Track C 直接消费）:**

```ts
type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'          // 28 / 32 / 36
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind; size?: ButtonSize; loading?: boolean; icon?: React.ReactNode
}
interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string                                // 必填：aria-label + tooltip 文案
  icon: React.ReactNode; size?: ButtonSize
}
type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
interface BadgeProps { tone?: BadgeTone; dot?: boolean; title?: string; children: React.ReactNode }
interface SegmentedProps<T extends string> {
  options: readonly T[]; value: T; onChange: (v: T) => void   // onChange 必填 → 不可能造出死控件
  size?: ButtonSize; 'aria-label': string
}
interface SwitchProps { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }
interface CheckboxProps { checked: boolean; onChange: (v: boolean) => void; label: string; indeterminate?: boolean }
interface KbdProps { keys: string[] }
```

- [ ] **Step 1: 建 `_Primitives.tsx` 陈列页骨架**

一个 dev-only 路由（`/?primitives` 查询参数判定，**不进导航**），按原语分节渲染**全部变体与全部状态**（default/hover 无法静态化则跳过、focus 用 `:focus-visible` 自然呈现、disabled、loading、error）。每节一个 `<section aria-labelledby>` + 标题。它是 axe 的靶子，也是目视核对的唯一入口。文件头注释写明「交付前删除」。

- [ ] **Step 2: 实现 8 个原语**

规格全部取自 `DESIGN.md` §5.1–5.4、§5.12（高度/padding/radius/变体/状态/a11y 角色）。要点：
- `Segmented` 的 `onChange` 是**必填 prop**（类型层面杜绝死控件）；`role="radiogroup"` + 每项 `role="radio" aria-checked`；← → 移动、Home/End 跳首尾。
- `Switch` 是真实 `<button role="switch" aria-checked>`，Space/Enter 可切；`label` 必填（渲染为可见文本或 `aria-label`，由 `srOnly` prop 决定）。
- `Button` 的 `loading` 用 `Spinner` 替换前导图标，并设 `aria-busy` + `disabled`。
- `IconButton` 的 `label` 同时用于 `aria-label` 与 Tooltip 文案（Tooltip 在 2.7 实现，此处先渲染 `title` 属性，2.7 换成组件并在报告里记一条待替换）。
- 焦点环一律继承 `base.css` 的 `:focus-visible`，组件内**不得**写 `outline-none`。

- [ ] **Step 3: 验收**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build
npm run dev &   # 或后台起
node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
```
Expected: axe **0 critical、0 serious**（六组全过）。任何 violation 必须修到 0 才算完成 —— 这是 `DESIGN.md` §7 第 8 条的硬门槛，不接受"moderate 先放着"。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui frontend/src/pages/_Primitives.tsx
git commit -m "feat(ui): primitives A (button/badge/segmented/switch/checkbox/kbd/spinner) + demo page"
```

---

## Task 2.6: 原语 B —— 表单与展示

**Files:**
- Create: `frontend/src/components/ui/{Field,Textarea,NumberField,Slider,Surface,EmptyState,Skeleton,Progress}.tsx`
- Modify: `frontend/src/pages/_Primitives.tsx`（追加章节）、`frontend/src/components/ui/index.ts`

**Interfaces:**

```ts
interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string; error?: string; hint?: string     // label 必填 → 杜绝 placeholder-only
}
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string; error?: string; read?: boolean    // read=true → --text-read 15.5/1.9 + 72ch 限宽
}
interface NumberFieldProps extends Omit<FieldProps, 'type' | 'onChange' | 'value'> {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number
}
interface SliderProps { value: number; onChange: (n: number) => void; min: number; max: number;
  label: string; formatValue?: (n: number) => string }
interface SurfaceProps { children: React.ReactNode; dense?: boolean; className?: string }  // dense → padding 16，否则 24
interface EmptyStateProps { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }
interface SkeletonProps { className?: string; rows?: number }
interface ProgressProps { pct: number; tone?: 'accent' | 'ok' | 'warn'; label: string }  // label 必填（aria）
```

- [ ] **Step 1–3:** 按 `DESIGN.md` §5.5 / §5.8 / §5.10 / §5.11 实现；`Progress` 用 `transform: scaleX()` 而非 `width`（motion-plan 的 GPU 友好要求），`role="progressbar"` + `aria-valuenow/min/max`；`Skeleton` 用 `opacity` 循环**不用位移**；`EmptyState` **不带点阵网格背景**（v1.0 签名细节已废弃）。
- 表单错误：`aria-invalid` + `aria-describedby` 指向错误文案 id，错误文案 12px `text-danger` 带图标。
- `Textarea` 的 `read` 模式必须让文本块 `max-width: 72ch` 且居中（`DESIGN.md` §3.5 —— 大面积留白靠限宽产生）。

- [ ] **Step 4: 验收 + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build
node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
git add frontend/src/components/ui frontend/src/pages/_Primitives.tsx
git commit -m "feat(ui): primitives B (fields/slider/surface/emptystate/skeleton/progress)"
```

---

## Task 2.7: 原语 C —— 浮层基础（Popover / LangPicker / Tooltip）

**Files:**
- Create: `frontend/src/components/ui/{Popover,LangPicker,Tooltip}.tsx`、`frontend/src/lib/useDismissable.ts`
- Modify: `_Primitives.tsx`、`ui/index.ts`；把 2.5 里 `IconButton` 的 `title` 换成 `Tooltip`

**Interfaces:**

```ts
interface PopoverProps { open: boolean; onClose: () => void; anchorRef: React.RefObject<HTMLElement>;
  width?: number; children: React.ReactNode; labelledBy?: string }
interface LangPickerProps { langs: Lang[]; value: string; onChange: (code: string) => void;
  isSource?: boolean; detected?: string; recent?: string[]; label: string }
interface Lang { code: string; zhName: string; enName: string; script?: string; core?: boolean }
interface TooltipProps { content: React.ReactNode; children: React.ReactElement }
```

- [ ] **Step 1: `useDismissable`** —— 统一的「点外部关闭 + Esc 关闭最上层 + 焦点回到触发元素」hook，供 Popover/Drawer/Modal/Tooltip 共用。**Esc 必须只关最上层**（维护一个模块级栈）。
- [ ] **Step 2: `LangPicker`** —— 触发器 + Popover + 搜索 Field + `role="listbox"` 虚拟列表（150 项，用 2.4 的 virtualizer）。键盘：Enter/Space 开、↑↓ 移动、Enter 选、Esc 关、输入即过滤、首字母跳转。`detected` 存在时副行显示 `DETECTED · <语言名>`（**必须消费后端 `translate:done` 的 `detected`**，Track A 已确认后端返回该字段；现状前端硬编码 `'…'`）。
- [ ] **Step 3: `Tooltip`** —— 延迟 400ms 出现、120ms 淡出（motion-plan quick 档）、`role="tooltip"` + `aria-describedby`；键盘聚焦也能触发（不能只 hover）。

- [ ] **Step 4: 验收 + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build
node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
git add frontend/src/components/ui frontend/src/lib/useDismissable.ts frontend/src/pages/_Primitives.tsx
git commit -m "feat(ui): popover, virtualized lang picker, tooltip, shared dismissable hook"
```

---

## Task 2.8: 原语 D —— 模态家族（Modal / Drawer / Toast）

**Files:**
- Create: `frontend/src/components/ui/{Modal,Drawer,Toast}.tsx`、`frontend/src/components/ui/ToastHost.tsx`、`frontend/src/stores/toastStore.ts`
- Modify: `_Primitives.tsx`、`ui/index.ts`

**Interfaces:**

```ts
interface ModalProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode;
  footer?: React.ReactNode; initialFocus?: 'cancel' | 'confirm' | 'first' }  // 破坏性确认默认 'cancel'
interface DrawerProps { open: boolean; onClose: () => void; title: string; width?: 360 | 420; children: React.ReactNode }
type ToastTone = 'info' | 'ok' | 'warn' | 'error'
interface ToastItem { id: string; tone: ToastTone; message: string; action?: { label: string; run: () => void } }
// toastStore: push(t: Omit<ToastItem,'id'>): string; dismiss(id): void; 列表上限 3
```

- [ ] **Step 1: 焦点陷入（focus trap）** —— Tab 在浮层内循环，Shift+Tab 反向；打开时焦点移到 `initialFocus` 指定元素；关闭时**焦点回到触发元素**（`useDismissable` 已提供栈，这里补 trap）。
- [ ] **Step 2: `Modal`** —— `role="dialog" aria-modal="true" aria-labelledby`；scrim 点击关闭（破坏性确认可用 `dismissible={false}` 关掉）；入场 `translateY(8px)+opacity` 320ms，**不用 scale**。
- [ ] **Step 3: `Toast` + `ToastHost`** —— 右下堆叠，最多 3 条，超出替换最旧；`error` 类**不自动消失**且带关闭按钮；其余 4s 自动消失、hover 暂停计时；新条目进入时已有条目以 `transform` 上移让位（不动 height）。
- [ ] **Step 4: 破坏性确认的默认焦点** —— `initialFocus` 默认 `'cancel'`，防止回车误删（PRD S4 的 GWT 明确要求）。

- [ ] **Step 5: 验收 + Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build
node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
git add frontend/src/components/ui frontend/src/stores/toastStore.ts frontend/src/pages/_Primitives.tsx
git commit -m "feat(ui): modal, drawer, toast host with focus trap and Esc stack"
```

---

## Task 2.9: 原语 E —— DataTable（虚拟化 + 批量选择）

**Files:**
- Create: `frontend/src/components/ui/DataTable.tsx`
- Modify: `_Primitives.tsx`、`ui/index.ts`

**Interfaces:**

```ts
interface Column<T> {
  key: string; header: string; width?: string            // 固定列宽用 px 字符串（如 '132px'），弹性列用 '1fr'
  align?: 'left' | 'right'; numeric?: boolean            // numeric → .num（mono + tabular-nums）
  render: (row: T, i: number) => React.ReactNode
}
interface DataTableProps<T> {
  columns: Column<T>[]; rows: T[]; rowKey: (r: T, i: number) => string | number
  rowHeight?: 32 | 40; virtual?: boolean                 // 默认 rows.length > 200 自动开
  selectable?: boolean; selected?: Set<string | number>; onSelectedChange?: (s: Set<string | number>) => void
  onRowClick?: (row: T) => void; selectedRowKey?: string | number
  emptyState?: React.ReactNode; 'aria-label': string
}
```

- [ ] **Step 1:** 按 `DESIGN.md` §5.7 实现：sticky 表头 28px（`text-micro` + `text-ink3` + uppercase + `.08em`）、行 32/40、`1px --line` 行分隔、hover `bg-sunken`、选中 = 左缘 `2px --accent` + `bg-accentSoft`。
- [ ] **Step 2:** 虚拟化接 2.4 的 `useVirtualRows`（上下各 6 行缓冲）；用 padding 撑高，不渲染占位行。
- [ ] **Step 3:** 批量选择：首列 16px `Checkbox`（`role="checkbox"`，含 indeterminate）、Shift 连选、表头全选；选中数由调用方读 `selected.size` 显示在工具栏（喂给「重试选中项」→ 后端 `SubRetryCues`，Track A 已绑定）。
- [ ] **Step 4:** 行内操作按钮：hover/focus 时用 `opacity` 显现（**不用 `display:none`**，否则脱离 Tab 序）；始终在 Tab 序内。
- [ ] **Step 5:** 键盘：↑↓ 移动选中行、Space 切换勾选、Enter 触发 `onRowClick`。

- [ ] **Step 6: 验收（含性能）+ Commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run build
node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
```
陈列页里放一张 **5000 行**的表；额外断言：DOM 中实际渲染的行数 ≤ 视口行数 + 12（虚拟化真的生效），滚动时不出现 >200ms 长任务（用 Playwright 的 `PerformanceObserver` 或 `page.evaluate` 采样）。

```bash
git add frontend/src/components/ui/DataTable.tsx frontend/src/pages/_Primitives.tsx
git commit -m "feat(ui): virtualized DataTable with batch selection and keyboard row nav"
```

---

## Task 2.10: 地基验收（全矩阵 + 门禁 + 交接清单）

**Files:**
- Modify: `frontend/package.json`（补 `verify:all`）、`docs/03-GUI设计图/DESIGN.md`（若验收中发现规格与实现必须偏离，在此记录）
- Create: `frontend/scripts/verify-contrast.mjs`、`frontend/scripts/verify-keyboard.mjs`

- [ ] **Step 1: 对比度实测（不靠 DESIGN.md 的算式，靠真实渲染）**

`verify-contrast.mjs`：遍历陈列页所有文本节点，取其 `color` 与**实际背景**（向上找第一个非 transparent 的 `background-color`），按 WCAG 相对亮度算对比度，断言全部 ≥4.5:1（`text-micro` 不豁免）。light/dark 各跑一遍。输出最低三档的实测值。

- [ ] **Step 2: 键盘流程实测**

`verify-keyboard.mjs`：在陈列页上仅用键盘（`page.keyboard`）完成「Tab 遍历全部原语 → 每个都有可见焦点环 → Segmented 用方向键改值 → Switch 用 Space 切换 → Modal 打开后 Tab 被困在内部 → Esc 关闭后焦点回到触发按钮」，逐步断言。任何一步失败即 exit 1。

- [ ] **Step 3: 定义 `verify:all` 并全矩阵跑一遍**

`package.json` 追加（一条命令跑完地基的全部验证门禁，Track C 每次改动后都应能复跑）：

```json
"verify:all": "npm run lint:design && tsc --noEmit && npm run verify:theme && npm run verify:wails && npm run verify:lib && npm run verify:a11y -- \"/?primitives\" 1180,1366,1680 light,dark && node scripts/verify-contrast.mjs && node scripts/verify-keyboard.mjs"
```

```bash
cd frontend && npm run build
npm run verify:all
```
Expected: 全绿；axe 六组 0 critical/0 serious；对比度最低值 ≥4.5。**注意 `verify:all` 不含 `build`**（`build` 本身已含 lint+tsc+vite），避免重复。

- [ ] **Step 4: reduced-motion 实测**

`page.emulateMedia({ reducedMotion: 'reduce' })` 后断言：陈列页内无任何元素的 `animation-duration` > 1ms（spinner 除外，应为 1600ms）、无 `transform` 位移入场、`.caret` 不闪。

- [ ] **Step 5: 交接清单（写进报告，供 Track C）**

必须逐条列出：① 23 个原语的导入路径与 props 摘要；② `_Primitives.tsx` 的删除条件（Track C 全部页面迁移完成后）；③ `design-lint-legacy.txt` 当前行数与"每迁移一页删一行"的规则；④ Track A 交接项的落点（R17 的 error 态渲染在哪个页面、`SubGetDoc`/`CueProgress.Translated` 由哪个 store 消费）；⑤ 尚未接线的后端能力清单（术语 CRUD、配音模式字段、约束字段真实性需先核 `translator.Constraints`）。

- [ ] **Step 6: Commit**

```bash
git add frontend/scripts frontend/package.json
git commit -m "test(frontend): contrast, keyboard-flow and reduced-motion verification gates"
```

---

## 完成判据（整条 Track B）

**自动验证**（逐条贴真实输出，不接受"应该没问题"）：
```bash
cd frontend && npx tsc --noEmit                    # exit 0，且 noUnusedLocals/Parameters 已开
cd frontend && npm run lint:design                 # 0 命中（白名单文件除外）
cd frontend && npm run build                       # exit 0
cd frontend && node scripts/verify-theme.mjs       # token 生效 / CJK 栈顺序 / 无 @theme 自引用
cd frontend && node scripts/verify-wails.mjs       # 多路分发 / 退订隔离 / 早到缓冲 / 异常隔离
cd frontend && node scripts/verify-lib.mjs         # 格式化与虚拟化边界
cd frontend && npm run verify:a11y -- "/?primitives" 1180,1366,1680 light,dark   # 六组 0 critical 0 serious
cd frontend && node scripts/verify-contrast.mjs    # 全部文本 ≥4.5:1（两主题）
cd frontend && node scripts/verify-keyboard.mjs    # 纯键盘全流程可完成
```

**Track B 不做的事**（防止范围蔓延）：不重写任何页面；不删 `styles/tokens.css` 与旧组件；不接后端业务流（store 层只建 `toastStore`，`jobStore`/`glossaryStore` 属 Track C）；**不建 `components/shell/`（Rail / StatusBar / AppSurface）——它们是应用外壳而非原语，属 Track C**；**不做 spec §8.2 的断点验证（1179/1180/1379/1380/1679/1680 六个宽度的布局断言）——断点是页面级布局行为，陈列页无法代表，属 Track C**；不实现 cue 编辑/文档翻译/实时翻译/托盘/字幕页术语选择器。

**Track C 的前置条件**（本 Track 交付后即满足）：23 个原语可用且 a11y 达标 · token 双主题生效 · 事件层修复了 `EventsOff` 全局摘除缺陷 · lint 与四个 verify 脚本成为构建门禁。
