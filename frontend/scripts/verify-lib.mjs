#!/usr/bin/env node
/**
 * 纯函数库边界断言（计划 Task 2.4 Step 3）
 * ------------------------------------------------------------
 * 断言目标覆盖计划指定的全部边界：
 *   format: tcSrt(0)/(3_723_456)/(-1)、tcLrc(65_430)、fmtBytes(0)/(1<<30)/(1.5*(1<<20))、
 *           fmtPct(0,0)/(150,300)/(300,300)、fmtCountdown(0)/(65)/(3600)、clampPct(-5)/(150)
 *   virtualizer: count=5000 rowHeight=32 → 区间 ≈ 视口行数+12；scrollTop=0 → padTop=0；
 *                scrollTop 超尾 → padBottom=0；count=0 → 空区间不抛错
 *
 * 纯 node 无法 import .ts（不引 esbuild/tsx/测试框架）→ 与 verify-wails 同套路：
 * Playwright 打开 dev server 页面，evaluate 里 import 真实模块断言。
 * 本机 harness 事实同前两个脚本（IPv4 / 直启 vite / 系统 Chrome 优先）。
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

const FORMAT_MODULE = '/src/lib/format.ts'
const VIRTUALIZER_MODULE = '/src/lib/virtualizer.ts'

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

/* 页面上下文内执行的断言主体 */
const PROBE_SOURCE = async () => {
  const f = await import('/src/lib/format.ts')
  const v = await import('/src/lib/virtualizer.ts')
  const log = []
  const eq = (id, actual, expected) =>
    log.push({
      id,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
      detail: `actual = ${JSON.stringify(actual)}   expected = ${JSON.stringify(expected)}`,
    })

  /* ── format ── */
  eq('tcSrt(0)', f.tcSrt(0), '00:00:00,000')
  eq('tcSrt(3_723_456)', f.tcSrt(3_723_456), '01:02:03,456')
  eq('tcSrt(-1) 钳 0', f.tcSrt(-1), '00:00:00,000')
  eq('tcLrc(65_430)', f.tcLrc(65_430), '[01:05.43]')
  eq('fmtBytes(0)', f.fmtBytes(0), '0 B')
  eq('fmtBytes(1<<30)', f.fmtBytes(1 << 30), '1.0 GB')
  eq('fmtBytes(1.5*(1<<20))', f.fmtBytes(1.5 * (1 << 20)), '1.5 MB')
  eq('fmtRate(1.5*(1<<20))', f.fmtRate(1.5 * (1 << 20)), '1.5 MB/s')
  eq('fmtPct(0,0) 无 NaN', f.fmtPct(0, 0), '0%')
  eq('fmtPct(150,300)', f.fmtPct(150, 300), '50%')
  eq('fmtPct(300,300)', f.fmtPct(300, 300), '100%')
  eq('fmtCountdown(0)', f.fmtCountdown(0), '0:00')
  eq('fmtCountdown(65)', f.fmtCountdown(65), '1:05')
  eq('fmtCountdown(3600)', f.fmtCountdown(3600), '60:00')
  eq('clampPct(-5)', f.clampPct(-5), 0)
  eq('clampPct(150)', f.clampPct(150), 100)

  /* ── virtualizer（纯函数核 computeWindow）── */
  const ROWS = 5000
  const RH = 32
  const CLIENT_H = 640 // 视口 20 行；overscan 默认 6 → 区间应恰为 20+12 = 32 行
  const mid = v.computeWindow(ROWS, RH, 160 * RH, CLIENT_H)
  eq('区间大小 = 视口行数 + 2×overscan', mid.range.end - mid.range.start, 32)
  eq('区间对齐（start = 160-6）', mid.range.start, 154)

  const top = v.computeWindow(ROWS, RH, 0, CLIENT_H)
  eq('scrollTop=0 → padTop=0', top.padTop, 0)

  const past = v.computeWindow(ROWS, RH, ROWS * RH * 10, CLIENT_H)
  eq('scrollTop 超尾 → padBottom=0', past.padBottom, 0)
  eq('scrollTop 超尾 → end=count', past.range.end, ROWS)

  let threw = false
  try {
    const empty = v.computeWindow(0, RH, 100, CLIENT_H)
    eq('count=0 → 空区间', empty.range, { start: 0, end: 0 })
  } catch {
    threw = true
  }
  log.push({ id: 'count=0 不抛错', ok: !threw, detail: threw ? 'computeWindow(0,…) 抛错' : '未抛错' })

  eq('rowHeight<=0 → 空区间（防除零）', v.computeWindow(10, 0, 0, 640).range, { start: 0, end: 0 })

  return log
}
const PROBE_STRING = `(${PROBE_SOURCE.toString()})()`

async function main() {
  console.log('── verify-lib.mjs · 格式化与虚拟化边界 ──')
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  let results
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    results = await page.evaluate(PROBE_STRING)
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  for (const r of results) {
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id}`)
    if (!r.ok) console.log(`        ${r.detail}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n── 结果：${results.length - failed.length}/${results.length} 通过 ──`)
  if (failed.length) {
    console.error(`失败项：${failed.filter((f) => !f.ok).map((f) => f.id).join(', ')}`)
    process.exit(1)
  }
  console.log('全绿。')
}

main().catch((err) => {
  console.error('verify-lib.mjs 异常：', err)
  process.exit(1)
})
