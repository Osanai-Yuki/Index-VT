#!/usr/bin/env node
/**
 * 对比度实测（计划 Task 2.10 Step 1）——不靠 DESIGN.md 的算式，靠真实渲染。
 * ------------------------------------------------------------
 * 遍历陈列页全部文本节点，取 computed color 与**实际有效背景**（沿祖先向上收集
 * background-color，半透明的 *-soft 底自底向上逐层合成到首个不透明底为止），
 * 按 WCAG 相对亮度算对比度，断言全部 ≥4.5:1（text-micro 不豁免），light/dark 各跑一遍。
 *
 * 跳过：不可见元素、disabled/aria-disabled 控件（WCAG 豁免非活动控件，与 axe 行为一致）。
 * 输出：每主题测量数、最低三档实测值。
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
  const child = spawn(process.execPath, [viteBin, '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'], {
    cwd: FRONTEND,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => { output += d.toString() })
  child.stderr.on('data', (d) => { output += d.toString() })
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite dev 提前退出（code ${child.exitCode}）\n${output}`)
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

const PROBE_SOURCE = async () => {
  const parseColor = (c) => {
    const m = c.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\)/)
    if (!m) return null
    let a = m[4] === undefined ? 1 : +m[4]
    if (m[4] && m[4].endsWith('%')) a = parseFloat(m[4]) / 100
    return { r: +m[1], g: +m[2], b: +m[3], a }
  }

  /* 有效背景：沿祖先收集 bg 层，半透明底逐层合成到首个不透明底（body 兜底） */
  const effectiveBg = (el) => {
    const layers = []
    let node = el
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node)
      const bg = parseColor(cs.backgroundColor)
      if (bg && bg.a > 0) {
        layers.push(bg)
        if (bg.a >= 1) break
      }
      node = node.parentElement
    }
    if (!layers.length || layers[layers.length - 1].a < 1) {
      const htmlBg = parseColor(getComputedStyle(document.documentElement).backgroundColor)
      if (htmlBg && htmlBg.a > 0) layers.push(htmlBg)
    }
    if (!layers.length) return null
    let acc = layers[layers.length - 1]
    for (let i = layers.length - 2; i >= 0; i--) {
      const l = layers[i]
      acc = {
        r: l.a * l.r + (1 - l.a) * acc.r,
        g: l.a * l.g + (1 - l.a) * acc.g,
        b: l.a * l.b + (1 - l.a) * acc.b,
        a: 1,
      }
    }
    return acc
  }

  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }

  const results = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim()
    if (!text) continue
    const el = node.parentElement
    if (!el) continue
    if (el.closest('script, style, [aria-hidden="true"], [disabled], [aria-disabled="true"]')) continue
    if (el.getClientRects().length === 0) continue

    const fg = parseColor(getComputedStyle(el).color)
    const bg = effectiveBg(el)
    if (!fg || !bg) continue
    const l1 = lum(fg)
    const l2 = lum(bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    results.push({ ratio, text: text.slice(0, 24), el: `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}` })
  }
  return results
}
const PROBE_STRING = `(${PROBE_SOURCE.toString()})()`

async function main() {
  console.log('── verify-contrast.mjs · 真实渲染对比度（门槛 ≥4.5:1）──')
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  const failures = []
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    for (const theme of ['light', 'dark']) {
      await page.goto(`${DEV_URL}?primitives`, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.evaluate(async ({ mod, t }) => {
        const m = await import(mod)
        m.applyTheme(t)
      }, { mod: THEME_MODULE, t: theme })
      /* 主题过渡（180ms）会污染取色 → reload 后以冷启动态测量 */
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForSelector('main section', { timeout: 15_000 })

      const results = await page.evaluate(PROBE_STRING)
      const sorted = [...results].sort((a, b) => a.ratio - b.ratio)
      const bad = sorted.filter((r) => r.ratio < 4.5)
      console.log(
        `[${theme}] 测量 ${results.length} 个文本节点，最低 3 档：` +
          sorted.slice(0, 3).map((r) => `${r.ratio.toFixed(2)}:1（"${r.text}"）`).join(' / '),
      )
      for (const b of bad) {
        failures.push(`${theme} "${b.text}" @ ${b.el} = ${b.ratio.toFixed(2)}:1`)
      }
    }
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  if (failures.length) {
    console.error(`\n对比度未达标 ${failures.length} 处（修 token/组件，禁止放宽门槛）：`)
    for (const f of failures) console.error(`  ${f}`)
    process.exit(1)
  }
  console.log('\n全绿。')
}

main().catch((err) => {
  console.error('verify-contrast.mjs 异常：', err)
  process.exit(1)
})
