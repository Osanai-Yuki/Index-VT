#!/usr/bin/env node
/**
 * 素笺 design-token 漂移 lint · 零依赖（DESIGN.md §10 漂移防线）
 * ------------------------------------------------------------
 * 扫描 frontend/src/**\/*.{ts,tsx,css}，命中下列任一规则即构建失败：
 *
 *   raw-color     #hex / rgba?(            写死色值
 *   arbitrary     text-[13px] 一类         Tailwind 任意值（未列入前缀的 top-/max-h- 等
 *                                          由子串匹配覆盖，属有意为之）
 *   no-outline    outline-none             移除焦点环（a11y 硬伤）
 *   div-click     <div|span … onClick      非语义可点元素（键盘不可达）
 *   native-dialog alert( / confirm( / prompt(  系统对话框（须用 Modal/Toast 取代）
 *   remote-font   fonts.googleapis / @import url(  外链字体（应用离线运行）
 *   emoji         emoji 码位区间            emoji 当图标（图标只用 lucide-react）
 *   legacy-token  bg-bg-3 / text-ink-1 / *-hairline / 旧 *-soft / *-line
 *                                          新文件里用旧 token utility（防新旧混用；
 *                                          旧名清单来自旧 styles/tokens.css 的 @theme 键）
 *   clamp-display-conflict  line-clamp-* 与 block/flex/grid 同元素
 *                                          clamp 依赖 display:-webkit-box，被覆盖即静默失效
 *
 * 白名单（并存期机制，DESIGN.md §9 / 计划「并存期的 lint 策略」）：
 *   scripts/design-lint-legacy.txt 一行一个相对 frontend/ 的路径，命中的文件整体跳过。
 *   初始内容 = 迁移前的全部旧文件；Track C 每迁移完一页删一行 → 白名单长度即迁移进度。
 *   theme/tokens.css 与 theme/base.css 恒定豁免（token 定义处必须有字面色值），不占白名单行。
 *
 * 单行豁免：行尾 `// lint-allow: <rule-id> —— <理由>`（CSS 用 `/* … *\/`），
 *   理由必须写——缺失理由的豁免注释本身按违规上报（allow-without-reason）。
 *   用于唯一合理场景：虚拟化算出的 inline style 不得不写字面值等。
 *
 * 用法：
 *   node scripts/lint-design-tokens.mjs               # 正常构建用（带白名单）
 *   node scripts/lint-design-tokens.mjs --no-legacy   # 自检开关：白名单视为空，
 *                                                     # 用于证明 lint 对旧代码报得出大量命中
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')
const SRC = path.join(FRONTEND, 'src')
const LEGACY_LIST = path.join(HERE, 'design-lint-legacy.txt')

const NO_LEGACY = process.argv.includes('--no-legacy')

/* ── 规则表（正则与 DESIGN.md §10 / 计划 Task 2.2 一致，禁止放宽）────────── */
const RULES = [
  {
    id: 'raw-color',
    re: /#[0-9a-fA-F]{3,8}\b|rgba?\(/g,
    reason: '写死色值 → 一律走语义 token（bg-canvas / text-ink1 …），色值改动需重算对比度',
  },
  {
    id: 'arbitrary',
    // 前缀表含偏移类（left/right/top/bottom/inset）——早先漏了它们，
    // Rail 激活竖条的 -left-[10px] 因此从防线里溜过去（2026-10-06 补）。
    re: /(?:text|rounded|p|m|gap|w|h|leading|tracking|border|left|right|top|bottom|inset)-\[[^\]]+\]/g,
    reason: 'Tailwind 任意值 → 用 token utility（字号六级/圆角四级/间距 4px 基线；偏移用 -left-2.5 一类刻度档）',
  },
  {
    id: 'no-outline',
    re: /\boutline-none\b/g,
    reason: '移除焦点环 → 焦点环由 theme/base.css 的 :focus-visible 统一提供，禁止关掉',
  },
  {
    id: 'div-click',
    re: /<(?:div|span)\b[^>]*\bonClick\s*=/g,
    reason: 'div/span + onClick 不可键盘达 → 用 <button> 等真实语义元素',
  },
  {
    id: 'native-dialog',
    re: /\b(?:alert|confirm|prompt)\s*\(/g,
    reason: '系统对话框 → 用 Modal / Toast 原语（components/ui）',
  },
  {
    id: 'remote-font',
    re: /fonts\.googleapis|fonts\.gstatic|@import\s+url\(/g,
    reason: '外链字体 → 应用离线运行，字体一律本地 woff2（src/assets/fonts）',
  },
  {
    id: 'emoji',
    re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu,
    reason: 'emoji 当图标 → 图标只用 lucide-react，stroke 1.75',
  },
  {
    // 旧 token utility（来自旧 styles/tokens.css 的 @theme inline 键）：
    // bg-bg-0..4、text-ink-1..3、*hairline*、旧 *-soft（teal/info/accent-soft …）、accent-line。
    // 新层对应 utility 是 bg-surface / text-ink1（无连字符）/ bg-accentSoft（驼峰）——同名无歧义。
    id: 'legacy-token',
    re: /\b(?:bg-bg-\d|text-ink-\d|(?:bg|text|border|ring)-hairline(?:-2)?\b|(?:bg|text|border|ring)-(?:accent|teal|danger|warn|info)-(?:soft|line)\b)/g,
    reason: '新文件使用旧 token utility → 新代码一律用素笺语义 token（text-ink1 非 text-ink-1）',
  },
  {
    id: 'clamp-display-conflict',
    /* line-clamp 依赖 display:-webkit-box；同元素再挂显式 display 会让它静默失效。
       实测：MainTranslate 历史条目的 `block … line-clamp-1` → computed display:block，
       条目高 102–154px（本应 ~75px）。 */
    re: /(?:className|class)=[{`"'](?=[^`"'\n]*\bline-clamp-\d)(?=[^`"'\n]*\b(?:block|inline-block|flex|grid)\b)[^`"'\n]*/g,
    reason: 'line-clamp 与显式 display 同元素 → clamp 失效；去掉 block/flex/grid，clamp 自带 display:-webkit-box',
  },
]

/* 恒定豁免：token 定义处必须有字面色值（相对 frontend/ 的路径） */
const ALWAYS_EXEMPT = new Set(['src/theme/tokens.css', 'src/theme/base.css'])

/* ── 文件收集 ─────────────────────────────────────────────── */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|css)$/.test(entry.name)) out.push(full)
  }
  return out
}

/* ── 白名单 ───────────────────────────────────────────────── */
function loadLegacyWhitelist() {
  if (NO_LEGACY) return new Set()
  if (!fs.existsSync(LEGACY_LIST)) return new Set()
  const lines = fs.readFileSync(LEGACY_LIST, 'utf8').split(/\r?\n/)
  return new Set(
    lines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replaceAll('\\', '/')),
  )
}

/* ── 行号映射：match index → 行号 ─────────────────────────── */
function lineStarts(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}
function lineOf(starts, idx) {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= idx) lo = mid
    else hi = mid - 1
  }
  return lo + 1
}

/* ── lint-allow 解析：`lint-allow: id[,id…] —— 理由` ────────
   理由必须写：无理由的豁免注释按违规上报（allow-without-reason）。 */
const ALLOW_RE = /lint-allow:\s*([a-z0-9, -]+?)\s*(?:[—–:]+|\(\s*)([^*]*?)\s*\)?\s*$/i
function parseAllows(line) {
  const allowed = new Set()
  const problems = []
  const m = line.match(ALLOW_RE)
  if (!m) return { allowed, problems }
  const ids = m[1].split(',').map((s) => s.trim()).filter(Boolean)
  const reason = (m[2] ?? '').trim()
  if (reason.length < 4) {
    problems.push('allow-without-reason')
    return { allowed, problems }
  }
  for (const id of ids) {
    if (!RULES.some((r) => r.id === id)) {
      problems.push(`allow-unknown-rule:${id}`)
      continue
    }
    allowed.add(id)
  }
  return { allowed, problems }
}

/* ── 主流程 ───────────────────────────────────────────────── */
const whitelist = loadLegacyWhitelist()
const files = walk(SRC)
const hits = []

for (const file of files) {
  const rel = path.relative(FRONTEND, file).replaceAll('\\', '/')
  if (ALWAYS_EXEMPT.has(rel)) continue
  if (whitelist.has(rel)) continue

  const text = fs.readFileSync(file, 'utf8')
  const starts = lineStarts(text)
  const lines = text.split(/\r?\n/)

  // 每行先算豁免集合（允许整行内多个规则各挂一条豁免注释）
  const perLine = lines.map((l) => parseAllows(l))

  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m
    while ((m = rule.re.exec(text)) !== null) {
      const ln = lineOf(starts, m.index)
      const { allowed, problems } = perLine[ln - 1]
      if (allowed.has(rule.id)) continue
      for (const p of problems) {
        hits.push({ rel, ln, rule: p, snippet: lines[ln - 1].trim(), reason: 'lint-allow 注释本身不合规（理由缺失或规则 id 不存在）' })
      }
      hits.push({
        rel,
        ln,
        rule: rule.id,
        snippet: lines[ln - 1].trim().slice(0, 100),
        reason: rule.reason,
      })
    }
  }
}

if (hits.length) {
  hits.sort((a, b) => a.rel.localeCompare(b.rel) || a.ln - b.ln)
  for (const h of hits) {
    console.log(`${h.rel}:${h.ln} [${h.rule}] ${h.snippet}\n    ↳ ${h.reason}`)
  }
  console.error(`\ndesign lint：${hits.length} 处命中（${NO_LEGACY ? '白名单已禁用 --no-legacy' : '白名单外的文件零容忍'}）`)
  process.exit(1)
}

console.log(`design lint：${files.length} 个文件扫描通过（白名单 ${whitelist.size} 个文件跳过）`)
