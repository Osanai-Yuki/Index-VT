#!/usr/bin/env node
/**
 * a11y 验收矩阵 · Playwright + axe-core（DESIGN.md §7 / 计划 Task 2.2）
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/verify-a11y.mjs <path> [widths=1180,1366,1680] [themes=light,dark]
 *   例：node scripts/verify-a11y.mjs "/?primitives" 1180,1366,1680 light,dark
 *
 *   Git Bash 注意：MSYS 会把以 / 开头的参数改写成本地盘路径（实测 `node … /` 变成
 *   `D:/Programs/Git/`）。直接调 node 时前置 `MSYS_NO_PATHCONV=1`；经 npm scripts
 *   （npm run verify:a11y -- "/?primitives"）走 cmd.exe 无此问题。
 *
 * 对每个 (宽度 × 主题) 组合：设视口 → 导航到目标页 → applyTheme(t)（复用
 * src/theme/theme.ts 的真实运行时，写 localStorage + data-theme）→ AxeBuilder 全页扫描
 * → 汇总 critical/serious/moderate/minor。任一组合出现 critical 或 serious > 0 即 exit 1。
 *
 * 注意：本脚本验证的是**门禁本身**。旧页面（/ 等）在 Track C 迁移前允许有 violation
 * （legacy 白名单同理）——2.2 只证明 harness 可用；2.5 起陈列页必须六组全零。
 *
 * 本机 harness 两条硬事实（与 scripts/verify-theme.mjs 相同，勿重复发现）：
 *   (1) `npx playwright install chromium` 下载在本机不可达（cdn 30s 超时实测）→
 *       不依赖自带浏览器，launch 顺序：系统 Chrome → 系统 Edge → 自带 chromium。
 *   (2) 本机对 IPv6 loopback connect() 返回 EACCES，vite 默认只绑 [::1] →
 *       显式 --host 127.0.0.1；直启 node+vite 不经 npm，避免孤儿进程占端口。
 */
import { spawn } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')

const DEV_HOST = '127.0.0.1'
const DEV_PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.slice('--port='.length) ?? 5173)
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}/`

/* 位置参数：<path> [widths] [themes]（--port=N 一类开关已剔除） */
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const PAGE_PATH = args[0] ?? '/'
const WIDTHS = (args[1] ?? '1180,1366,1680').split(',').map(Number).filter(Boolean)
const THEMES = (args[2] ?? 'light,dark').split(',').filter(Boolean)

/* 主题运行时在页面内的模块地址（vite dev 直接服务 TS 源文件）——
   用真实模块而不是探针里重写 applyTheme，测的才是交付物本身。 */
const THEME_MODULE = '/src/theme/theme.ts'

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => { res.resume(); resolve(res.statusCode !== undefined) })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

async function ensureDevServer() {
  if (await probe(DEV_URL)) {
    console.log(`· dev server 已在 ${DEV_URL}（复用现有进程）`)
    return null
  }
  console.log(`· 启动 vite dev server（${DEV_URL}）…`)
  const viteBin = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(
    process.execPath,
    [viteBin, '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'],
    { cwd: FRONTEND, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (d) => { output += d.toString() })
  child.stderr.on('data', (d) => { output += d.toString() })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite dev 提前退出（code ${child.exitCode}）\n${output}`)
    if (/already in use/i.test(output)) throw new Error(`端口 ${DEV_PORT} 已被占用，但 ${DEV_URL} 探不通：\n${output}`)
    if (await probe(DEV_URL)) {
      console.log(`· vite 就绪：${output.split('\n').find((l) => l.includes('ready in'))?.trim() ?? ''}`)
      return child
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  child.kill()
  throw new Error(`vite dev 90s 内未就绪\n${output}`)
}

async function loadChromium() {
  try {
    return (await import('playwright')).chromium
  } catch {
    try {
      return (await import('playwright-core')).chromium
    } catch {
      throw new Error('找不到 playwright。先在 frontend/ 下执行：npm i -D playwright')
    }
  }
}

async function launchBrowser(chromium) {
  const attempts = [
    { label: 'system chrome', opts: { channel: 'chrome' } },
    { label: 'system msedge', opts: { channel: 'msedge' } },
    { label: 'playwright chromium', opts: {} },
  ]
  let lastError
  for (const a of attempts) {
    try {
      const browser = await chromium.launch(a.opts)
      console.log(`· 浏览器：${a.label} ${browser.version()}`)
      return browser
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`无法启动任何 Chromium：${String(lastError).split('\n')[0]}`)
}

/* ── axe 扫描 ─────────────────────────────────────────────── */
async function scanCombo(page, AxeBuilder, width, theme) {
  await page.setViewportSize({ width, height: 800 })
  await page.goto(DEV_URL + PAGE_PATH.replace(/^\//, ''), { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  /* 主题切换走真实运行时（写 localStorage + data-theme）；模块若不可达
     （例如页面模块加载失败）则退化为 DOM 属性直写，保证扫描总能换上主题。 */
  await page.evaluate(async ({ mod, t }) => {
    try {
      const m = await import(mod)
      m.applyTheme(t)
    } catch {
      document.documentElement.setAttribute('data-theme', t)
    }
  }, { mod: THEME_MODULE, t: theme })

  const results = await new AxeBuilder({ page }).analyze()
  const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  for (const v of results.violations) {
    byImpact[v.impact === 'critical' || v.impact === 'serious' || v.impact === 'moderate' || v.impact === 'minor' ? v.impact : 'minor'] += v.nodes.length
  }
  return { width, theme, byImpact, violations: results.violations }
}

async function main() {
  console.log(`── verify-a11y.mjs · path=${PAGE_PATH} widths=${WIDTHS.join('/')} themes=${THEMES.join('/')} ──`)
  const AxeBuilder = (await import('@axe-core/playwright')).default
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  const combos = []
  try {
    /* axe 要求显式 context（browser.newPage() 的隐式 context 不带 CDN 前缀，
       AxeBuilder.analyze() 会直接抛 "Please use browser.newContext()"）。 */
    const context = await browser.newContext({ viewport: { width: WIDTHS[0] ?? 1366, height: 800 } })
    const page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`        (page console error) ${msg.text().slice(0, 160)}`)
    })
    for (const theme of THEMES) {
      for (const width of WIDTHS) {
        const r = await scanCombo(page, AxeBuilder, width, theme)
        combos.push(r)
        console.log(
          `[${r.theme}@${r.width}] critical=${r.byImpact.critical} serious=${r.byImpact.serious} ` +
          `moderate=${r.byImpact.moderate} minor=${r.byImpact.minor}`,
        )
      }
    }
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  /* 全部违规明细（去重：同一 rule 只列一次，附节点计数） */
  const seen = new Map()
  for (const c of combos) {
    for (const v of c.violations) {
      const key = `${c.theme}@${c.width}:${v.id}`
      seen.set(key, {
        combo: `${c.theme}@${c.width}`,
        id: v.id,
        impact: v.impact ?? 'minor',
        nodes: v.nodes.length,
        help: v.help,
        helpUrl: v.helpUrl,
        targets: [...new Set(v.nodes.flatMap((n) => n.target.map(String)))].slice(0, 5),
      })
    }
  }
  if (seen.size) {
    console.log('\n── violations 明细 ──')
    for (const v of seen.values()) {
      console.log(`${v.combo} [${v.impact}] ${v.id} ×${v.nodes} — ${v.help}`)
      console.log(`    targets: ${v.targets.join(', ')}`)
      console.log(`    ${v.helpUrl}`)
    }
  }

  const bad = combos.filter((c) => c.byImpact.critical > 0 || c.byImpact.serious > 0)
  console.log(`\n── 结果：${combos.length - bad.length}/${combos.length} 组合过门槛（critical=0 && serious=0）──`)
  if (bad.length) {
    console.error(`未达标组合：${bad.map((c) => `${c.theme}@${c.width}`).join(', ')}（修页面，不得放宽门槛）`)
    process.exit(1)
  }
  console.log('全绿。')
}

main().catch((err) => {
  console.error('verify-a11y.mjs 异常：', err)
  process.exit(1)
})
