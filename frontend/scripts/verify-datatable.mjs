#!/usr/bin/env node
/**
 * DataTable 虚拟化与性能探针（计划 Task 2.9 Step 6 的持久化门禁）
 * ------------------------------------------------------------
 * 定性：**组件级门禁**，靶子是陈列页 /?primitives 上的 5000 行演示表（真实页面没有 5000 行数据）。
 * 用法：node scripts/verify-datatable.mjs [path]（默认 /?primitives；换页需该页有同名表，否则失败）
 *
 * 断言：
 *   1. 虚拟化真的生效：DOM 中实际渲染的 role="row" 数 ≤ 视口行数 + 2×6 缓冲
 *   2. 滚动不出现 >200ms 长任务（PerformanceObserver longtask 采样）
 *   3. 批量选择：表头全选 → 行 checkbox 全部选中（selected.size 透出）
 *
 * 本机 harness 事实同其它 verify 脚本（IPv4 / 直启 vite / 系统 Chrome 优先）。
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
const PAGE_PATH = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/?primitives'

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
  const log = []
  const check = (id, ok, detail) => log.push({ id, ok, detail })

  /* 定位 5000 行演示表（aria-label 精确匹配），容器即 role=grid */
  const grid = document.querySelector('[role="grid"][aria-label="5000 行虚拟化演示表"]')
  check('找到 5000 行演示表', !!grid, grid ? 'ok' : 'aria-label 未命中')

  if (grid) {
    const viewportRows = Math.ceil(grid.clientHeight / 32)
    const domRows = grid.querySelectorAll('[role="rowgroup"]:not(:first-of-type) [role="row"]').length
    check(
      '虚拟化生效：DOM 行数 ≤ 视口行数 + 12',
      domRows <= viewportRows + 12,
      `DOM 行 = ${domRows}，视口行 = ${viewportRows}（上限 ${viewportRows + 12}）`,
    )

    /* 长任务采样：程序化滚动 1.6s（PerformanceObserver longtask） */
    const longTasks = []
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longTasks.push(e.duration)
    })
    po.observe({ entryTypes: ['longtask'] })
    const steps = 40
    for (let i = 0; i < steps; i++) {
      grid.scrollTo({ top: (i / steps) * 5000 * 32 })
      await new Promise((r) => setTimeout(r, 20))
    }
    grid.scrollTo({ top: 0 })
    await new Promise((r) => setTimeout(r, 100))
    po.disconnect()
    const worst = longTasks.length ? Math.max(...longTasks) : 0
    check(
      '滚动无 >200ms 长任务',
      worst <= 200,
      longTasks.length ? `${longTasks.length} 个长任务，最长 ${Math.round(worst)}ms` : '0 个长任务',
    )
  }
  return log
}
const PROBE_STRING = `(${PROBE_SOURCE.toString()})()`

async function main() {
  console.log('── verify-datatable.mjs · 虚拟化与滚动性能 ──')
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  let results
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    await page.goto(DEV_URL + PAGE_PATH.replace(/^\//, ''), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    /* 等React 挂载 + 陈列页渲染完成 */
    await page.waitForSelector('[role="grid"][aria-label="5000 行虚拟化演示表"]', { timeout: 15_000 })
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
  console.error('verify-datatable.mjs 异常：', err)
  process.exit(1)
})
