# 界面微调五项 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉历史条目缩略失效与模型中心窄窗挤压，新增 ctx 自定义档位（含显存估算与二次确认）、约束模板详情查看，并把 Archivo + Noto Sans SC 子集字体接进界面。

**Architecture:** 前端只动三个页面（MainTranslate / ModelHub / Settings）加一个新组件（ModeDetails），字体走 `theme/base.css` 的 `@font-face` + `theme/tokens.css` 的栈；后端只动 `config`（新增覆盖字段与生效值）与 `app`（新增估算绑定）。估算做成纯函数便于单测，UI 只消费绑定结果。字体资产已落库，本计划只做接线与断言。

**Tech Stack:** Go 1.25 / Wails v2（绑定以字符串名调用，`wailsapi.ts` 手写封装，**不需要重新生成 wailsjs**）、React 18 + TS 5.7 + Tailwind v4（`@theme` 变量即 token 与断点）、Playwright + axe（既有门禁）。

**Spec:** `docs/superpowers/specs/2026-10-06-ui-polish-ctx-fonts-design.md`（实施前先读，本计划的每个引用都能在 spec 里找到出处）

**状态：** 已执行完毕并已入库（2026-10-06 内联执行 → 2026-10-07 随 Track B/C 一起 fast-forward 进 `master`，落在 `8cafa57 feat(frontend)` 与 `58a64ff feat(backend)`）。Task 1–8 全部步骤已勾选；人工清单 6/6 取证完成（此前本行误记为 5/6，且 Task 8 Step 2 的父框漏勾，而其六个子项都已勾 —— 已于 2026-10-07 补齐）。exe 已在合并后重建，见 Task 8 Step 2 末条。

## Global Constraints

- ~~**不提交**：本仓库当前约定「只改文件，不提交」。计划里没有 git commit 步骤；需要提交时由用户另行指示。~~
  **已于 2026-10-07 由用户显式解除**（在集成流程选定后追加「提交，测试无问题则删除分支」）。
  注意这条约束管的是**执行阶段**，它当时确实被遵守了 —— 本计划全程没有 commit 步骤；
  解除发生在**交付阶段**，两者不冲突，不要据此回头改上面的步骤。
- **门禁全绿是完成定义**：`cd frontend && npm run verify:all`、`npm run verify:pages`、`npm run build`、`cd app && go build ./... && go vet ./... && go test ./...` 四组都过，才算任务完成。
- **环境**：命令按 Git Bash 写；`verify-a11y.mjs` 的位置参数 `/?…` 会被 MSYS 改写，直调 node 时前置 `MSYS_NO_PATHCONV=1`（经 `npm run` 走 cmd 则不需要）。端口统一 `127.0.0.1:5173`。
- **`go test -race` 不可用**（`CGO_ENABLED=0`，ADR-001）。任何报告不得声称竞态验证。
- **样式纪律**：不用 Tailwind 任意值（含 `left-/top-` 等偏移）、不写死色值、图标只用 lucide-react；`lint-design-tokens.mjs` 会拦，禁止加白名单。
- **文案**：新增 UI 文案用简体中文，语气与既有页面一致；数值一律带单位。
- **契约**：视觉与交互口径以 `docs/03-GUI设计图/DESIGN.md`（v2.1）为准，本计划里凡与契约冲突处，改契约需同步改文档。

---

## 文件结构（先定边界，再拆任务）

| 文件 | 职责 | 本计划中的改动 |
|---|---|---|
| `frontend/scripts/lint-design-tokens.mjs` | 设计漂移 lint（构建期） | 新增 `clamp-display-conflict` 规则 |
| `frontend/src/components/ui/Badge.tsx` | 状态徽标原语 | 增加可选 `className`（供截断用） |
| `frontend/src/pages/MainTranslate.tsx` | 主翻译台 | 历史条目缩略修复 + 模式详情入口 |
| `frontend/src/pages/ModelHub.tsx` | 模型中心 | 顶栏加固 + 卡片栅格 |
| `frontend/src/pages/Settings.tsx` | 设置页 | ctx 自定义档 UI + 确认弹窗 + 模板详情入口 |
| `frontend/src/components/ModeDetails.tsx` | **新建**：约束模板只读详情 | 被 MainTranslate / Settings 复用 |
| `frontend/src/theme/tokens.css` | 语义 token | `--breakpoint-wide` + `--font-app` 加 Archivo/Noto |
| `frontend/src/theme/base.css` | 字体面与基础层 | 新增两段 `@font-face` |
| `frontend/src/wailsapi.ts` | 绑定薄封装 | 新增 `apiEstimateCtxVRAM` |
| `frontend/src/lib/mockbackend.ts` | dev 假后端 | 新增 `EstimateCtxVRAM` 处理器（页面门禁供数） |
| `frontend/scripts/verify-theme.mjs` | token 门禁 | #7 字体断言扩到三份 woff2 |
| `app/internal/config/config.go` | 配置结构与规范 | `CtxTokensOverride` + `EffectiveCtxTokens()` |
| `app/internal/config/config_test.go` | **新建**：config 包首个测试 | 覆盖夹取/对齐/生效值 |
| `app/app.go` | 绑定层 | `CtxEstimate` + `estimateCtxVRAM` + `EstimateCtxVRAM` + `CtxTokens` 改源 |
| `app/ctx_estimate_test.go` | **新建**：估算纯函数测试 | 无 GPU / 兜底权重 / 超限真值 |
| `docs/03-GUI设计图/DESIGN.md`、`docs/02-执行细节说明.md`、`README.md` | 文档 | 各任务的"文档同步"步 |

**字体资产已就位**（`frontend/src/assets/fonts/`）：`archivo-latin-wght400-600.woff2`(18.3KB)、
`noto-sans-sc-cjk-wght400-600.woff2`(1.72MB)、`OFL-Archivo.txt`、`OFL-NotoSansSC.txt`。

---

### Task 1: 历史条目缩略修复 + lint 防复发规则

**Files:**
- Modify: `frontend/scripts/lint-design-tokens.mjs:83-91`（RULES 数组末尾追加）
- Modify: `frontend/src/pages/MainTranslate.tsx:326-327`
- Modify: `docs/03-GUI设计图/DESIGN.md` §10 禁止项表

**Interfaces:**
- Consumes: 无
- Produces: 无（纯修复）；新增 lint 规则 id = `clamp-display-conflict`，后续任务不得触发它

- [x] **Step 1: 先写规则，证明它对现有代码报得出错（TDD 的"红"）**

在 `frontend/scripts/lint-design-tokens.mjs` 的 RULES 数组末尾（`legacy-token` 之后）追加：

```js
  {
    id: 'clamp-display-conflict',
    /* line-clamp 依赖 display:-webkit-box；同元素再挂显式 display 会让它静默失效。
       实测：MainTranslate 历史条目的 `block … line-clamp-1` → computed display:block，
       条目高 102–154px（本应 ~75px）。 */
    re: /(?:className|class)=[{`"'](?=[^`"'\n]*\bline-clamp-\d)(?=[^`"'\n]*\b(?:block|inline-block|flex|grid)\b)[^`"'\n]*/g,
    reason: 'line-clamp 与显式 display 同元素 → clamp 失效；去掉 block/flex/grid，clamp 自带 display:-webkit-box',
  },
```

- [x] **Step 2: 跑 lint，确认恰好 2 处命中**

```bash
cd frontend && node scripts/lint-design-tokens.mjs
```
预期：退出码 1，输出两条：
`src/pages/MainTranslate.tsx:326 [clamp-display-conflict] …` 与 `:327 …`。
若命中数不是 2，先停下来核对（可能别处也有同写法，或正则误伤，例如 `SubtitleWorkbench` 的两处没有 display 类、不应命中）。

- [x] **Step 3: 修 MainTranslate（去掉 `block`、补 `title`）**

把 326-327 两行改成（其余不动）：

```tsx
                        <span className="text-body text-ink1 line-clamp-1" title={h.sourceText}>{h.sourceText}</span>
                        <span className="text-micro text-ink3 mt-0.5 line-clamp-1" title={h.output}>{h.output}</span>
```

说明：`line-clamp-1` 自带 `display:-webkit-box`（块级），两个 span 仍会纵向堆叠；`title` 提供鼠标悬停看全文。

- [x] **Step 4: 再跑 lint，确认 0 命中**

```bash
cd frontend && node scripts/lint-design-tokens.mjs
```
预期：`design lint：49 个文件扫描通过（白名单 1 个文件跳过）`。

- [x] **Step 5: 实测条目高度（一次性探针，跑完删除）**

新建 `frontend/scripts/_probe-item-height.mjs`：

```js
#!/usr/bin/env node
/* 一次性探针：量历史条目高度（预期 ~75px）。用完删除。 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url)); const FRONTEND = path.resolve(HERE, '..')
const DEV_URL = 'http://127.0.0.1:5173/'
const probe = (u) => new Promise((r) => { const q = http.get(u, { timeout: 1500 }, (x) => { x.resume(); r(true) }); q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false) }) })
async function ensure() { if (await probe(DEV_URL)) return null; const c = spawn(process.execPath, [path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: FRONTEND, stdio: 'ignore' }); for (let i = 0; i < 100; i++) { if (await probe(DEV_URL)) return c; await new Promise((r) => setTimeout(r, 300)) } throw new Error('vite 未就绪') }
const child = await ensure()
const { chromium } = await import('playwright')
const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1180, height: 800 } })
await page.goto(DEV_URL + '?mock&page=translate', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('#root > *'); await page.waitForTimeout(800)
console.log(await page.evaluate(() => {
  const items = [...document.querySelectorAll('ul li > div')].filter((d) => d.className.includes('border'))
  const span = document.querySelector('span[class*="line-clamp"]')
  return { 条数: items.length, 高度: items.slice(0, 5).map((i) => Math.round(i.getBoundingClientRect().height)),
           display: span ? getComputedStyle(span).display : '(未找到)' }
}))
await browser.close(); if (child) child.kill()
```

```bash
cd frontend && node scripts/_probe-item-height.mjs
```
预期：`条数: 12`、高度在 **72–80px** 区间、`display: '-webkit-box'`。
然后删除该探针：`rm frontend/scripts/_probe-item-height.mjs`。

> **执行记录（2026-10-06 实测，与预期有一处差异）**：条数 12、高度 **80px**（此前 102–154）、
> `title` 正常；但 `getComputedStyle().display` 报的是 **`flow-root`** —— 那是 Chromium 对
> `display:-webkit-box` 的 computed 归一化，不是实现差异。裁剪生效的直接证据是
> `clientHeight 22 < scrollHeight 43`（即：确实只渲染一行）。dist CSS 里 Tailwind 的输出为
> `.line-clamp-1{-webkit-line-clamp:1;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}`。
> 后续任务不要用 computed display 判断 clamp 是否生效，看 `clientHeight < scrollHeight`。

- [x] **Step 6: 文档同步（DESIGN §10）**

在 `docs/03-GUI设计图/DESIGN.md` §10「禁止项」表里，紧挨 `输出 outline:none` 那行之后插入一行：

```markdown
| `line-clamp-*` 与显式 display（`block`/`flex`/`grid`）同元素 | clamp 依赖 `display:-webkit-box`，被覆盖即静默失效（历史条目实测：不缩略且无任何报错）。回归锁 = lint 规则 `clamp-display-conflict` |
```

- [x] **Step 7: 回归**

```bash
cd frontend && npm run verify:pages:contrast && npm run verify:pages:a11y
```
预期：两组均「全绿」。

---

### Task 2: 模型中心窄窗加固 + 卡片栅格

**Files:**
- Modify: `frontend/src/theme/tokens.css`（`@theme` 段内新增断点）
- Modify: `frontend/src/components/ui/Badge.tsx`（新增 `className`）
- Modify: `frontend/src/pages/ModelHub.tsx:101-131`（顶栏）、`:133-135`（卡片栅格）
- Modify: `docs/03-GUI设计图/DESIGN.md` §6.2 的"模型卡"行

**Interfaces:**
- Consumes: 无
- Produces: `Badge` 新增可选 `className?: string`；Tailwind 新增 `wide:` 变体（阈值 1380px），后续页面可直接用

- [x] **Step 1: 给 Badge 加 className（截断用）**

`frontend/src/components/ui/Badge.tsx`：props 加 `className?: string`，并拼进根 span：

```tsx
export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  title?: string
  className?: string
  children: ReactNode
}

export function Badge({ tone = 'neutral', dot = false, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-micro ${TONE_CLS[tone]} ${className ?? ''}`}
    >
```

- [x] **Step 2: 新增 wide 断点 token**

`frontend/src/theme/tokens.css` 的 `@theme { … }` 段内（`--radius-*` 附近）追加：

```css
  /* §6.2 断点：Tailwind v4 的断点即 @theme 变量，产出 wide: 变体。
     窗口最小 1180 → 只需两档：<1380 两列、≥1380 三列（模型卡栅格）。 */
  --breakpoint-wide: 1380px;
```

- [x] **Step 3: 顶栏五项加固**

`frontend/src/pages/ModelHub.tsx`，逐项替换（左为现状，右为新值）：

1. 容器：
   `<div className="bg-surface border border-line flex items-center gap-4 px-5 py-4">`
   → `<div className="bg-surface border border-line flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">`
2. VRAM 块：
   `<div className="flex items-center gap-3 w-80">`
   → `<div className="flex min-w-0 flex-1 basis-64 max-w-80 items-center gap-3">`
3. GPU 徽标：
   ```tsx
        {status?.gpu?.present && (
          <Badge tone="ok" dot>
            GPU: {status.gpu.name}
          </Badge>
        )}
   ```
   →
   ```tsx
        {status?.gpu?.present && (
          <Badge tone="ok" dot className="max-w-72 truncate" title={status.gpu.name}>
            GPU: {status.gpu.name}
          </Badge>
        )}
   ```
4. 存储徽标（降噪 + 缩短 + 全路径进 title）：
   ```tsx
        <Badge tone="accent" dot>
          存储: .\models\（项目文件夹）
        </Badge>
   ```
   →
   ```tsx
        <Badge tone="neutral" dot title={`存储位置：${'models/'}（随 exe 所在目录，便携布局）`}>
          存储：models/
        </Badge>
   ```
5. 按钮容器 + 按钮不换行：
   `<div className="ml-auto flex gap-2">` → `<div className="ml-auto flex shrink-0 gap-2">`，
   且该容器里的 `<Button onClick={() => apiOpenModelsFolder().catch(errToast)}>` 加 `className="whitespace-nowrap"`。

- [x] **Step 4: 卡片栅格两档**

`ModelHub.tsx` 里 `<div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>` 改为：

```tsx
      <div className="grid grid-cols-2 wide:grid-cols-3 gap-4">
```

- [x] **Step 5: 几何自检（临时探针，跑完删除）**

新建 `frontend/scripts/_probe-bar.mjs`（与 Task 1 探针同骨架，只改测量段）：

```js
// 把 Task 1 探针里的 evaluate 换成下面这段
console.log(await page.evaluate(() => {
  const bar = document.querySelector('main > div > div:first-child > div:first-child')
  const rowTops = new Set([...bar.children].map((k) => Math.round(k.getBoundingClientRect().top)))
  const grid = [...document.querySelectorAll('div')].find((d) => getComputedStyle(d).gridTemplateColumns.split(' ').length >= 2 && d.children.length === 3)
  return {
    barHeight: Math.round(bar.getBoundingClientRect().height),
    顶栏行数: rowTops.size,
    卡片列宽: grid ? getComputedStyle(grid).gridTemplateColumns : '(未找到)',
  }
}))
```

分别以 1180 与 1036 宽各跑一次（改 `newPage({ viewport })`）：
预期 1180：`顶栏行数: 1`、卡片 `342px 342px`（两列 → 每列约 528px，故 gridTemplateColumns 应显示两个值）；
预期 1036：`顶栏行数: 1`（flex-wrap 保证不折字；若有换行也是整块换行而不是字内折行）。
跑完删除探针。

- [x] **Step 6: 文档同步（DESIGN §6.2）**

§6.2 表格的 `1180 – 1379` 行与 `≥ 1680` 行里，把"模型卡 2 列 / 3 列"的**状态列**从"未实现"改为
"已落地（`--breakpoint-wide: 1380px`，`wide:grid-cols-3`）"；`< 1180` 行保留"未实现"（窗口下限即 1180）。

- [x] **Step 7: 回归**

```bash
cd frontend && npm run verify:all
```
预期：九道全绿（含 lint —— `max-w-72`/`basis-64`/`gap-x-4` 都是刻度档，不触任意值规则）。

---

### Task 3: Go 侧 ctx 覆盖字段与生效值

**Files:**
- Modify: `app/internal/config/config.go`（`Inference` 结构体、`Normalize`）
- Create: `app/internal/config/config_test.go`
- Modify: `app/app.go:283`（`CtxTokens`）

**Interfaces:**
- Consumes: 无
- Produces: `Inference.CtxTokensOverride int`（json `ctxTokensOverride`）、`(Config).EffectiveCtxTokens() int64`；Task 4/5 依赖这两个名字

- [x] **Step 1: 写失败测试**

新建 `app/internal/config/config_test.go`：

```go
package config

import "testing"

func TestNormalizeCtxTokensOverride(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, 0},         // 0 = 跟随预设档，不动
		{-5, 0},        // 负值判为无效 → 跟随预设档
		{1, 2048},      // 小于下限 → 夹到 2048
		{2048, 2048},   // 边界原样
		{3000, 3072},   // 就近对齐 1024
		{3072, 3072},   // 已对齐原样
		{65024, 65536}, // 向上对齐后仍在上限内
		{65536, 65536}, // 上限原样
		{70000, 65536}, // 超上限 → 夹到 65536
	}
	for _, c := range cases {
		cfg := Config{}
		cfg.Inference.CtxTokensOverride = c.in
		cfg.Normalize()
		if got := cfg.Inference.CtxTokensOverride; got != c.want {
			t.Errorf("override %d → %d，期望 %d", c.in, got, c.want)
		}
	}
}

func TestEffectiveCtxTokens(t *testing.T) {
	cfg := Config{}
	cfg.Normalize()
	if got := cfg.EffectiveCtxTokens(); got != 8192 {
		t.Fatalf("默认应为 8192（8K 档），得 %d", got)
	}
	cfg.Inference.CtxTier = Ctx32K
	if got := cfg.EffectiveCtxTokens(); got != 32768 {
		t.Fatalf("32K 档应为 32768，得 %d", got)
	}
	cfg.Inference.CtxTokensOverride = 12288
	if got := cfg.EffectiveCtxTokens(); got != 12288 {
		t.Fatalf("覆盖值应优先，得 %d", got)
	}
	cfg.Inference.CtxTokensOverride = 0
	if got := cfg.EffectiveCtxTokens(); got != 32768 {
		t.Fatalf("清零后应回落 32K，得 %d", got)
	}
}
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd app && go test ./internal/config/ -run 'Ctx' -v
```
预期：编译失败——`CtxTokensOverride` 与 `EffectiveCtxTokens` 未定义。

- [x] **Step 3: 最小实现**

`app/internal/config/config.go`：

1. `Inference` 结构体加字段（放在 `CtxTier` 之后）：

```go
	CtxTier           CtxTier `json:"ctxTier"`           // llama-server -c（预设档）
	CtxTokensOverride int     `json:"ctxTokensOverride"` // 0=跟随预设档；否则 2048-65536，Normalize 夹取并对齐 1024
```

2. **紧接 `CtxTier.Tokens()` 之后**新增：

```go
// EffectiveCtxTokens 生效的上下文长度：自定义覆盖优先，否则回落预设档。
func (c Config) EffectiveCtxTokens() int64 {
	if c.Inference.CtxTokensOverride > 0 {
		return int64(c.Inference.CtxTokensOverride)
	}
	return c.Inference.CtxTier.Tokens()
}
```

3. `Normalize()` 内追加（放在 `IdleUnloadMinutes` 夹取之后、`CtxTier` 校验之前）：

```go
	// 自定义 ctx：负值判为无效（回落预设档）；有效值夹取到 [2048, 65536] 并对齐 1024。
	if v := c.Inference.CtxTokensOverride; v < 0 {
		c.Inference.CtxTokensOverride = 0
	} else if v > 0 {
		if v < 2048 {
			v = 2048
		}
		if v > 65536 {
			v = 65536
		}
		c.Inference.CtxTokensOverride = (v + 512) / 1024 * 1024
	}
```

4. `app/app.go:283` 改为：

```go
func (a *App) CtxTokens() int64 { return a.cfgSnapshot().EffectiveCtxTokens() }
```

- [x] **Step 4: 跑测试确认通过**

```bash
cd app && go test ./internal/config/ -run 'Ctx' -v && go build ./... && go vet ./...
```
预期：两条测试 PASS；build/vet 干净。

---

### Task 4: 显存估算绑定（EstimateCtxVRAM）

**Files:**
- Modify: `app/app.go`（新增类型、常量、纯函数、绑定方法）
- Create: `app/ctx_estimate_test.go`

**Interfaces:**
- Consumes: `envprobe.QueryVRAMCached(ttl)`、`envprobe.GPU{Present,TotalMB,UsedMB,FreeMB}`、`a.models.List()` 返回的 `[]modelmanager.ModelInfo`（字段 `Active bool`、`Quants []QuantStatus`，`QuantStatus{Present bool, SizeBytes int64}`）
- Produces: 绑定 `EstimateCtxVRAM(tokens int64) (*CtxEstimate, error)`；`CtxEstimate` 的 JSON 字段名 `tokens/weightsMiB/kvMiB/activateMiB/totalMiB/gpu/exceedsFree/basis`；Task 5 的前端按这些名字读

- [x] **Step 1: 写失败测试**

新建 `app/ctx_estimate_test.go`（包名 `main`，与既有 `translate_ctx_test.go` 一致）：

```go
package main

import (
	"testing"

	"indexvt/internal/envprobe"
)

func TestEstimateCtxVRAM(t *testing.T) {
	gpu4G := envprobe.GPU{Present: true, TotalMB: 4096, UsedMB: 900, FreeMB: 3196}
	noGPU := envprobe.GPU{}

	// 8K + 兜底权重：1251 + 875 + 600 = 2726 MiB，4GB 卡不超
	e := estimateCtxVRAM(8192, 0, gpu4G)
	if e.WeightsMiB != 1251 || e.KvMiB != 875 || e.ActivateMiB != 600 || e.TotalMiB != 2726 {
		t.Fatalf("8K 估算错：%+v", e)
	}
	if e.ExceedsFree {
		t.Fatalf("8K/4GB 不应判超限：%+v", e)
	}

	// 32K：1251 + 4×875 + 600 = 5351 MiB，超过 4GB 卡可用 3196 → 超限
	e = estimateCtxVRAM(32768, 0, gpu4G)
	if e.KvMiB != 3500 || e.TotalMiB != 5351 || !e.ExceedsFree {
		t.Fatalf("32K 估算错：%+v", e)
	}

	// 实测权重（传 2100）优先于兜底
	e = estimateCtxVRAM(8192, 2100, gpu4G)
	if e.WeightsMiB != 2100 || e.TotalMiB != 3575 {
		t.Fatalf("实测权重未生效：%+v", e)
	}

	// 无 GPU：不判超限，Basis 说明 CPU 模式
	e = estimateCtxVRAM(8192, 0, noGPU)
	if e.ExceedsFree || e.Basis == "" {
		t.Fatalf("无 GPU 分支错：%+v", e)
	}
}
```

- [x] **Step 2: 跑测试确认失败**

```bash
cd app && go test -run TestEstimateCtxVRAM -v .
```
预期：编译失败——`estimateCtxVRAM` 未定义。

- [x] **Step 3: 实现（`app/app.go`，放在 `CtxTokens` 附近）**

```go
// ---------- 上下文显存估算 ----------

// CtxEstimate 上下文显存的**估算**（非实测）：对 01 文档 §3.2 表校准的线性模型，
// 偏差 ±20% 量级（并发 slot / flash-attn / 驱动缓存都不在模型里）。单位一律 MiB，
// 与 nvidia-smi 口径一致。前端文案必须写"预计"。
type CtxEstimate struct {
	Tokens      int64        `json:"tokens"`
	WeightsMiB  int          `json:"weightsMiB"`
	KvMiB       int          `json:"kvMiB"`
	ActivateMiB int          `json:"activateMiB"`
	TotalMiB    int          `json:"totalMiB"`
	GPU         envprobe.GPU `json:"gpu"`
	ExceedsFree bool         `json:"exceedsFree"`
	Basis       string       `json:"basis"`
}

const (
	// [assumption] 每 8192 token 的 KV 估算：由文档表 8K≈1.5GB、32K≈3.5GB 反推（875MiB/8K）。
	ctxKvMiBPer8K = 875
	// [assumption] 激活等固定开销。
	ctxActivateMiB = 600
	// translate Q4_K_M 实测体积 1312164352 B，取不到真实权重时的兜底。
	fallbackWeightsMiB = 1251
)

// estimateCtxVRAM 纯函数，便于单测。weightsMiB 传 0 表示未知 → 用兜底值。
func estimateCtxVRAM(tokens int64, weightsMiB int, gpu envprobe.GPU) CtxEstimate {
	basis := "线性估算：权重 + ctx/8192×875MiB + 600MiB（对 01 文档 §3.2 表校准，±20%）"
	if weightsMiB <= 0 {
		weightsMiB = fallbackWeightsMiB
		basis += "；权重取 translate Q4_K_M 兜底值"
	}
	kv := int(tokens/8192) * ctxKvMiBPer8K
	e := CtxEstimate{
		Tokens:      tokens,
		WeightsMiB:  weightsMiB,
		KvMiB:       kv,
		ActivateMiB: ctxActivateMiB,
		TotalMiB:    weightsMiB + kv + ctxActivateMiB,
		GPU:         gpu,
		Basis:       basis,
	}
	if !gpu.Present {
		e.Basis += "；CPU 模式：无显存可估"
		return e
	}
	e.ExceedsFree = e.TotalMiB > gpu.FreeMB
	return e
}

// activeModelWeightsMiB 当前 active 模型已就位档位的最大体积（MiB）；取不到返回 0。
func activeModelWeightsMiB(m *modelmanager.Manager) int {
	for _, mi := range m.List() {
		if !mi.Active {
			continue
		}
		var best int64
		for _, q := range mi.Quants {
			if q.Present && q.SizeBytes > best {
				best = q.SizeBytes
			}
		}
		return int(best / (1024 * 1024))
	}
	return 0
}

// EstimateCtxVRAM 估算给定上下文长度的显存占用（设置页自定义档用）。
func (a *App) EstimateCtxVRAM(tokens int64) (*CtxEstimate, error) {
	if err := a.ensureReady(); err != nil {
		return nil, err
	}
	if tokens < 2048 || tokens > 65536 {
		return nil, fmt.Errorf("上下文长度需在 2048–65536 之间（当前 %d）", tokens)
	}
	gpu, _ := envprobe.QueryVRAMCached(15 * time.Second) // 15s TTL：显存是粗粒度指标，容忍滞后
	e := estimateCtxVRAM(tokens, activeModelWeightsMiB(a.models), gpu)
	return &e, nil
}
```

注意：`time` 已在 app.go 引入；`envprobe`、`modelmanager`、`fmt` 也已引入（若编译报未引入，按报错补 import）。

- [x] **Step 4: 跑测试确认通过**

```bash
cd app && go test -run TestEstimateCtxVRAM -v . && go build ./... && go vet ./... && go test ./...
```
预期：`TestEstimateCtxVRAM` PASS；全仓测试仍全绿（12 个包，其中 11 个有测试）。

---

### Task 5: 设置页 ctx 自定义档 UI + 确认流

**Files:**
- Modify: `frontend/src/wailsapi.ts`（新增封装）
- Modify: `frontend/src/lib/mockbackend.ts`（新增处理器）
- Modify: `frontend/src/pages/Settings.tsx:147-154`（上下文档位行）与文件顶部 state 区
- Modify: `docs/02-执行细节说明.md` §3、`README.md`（已知限制 / UNVERIFIED）

**Interfaces:**
- Consumes: Task 3 的 `config.inference.ctxTokensOverride`（0=跟随档位）、Task 4 的绑定 `EstimateCtxVRAM`（返回字段见 Task 4）
- Produces: `apiEstimateCtxVRAM(tokens: number)`（前端唯一消费点）

- [x] **Step 1: 加绑定封装**

`frontend/src/wailsapi.ts` 的「状态 / 配置」段末尾追加：

```ts
export const apiEstimateCtxVRAM = (tokens: number) => call<any>('EstimateCtxVRAM', tokens)
```

- [x] **Step 2: 假后端补处理器（页面门禁供数用）**

`frontend/src/lib/mockbackend.ts` 的 handlers 表里，`SetConfig` 之后插入：

```ts
  EstimateCtxVRAM: (tokens: never) => {
    const t = tokens as unknown as number
    const weights = 1251
    const kv = Math.floor(t / 8192) * 875
    const gpu = { present: true, totalMB: 4096, usedMB: 900, freeMB: 3196, name: 'NVIDIA GeForce RTX 3050 Laptop GPU', driverOK: true }
    const total = weights + kv + 600
    return { tokens: t, weightsMiB: weights, kvMiB: kv, activateMiB: 600, totalMiB: total, gpu, exceedsFree: total > gpu.freeMB, basis: 'mock：线性估算' }
  },
```

- [x] **Step 3: Settings 状态与处理函数**

在 `frontend/src/pages/Settings.tsx` 的 state 区（`confirmClear` 附近）追加：

```tsx
  // ctx 自定义档（Task C）：输入以 K 为单位，保存在 config.inference.ctxTokensOverride（token 数）
  const [ctxDraftK, setCtxDraftK] = useState<number | null>(null)
  const [ctxEst, setCtxEst] = useState<any | null>(null)
  const [pendingCtxTok, setPendingCtxTok] = useState<number | null>(null)
```

在 `save` 定义之后追加：

```tsx
  const ctxOverride: number = cfg?.inference?.ctxTokensOverride ?? 0
  const ctxSel: string = ctxOverride > 0 ? '自定义' : (cfg?.inference?.ctxTier ?? '8K')

  useEffect(() => {
    if (ctxOverride > 0) setCtxDraftK(Math.round(ctxOverride / 1024))
  }, [ctxOverride])

  // 输入去抖 300ms 拉估算（只更新状态行，不落库）
  useEffect(() => {
    if (ctxSel !== '自定义' || ctxDraftK == null) return
    const t = window.setTimeout(() => {
      const tok = Math.max(2048, Math.min(65536, Math.round(ctxDraftK) * 1024))
      apiEstimateCtxVRAM(tok).then(setCtxEst).catch(() => setCtxEst(null))
    }, 300)
    return () => window.clearTimeout(t)
  }, [ctxSel, ctxDraftK])

  const onCtxSelect = (v: string) => {
    if (v === '自定义') {
      setCtxDraftK(Math.max(2, Math.round(ctxOverride / 1024)) || 8)
      return
    }
    setCtxDraftK(null)
    setCtxEst(null)
    save({ inference: { ...cfg.inference, ctxTier: v, ctxTokensOverride: 0 } })
  }

  // 失焦提交：先取一次新鲜估算，超限走确认 Modal，否则直接落库
  const commitCtx = async (k: number) => {
    const tok = Math.max(2048, Math.min(65536, Math.round(k) * 1024))
    const est = await apiEstimateCtxVRAM(tok).catch(() => null)
    setCtxEst(est)
    if (est?.exceedsFree) {
      setPendingCtxTok(tok)
      return
    }
    save({ inference: { ...cfg.inference, ctxTokensOverride: tok } })
  }
```

并把 import 行补上 `apiEstimateCtxVRAM`（`wailsapi` 那条 import 里加）。

- [x] **Step 4: 替换「上下文档位」行 + 子行 + 确认 Modal**

把 147-154 行的 Row 替换为：

```tsx
        <Row title="上下文档位" desc="影响 KV cache 显存占用">
          <Segmented<string>
            options={['8K', '16K', '32K', '自定义']}
            value={ctxSel}
            accentSel
            aria-label="上下文档位"
            onChange={onCtxSelect}
          />
        </Row>
        {ctxSel === '自定义' && (
          <Row title="上下文长度" desc="2K–64K，步进 1K">
            <input
              aria-label="上下文长度（单位 K）"
              className={numInputCls}
              type="number"
              min={2}
              max={64}
              step={1}
              value={ctxDraftK ?? 8}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                if (!Number.isNaN(n)) setCtxDraftK(n)
              }}
              onBlur={() => commitCtx(ctxDraftK ?? 8)}
            />
            <span className="text-caption text-ink3">K</span>
          </Row>
        )}
        {ctxSel === '自定义' && ctxEst && (
          <div className={`px-5 pb-3 -mt-2 text-caption ${ctxEst.exceedsFree && ctxEst.gpu?.present ? 'text-danger' : 'text-ink3'}`}>
            {ctxEst.gpu?.present
              ? `预计占用 ${(ctxEst.totalMiB / 1024).toFixed(1)} GB / 当前可用 ${(ctxEst.gpu.freeMB / 1024).toFixed(1)} GB`
              : `CPU 模式：无显存可估，ctx 越大越慢（预计内存 ${(ctxEst.totalMiB / 1024).toFixed(1)} GB）`}
            {ctxEst.exceedsFree && ctxEst.gpu?.present ? ' —— 超过可用显存，保存前会再确认' : ''}
          </div>
        )}
```

在文件末尾既有 Modal 群之后追加确认弹窗：

```tsx
      {/* ctx 自定义档：显存可能不足时的二次确认（破坏性，初始焦点在取消） */}
      <Modal
        open={pendingCtxTok !== null}
        onClose={() => setPendingCtxTok(null)}
        title="显存可能不足"
        initialFocus="cancel"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setPendingCtxTok(null)}>
              取消
            </Button>
            <Button
              kind="danger"
              data-modal-initial="confirm"
              onClick={() => {
                if (pendingCtxTok !== null) {
                  save({ inference: { ...cfg.inference, ctxTokensOverride: pendingCtxTok } })
                }
                setPendingCtxTok(null)
              }}
            >
              仍要使用
            </Button>
          </>
        }
      >
        <p className="text-body text-ink2">
          上下文 {pendingCtxTok ? pendingCtxTok / 1024 : 0}K 预计占用{' '}
          {((ctxEst?.totalMiB ?? 0) / 1024).toFixed(1)} GB，超过当前可用显存{' '}
          {((ctxEst?.gpu?.freeMB ?? 0) / 1024).toFixed(1)} GB。以上为估算值（±20%），
          继续可能触发显存不足导致模型加载失败；失败后可回设置页调回小档位。
        </p>
      </Modal>
```

- [x] **Step 5: 类型与门禁**

```bash
cd frontend && npx tsc --noEmit && npm run lint:design && npm run verify:pages:a11y && npm run verify:pages:contrast
```
预期：tsc 干净、lint 0 命中、两组页面门禁全绿（假后端已能应答 `EstimateCtxVRAM`，未选中"自定义"时页面不调它）。

- [x] **Step 6: 手工验证一次交互（dev server）**

```bash
cd frontend && npx vite --host 127.0.0.1 --port 5173
# 浏览器打开 http://127.0.0.1:5173/?mock&page=settings
```
点「上下文档位 → 自定义」→ 输入 `32` → 状态行应显示红字「预计占用 5.2 GB / 当前可用 3.1 GB ……」；
点输入框外 → 弹出「显存可能不足」→ 焦点在「取消」→ 点「仍要使用」→ 输入框保留 32，
「上下文档位」保持"自定义"。改回「16K」→ 子行消失。

- [x] **Step 7: 文档同步**

> **执行记录（2026-10-06 实测）**：交互探针抓到一个计划没预料到的 bug —— `ctxSel` 若只由
> `config.ctxTokensOverride` 推导，点「自定义」时 override 还是 0，Segmented 的 `value` 会把选中态
> 弹回预设档，自定义子行永不出现（类型检查与门禁都测不到）。修法：推导式改为
> `ctxOverride > 0 || ctxDraftK !== null ? '自定义' : tier`（草稿态也算"自定义"）。
> 全链路实测结果：切自定义→输入 32→红字「预计占用 5.2 GB / 当前可用 3.1 GB」→失焦弹「显存可能不足」
> （焦点在取消）→「仍要使用」落库且输入框保留 32→切回 16K 子行消失。

1. `docs/02-执行细节说明.md` §3 对策第 1 条里「UI 仅暴露 **8K / 16K / 32K** 三档」改为
   「UI 暴露 8K/16K/32K 预设 + **自定义 2K–64K（步进 1K）**；自定义档在保存前会按线性模型估算显存占用，
   超可用显存时二次确认」。
2. `README.md` 的 UNVERIFIED 清单追加：
   `64K 档（>32K）真机未验证：模型标称 262144 positions 理论支持，但 -c 65536 的启动耗时/显存峰值/失败退避从未实测；首次使用建议手动观察一次。`

---

### Task 6: 约束模板详情（ModeDetails + 两处入口）

**Files:**
- Create: `frontend/src/components/ModeDetails.tsx`
- Modify: `frontend/src/pages/MainTranslate.tsx`（模式下拉旁加 Info 按钮）
- Modify: `frontend/src/pages/Settings.tsx`（内置模板行加「查看」）

**Interfaces:**
- Consumes: `lib/modes.ts` 的 `ModePreset`（`id/name/description/builtin?/constraints`）与 `ModeConstraints`（`hard:string[]/soft:string[]/genre:string/jsonPreserve:boolean`）；`components/ui/index` 的 `Modal`、`Button`、`IconButton`
- Produces: `export function ModeDetails({ preset, open, onClose }: { preset: ModePreset | null; open: boolean; onClose: () => void })`，两个页面各挂一个实例

- [x] **Step 1: 写组件**

新建 `frontend/src/components/ModeDetails.tsx`：

```tsx
// ModeDetails —— 约束模板只读详情（主翻译台顶栏与设置页共用）。
// 展示一份 ModePreset 的全部约束字段；只读，故 initialFocus="first"。
import { Modal } from './ui/index'
import type { ModePreset } from '../lib/modes'

export function ModeDetails({
  preset,
  open,
  onClose,
}: {
  preset: ModePreset | null
  open: boolean
  onClose: () => void
}) {
  const c = preset?.constraints
  return (
    <Modal open={open} onClose={onClose} title={preset ? `约束详情：${preset.name}` : '约束详情'} initialFocus="first">
      {preset && c ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink2">{preset.description}</p>
          <div>
            <div className="text-micro uppercase tracking-caps text-ink3 mb-1.5">
              硬约束 · <b className="text-ink2 font-medium">HARD</b>
            </div>
            {c.hard.length ? (
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-caption text-ink2">
                {c.hard.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            ) : (
              <p className="text-caption text-ink3">无（不加硬性要求）</p>
            )}
          </div>
          <div>
            <div className="text-micro uppercase tracking-caps text-ink3 mb-1.5">
              软约束 · <b className="text-ink2 font-medium">SOFT</b>
            </div>
            {c.soft.length ? (
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-caption text-ink2">
                {c.soft.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-caption text-ink3">无</p>
            )}
          </div>
          <div className="flex gap-6 text-caption text-ink2">
            <span>
              文体域：<b className="text-ink1 font-medium">{c.genre || '文本'}</b>
            </span>
            <span>
              JSON 结构保持：<b className="text-ink1 font-medium">{c.jsonPreserve ? '开' : '关'}</b>
            </span>
          </div>
          {preset.builtin ? (
            <p className="text-caption text-ink3">内置模板，只读；可在约束抽屉里微调后另存为自定义模式。</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
```

- [x] **Step 2: 主翻译台入口**

`frontend/src/pages/MainTranslate.tsx`：

1. import 追加：`import { ModeDetails } from '../components/ModeDetails'`（放在既有 components import 之后）；
   图标 import 里加 `Info`（既有 lucide 行：`import { AlertTriangle, ArrowLeftRight, … } from 'lucide-react'`）。
2. 在 `<select>` 所在的 `</label>` 之后（约 415 行）插入：

```tsx
          <IconButton
            icon={<Info size={15} strokeWidth={2} />}
            label="查看当前模式详情"
            onClick={() => setModeDetail(modeOptions.find((m) => m.id === modeId) ?? null)}
          />
```

3. state 区追加：

```tsx
  const [modeDetail, setModeDetail] = useState<ModePreset | null>(null)
```

4. **改既有 import 行**（`ModePreset` 当前没导入）：
   `import { allModes, MANUAL_CUSTOM_ID, useModeStore, type ModeConstraints } from '../lib/modes'`
   →
   `import { allModes, MANUAL_CUSTOM_ID, useModeStore, type ModeConstraints, type ModePreset } from '../lib/modes'`
5. JSX 末尾（与其它浮层同层）追加：

```tsx
      <ModeDetails preset={modeDetail} open={modeDetail !== null} onClose={() => setModeDetail(null)} />
```

- [x] **Step 3: 设置页入口**

`frontend/src/pages/Settings.tsx`：

1. import 追加 `ModeDetails`；state 区加 `const [detailMode, setDetailMode] = useState<ModePreset | null>(null)`（`ModePreset` 已在该文件 import）。
2. 内置模板行的 `<Badge>内置</Badge>` **之前**插入查看按钮：

```tsx
              <Button size="sm" onClick={() => setDetailMode(m)}>
                查看
              </Button>
              <Badge>内置</Badge>
```
3. 文件末尾追加：

```tsx
      <ModeDetails preset={detailMode} open={detailMode !== null} onClose={() => setDetailMode(null)} />
```

- [x] **Step 4: 门禁与人工路径**

```bash
cd frontend && npx tsc --noEmit && npm run verify:pages
```
预期：tsc 干净；verify:pages 三组全绿（新增按钮走 secondary Button 样式，对比度无忧）。
人工：`?mock&page=settings` 点任一内置模板「查看」→ 弹窗列出硬/软约束 → Esc 关闭且焦点回按钮；
主翻译台（`?mock&page=translate`）点「查看当前模式详情」→ 弹窗与下拉所选模式一致。

---

### Task 7: 字体接线（@font-face + 栈 + 门禁断言）

**Files:**
- Modify: `frontend/src/theme/base.css`（新增两段 `@font-face`）
- Modify: `frontend/src/theme/tokens.css:232`（`--font-app`）
- Modify: `frontend/scripts/verify-theme.mjs`（字体加载与 #7 断言）
- Modify: `docs/03-GUI设计图/DESIGN.md` §3.1/§3.2/§3.3、`README.md`（许可与回退边界）

**Interfaces:**
- Consumes: 已落库的四份文件（两个 woff2 + 两份 OFL 文本），见文首"字体资产已就位"
- Produces: `@font-face` 家族名 `'Archivo'` 与 `'Noto Sans SC'`；`--font-app` 新栈

- [x] **Step 1: `@font-face`（`theme/base.css`，插在 JetBrains Mono 那段之后）**

```css
/* v2.1 瑞士重映射新增（2026-10-06）：Archivo 管拉丁、Noto Sans SC 子集管中文。
   两份都裁到 wght 400–600；Noto 是 GB2312+假名+标点的子集（7994 字形），
   超出子集的字按字形回退系统雅黑 —— 口径见 DESIGN.md §3.1。 */
@font-face {
  font-family: 'Archivo';
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url('../assets/fonts/archivo-latin-wght400-600.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC,
    U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215,
    U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Noto Sans SC';
  font-style: normal;
  font-weight: 400 600;
  font-display: swap;
  src: url('../assets/fonts/noto-sans-sc-cjk-wght400-600.woff2') format('woff2');
  /* 只认 CJK 与假名；拉丁字形已被子集剔除，即使误置队首也不会渲染拉丁 */
  unicode-range: U+2E80-303F, U+3040-30FF, U+31C0-33FF, U+4E00-9FFF;
}
```

- [x] **Step 2: 字体栈（`theme/tokens.css`）**

把 `--font-app` 那行替换为（`--font-mono` 不动）：

```css
  --font-app: 'Archivo', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans SC', 'Microsoft YaHei UI', 'Source Han Sans CN', 'PingFang SC', system-ui, sans-serif;
```

并把该段注释里的"Swiss：Helvetica/Arial 优先，弃用 Inter"更新为
"Swiss：Archivo（内嵌，拉丁）+ Noto Sans SC 子集（内嵌，中文），系统 Helvetica/Arial/雅黑 兜底；Inter 已弃用"。

- [x] **Step 3: verify-theme 加载与断言**

`frontend/scripts/verify-theme.mjs`：

1. 加载块（约 182-187 行）改为：

```js
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "JetBrains Mono"'),
      document.fonts.load('600 16px Archivo'),
      document.fonts.load('400 16px "Noto Sans SC"'),
    ])
    await document.fonts.ready
  })
```

2. `#7` 断言块改为（保留 no-Inter 与无外链两条，新增两份新字体的 200 与可用性）：

```js
  const fontFaces = await page.evaluate(async () => {
    const faces = []
    document.fonts.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.status}`))
    return {
      faces,
      jbm: document.fonts.check('400 16px "JetBrains Mono"'),
      archivo: document.fonts.check('600 16px Archivo'),
      noto: document.fonts.check('400 16px "Noto Sans SC"'),
      interRegistered: faces.some((f) => f.startsWith('Inter ')),
    }
  })
  const jbmFile = fontResponses.find((r) => r.url.includes('jetbrains-mono-latin'))
  const archivoFile = fontResponses.find((r) => r.url.includes('archivo-latin'))
  const notoFile = fontResponses.find((r) => r.url.includes('noto-sans-sc-cjk'))
  const interFile = fontResponses.find((r) => r.url.includes('inter-latin'))
  const external = fontResponses.filter((r) => r.external)
  const fontsOk = Boolean(
    jbmFile && jbmFile.status === 200 &&
    archivoFile && archivoFile.status === 200 &&
    notoFile && notoFile.status === 200 &&
    fontFaces.jbm && fontFaces.archivo && fontFaces.noto &&
    !interFile && !fontFaces.interRegistered &&
    external.length === 0,
  )
  const short = (r) => (r ? `${r.status} ${r.url.replace(/^https?:\/\/[^/]+/, '')}` : '未请求')
  record(7, '[附加·离线字体] 三份 woff2 均被请求（200）且可用；无 Inter、无站外请求', fontsOk, [
    `字体请求共 ${fontResponses.length} 条：${fontResponses.map(short).join(' | ') || '（无）'}`,
    `jetbrains-mono-latin → ${short(jbmFile)}`,
    `archivo-latin → ${short(archivoFile)}`,
    `noto-sans-sc-cjk → ${short(notoFile)}`,
    `inter-latin → ${interFile ? `仍被请求（${interFile.status}）——v2.1 应已移出仓库` : '未请求（符合预期）'}`,
    `@font-face 里是否残留 Inter：${fontFaces.interRegistered ? '有（违规）' : '无'}`,
    `check: jbm=${fontFaces.jbm} archivo=${fontFaces.archivo} noto=${fontFaces.noto}`,
    `已注册 @font-face：${fontFaces.faces.join(' | ') || '（无）'}`,
  ].join('\n'))
```

- [x] **Step 4: 跑 theme 门禁**

```bash
cd frontend && npm run verify:theme
```
预期：`#7` PASS，明细里三条请求都是 `200 …/assets/archivo-latin-*.woff2` 一类的本地 URL。
若 `noto` 为 false：确认 `@font-face` 的 `unicode-range` 写法与 subset 一致（用 `document.fonts.load('400 16px "Noto Sans SC"', '测试')` 传第二参数也可验证）。

- [x] **Step 5: 文档同步**

1. `DESIGN.md` §3.1：把「**打包**：只有 JetBrains Mono…」段改为三份字体清单 + 体积账（18.3KB / 1.72MB / 31.4KB，exe +1.74MB），
   并写明 **CJK 覆盖边界**（超出子集逐字回退系统雅黑）。
2. `DESIGN.md` §3.2：字体栈换成新栈；把「Windows 上没有 Helvetica Neue/Helvetica，拉丁实际落到 **Arial**」
   改为「拉丁命中内嵌 Archivo；Archivo 缺失时才回落 Arial」。
3. `DESIGN.md` §3.3 的字重说明补一句：600 在 Archivo/Noto 子集里是**真 600**；只有整链回退到 Arial 时才等效 700。
4. `README.md`：已知限制里的字体条目改为
   「内嵌字体三份（Archivo / JetBrains Mono / Noto Sans SC 子集）均为 SIL OFL 1.1，许可证文本已随
   `frontend/src/assets/fonts/OFL-*.txt` 分发；CJK 子集不覆盖生僻字/繁体/韩文，会逐字回退系统雅黑」。

- [x] **Step 6: 全量回归**

```bash
cd frontend && npm run build && npm run verify:all && npm run verify:pages
```
预期：build 产物里出现 `archivo-latin-*.woff2` 与 `noto-sans-sc-cjk-*.woff2` 两个 asset；三组命令全绿。

---


> **执行记录（2026-10-06 实测）**：三份 woff2 在 `verify-theme #7` 全部 200 且 `document.fonts`
> 状态为 loaded；`npm run build` 产物含三份字体（18.74KB / 31.43KB / 1.80MB）。
> 字形归属用 fontTools 查 cmap 验证（**不要用 `document.fonts.check()` 做覆盖判断——它只回答
> "字体已加载"，对缺字同样返回 true**）：Archivo 有拉丁、无 CJK；Noto 子集有 模型/：/モ，
> 无「龘」（GB2312 外）也无拉丁 M。Noto 子集实际覆盖 **7764 个码位 / 7994 个字形**。
> 另修一处自查发现的范围漏洞：`unicode-range` 起初漏了 `U+FF00-FFEF`，会让全角标点（：（））
> 逐字回退系统字体——已补进声明。

---

### Task 8: 全量回归与人工验收清单

**Files:**
- Modify: `README.md`（若前面各任务的文档步有遗漏，在此补齐）

**Interfaces:**
- Consumes: Task 1–7 的全部产物
- Produces: 可交付状态与一份人工清单结论

- [x] **Step 1: 四组命令全量跑一遍**

```bash
cd app && go build ./... && go vet ./... && go test ./...
cd ../frontend && npm run verify:all && npm run verify:pages && npm run build
```

**实测结果（2026-10-06，全部 exit 0）**：
- 后端：`go build` / `go vet` 干净；`go test ./...` 12 包全过（config 从本轮的"无测试"变为有测试；docpipeline 仍是空壳无测试）
  → **2026-10-07 复核**：同轮之后又新增 `internal/vramestimate`，现为 **13 个包 / 12 个有测试**，
  在合并后的 `master` 上以 `go test -count=1 ./...` 重跑仍全过。上面那句按当时状态留档，不改。
- `verify:all`：lint 0 命中、theme 10/10、wails 7/7、lib 24/24、a11y 6/6、datatable 3/3、contrast 全绿、keyboard **PASS 10 / SKIP 0 / FAIL 0**
- `verify:pages`：a11y **20/20**（critical=0 && serious=0）、contrast 全绿、keyboard **PASS 9 / SKIP 1 / FAIL 0**（SKIP 为 RM2 spinner，组件层已覆盖）
- `npm run build`：产物含三份字体（18.74KB / 31.43KB / 1.80MB）、CSS 34.73KB、JS 273.14KB

- [x] **Step 2: 人工清单（逐项打勾，结果写回本计划）**

- [x] 1180 宽：模型中心顶栏单行；1036 宽：整块换行（T2 探针：1180 行数 1 / 1036 行数 2，按钮宽 147 高 32 且不折字）
- [x] 历史侧栏条目单行缩略：T1 探针实测 80px（此前 102–154），`clientHeight 22 < scrollHeight 43`，title 已挂
- [x] 设置页自定义 ctx 全链路：T5 探针 9 项断言（红字「预计占用 5.2 / 可用 3.1 GB」、弹窗焦点在取消、「仍要使用」落库、切回预设子行消失）
- [x] 模式详情弹窗：T6 探针 9 项断言（两个模板内容、空约束分支、Esc 关闭且焦点归还「查看」、主翻译台 Info 与下拉一致）
- [x] 字体字形归属：T7 用 fontTools 查 cmap 验证（Archivo 有拉丁无 CJK；Noto 子集有 模型/：/モ、无 龘/M），verify-theme #7 三份 200 且 loaded
- [x] 重建 exe（2026-10-06，用户指示）：`node scripts/build.mjs` 成功，exe = 20,563,456 B（19.6MB，较旧 18.7MB +1.8MB ≈ 字体净增）。
      嵌入自检：`suj-ink-1` 命中 1、`archivo-latin`/`noto-sans-sc-cjk` 各 2、`wOF2` 魔数命中 5、前端入口哈希 `BQZLdinv` 命中 2
      （证明 embed 同步生效）；新增功能串 `显存可能不足` / `约束详情` / `上下文长度` / `EstimateCtxVRAM` 均在。
      注：`clamp-display-conflict` 命中 0 属正确——那是 lint 规则 id，只存在于 `scripts/`，本就不该进包。
- [x] 重建 exe（2026-10-07 18:11，合并后）：`node scripts/build.mjs` exit 0，exe = 20,568,576 B。
      自检换了更强的判据 —— 直接断言**整份 JS bundle 与整份 CSS 逐字节包含于 exe**（两条都 true），
      比数字符出现次数更能证明 embed 同步。另：`suj-ink-1` 命中 7、`#2e6b4f`/`#5fbf8f`（绿色 `--suj-ok`）、
      `Archivo`/`Noto Sans SC`、新功能串 `下载中`/`仍要使用`/`SHA256 校验中`/`取消下载` 均在，`verify-*` 不在。
      **踩过的坑，别再踩**：用 `readFileSync(...,'latin1').toLowerCase()` 搜中文串会得到假的 ABSENT ——
      小写化会破坏多字节 UTF-8 序列。中文/非 ASCII 一律按 `Buffer.from(s,'utf8')` 在 Buffer 上 `includes`，
      不做任何编码转换。本轮第一次自检就是这样误报过 `2e6b4f` "不在包里"。

- [x] **Step 3: 汇报** → 结论汇总已交付在对话中（2026-10-06）

汇总到对话里：每条改动的文件与行、门禁输出、人工清单结论、UNVERIFIED 新增项（64K 真机、估算偏差）、
以及"未做"项（DESIGN §6.2 其余断点、P4 陈列页出包、motion-plan.json 重生成）。

---

## 自检记录（写计划时自查，非执行步骤）

- **spec 覆盖**：A→Task 1；B→Task 2；C→Task 3/4/5；D→Task 6；E→Task 7；验证计划→Task 8。无遗漏。
- **占位符扫描**：无 TBD/TODO；所有代码块为可直接粘贴的完整片段。
- **类型一致性**：`CtxTokensOverride`（Go 字段 / json `ctxTokensOverride`）、`EffectiveCtxTokens()`、
  `EstimateCtxVRAM`、`ctxEst.totalMiB / gpu.freeMB / exceedsFree`、`ModeDetails({preset,open,onClose})`、
  lint 规则 id `clamp-display-conflict` 在任务间用法一致。
- **已知取舍**：Task 5 的输入未走 `NumberField` 原语（它在 Row 内会因纵向 label 破坏行布局），
  改用与同页三个数字输入一致的 `numInputCls` + `aria-label`，a11y 由 `aria-label` 满足（§7.7）。
- **写计划时已实测的两点**：① Task 1 的 lint 正则对当前仓库跑过——恰好命中
  `MainTranslate.tsx:326/327` 两处、无正例外的误伤；② Task 5 的 hooks 落点核过
  `Settings.tsx` 结构——state 在 34-50、`save` 在 59、早退在 121，新增 hook 放在 `save` 之后
  仍位于早退之前，不违反 rules-of-hooks。
