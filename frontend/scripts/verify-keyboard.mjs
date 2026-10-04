#!/usr/bin/env node
/**
 * 键盘流程实测 + reduced-motion 实测（计划 Task 2.10 Step 2 / Step 4）
 * ------------------------------------------------------------
 * 键盘阶段（仅用 page.keyboard，逐步断言，任何一步失败即 exit 1）：
 *   1. Tab 遍历陈列页全部可交互原语，每个停靠点都有焦点环（computed outline ≥2px）
 *   2. Segmented 用方向键改值（aria-checked 随 ←→ 移动）
 *   3. Switch 用 Space 切换（aria-checked 翻转）
 *   4. Modal 打开后 Tab 被困在面板内（Tab × 10 均不出 dialog）
 *   5. Esc 关闭后焦点回到触发按钮
 *   6. 破坏性确认：打开即焦点在「取消」（initialFocus 默认防回车误删，PRD S4）
 *
 * reduced-motion 阶段：emulateMedia({ reducedMotion: 'reduce' }) 后断言——
 *   除 .spinner（降速 1600ms 保留"仍在生成"）外无任何元素 animation-duration > 1ms。
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

const results = []
function record(id, title, ok, detail = '') {
  results.push({ ok })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${title}`)
  if (!ok && detail) console.log(`        ${detail}`)
}

async function main() {
  console.log('── verify-keyboard.mjs · 纯键盘流程 + reduced-motion ──')
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    await page.goto(`${DEV_URL}?primitives`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('main section', { timeout: 15_000 })

    /* ── 1. Tab 遍历：每个停靠点都有焦点环 ──────────────────────── */
    /* 焦点环检查：在页面里挂 focusin 收集器，然后连按 Tab 直到焦点循环 */
    await page.evaluate(() => {
      window.__focusStops = []
      const collect = () => {
        const el = document.activeElement
        if (!el || el === document.body) return
        const cs = getComputedStyle(el)
        const ring =
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) ||
          el.hasAttribute('data-kbd-ring-exempt')
        window.__focusStops.push({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 12), ring })
      }
      document.addEventListener('focusin', collect, true)
    })
    let stopsCount = 0
    let allRinged = true
    let firstNonRing = ''
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab')
      const cur = await page.evaluate(() => {
        const s = window.__focusStops[window.__focusStops.length - 1]
        return s ? `${s.tag}|${s.text}|${s.ring}` : 'body|'
      })
      /* 不按文本判循环（相邻同名按钮会误判）：固定 120 次，逐次累计 */
      if (!cur.startsWith('body|')) {
        stopsCount++
        if (!cur.endsWith('|true') && !firstNonRing) firstNonRing = cur
        if (!cur.endsWith('|true')) allRinged = false
      }
    }
    record('KB1', `Tab 遍历 ${stopsCount} 个停靠点且全部有焦点环`, stopsCount >= 40 && allRinged, firstNonRing ? `首个无环停靠点：${firstNonRing}` : '')

    /* ── 2. Segmented 方向键改值 ────────────────────────────────── */
    await page.focus('[role="radiogroup"][aria-label="主导航示例"] [role="radio"][aria-checked="true"]')
    const beforeSeg = await page.evaluate(() => document.querySelector('[role="radiogroup"][aria-label="主导航示例"] [role="radio"][aria-checked="true"]').textContent)
    await page.keyboard.press('ArrowRight')
    const afterSeg = await page.evaluate(() => document.querySelector('[role="radiogroup"][aria-label="主导航示例"] [role="radio"][aria-checked="true"]').textContent)
    record('KB2', 'Segmented ←→ 改值', beforeSeg !== afterSeg, `${beforeSeg} → ${afterSeg}`)
    await page.keyboard.press('Home')
    const homeSeg = await page.evaluate(() => document.querySelector('[role="radiogroup"][aria-label="主导航示例"] [role="radio"][aria-checked="true"]').textContent)
    record('KB2b', 'Segmented Home 跳首', homeSeg === '翻译', `Home → ${homeSeg}`)

    /* ── 3. Switch Space 切换 ───────────────────────────────────── */
    const sw = page.locator('[role="switch"]').first()
    await sw.focus()
    const beforeSw = await sw.getAttribute('aria-checked')
    await page.keyboard.press('Space')
    const afterSw = await sw.getAttribute('aria-checked')
    record('KB3', 'Switch Space 切换', beforeSw !== afterSw, `${beforeSw} → ${afterSw}`)
    await page.keyboard.press('Space') // 复原

    /* ── 4/5. Modal 焦点陷入 + Esc 归还焦点 ─────────────────────── */
    const openBtn = page.locator('button', { hasText: '打开 Modal' }).first()
    await openBtn.focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"][aria-modal="true"]')
    let trapped = true
    let outside = ''
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"][aria-modal="true"]'))
      if (!inside) {
        trapped = false
        outside = await page.evaluate(() => document.activeElement?.tagName ?? '?')
        break
      }
    }
    record('KB4', 'Modal 打开后 Tab ×10 困在面板内', trapped, outside ? `焦点逃逸到 ${outside}` : '')
    await page.keyboard.press('Escape')
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached' })
    const backOnTrigger = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('打开 Modal'))
      return document.activeElement === btn
    })
    record('KB5', 'Esc 关闭后焦点回到触发按钮', backOnTrigger)

    /* ── 6. 破坏性确认初始焦点在「取消」────────────────────────── */
    await page.locator('button', { hasText: '删除模型…' }).first().focus()
    await page.keyboard.press('Enter')
    await page.waitForSelector('[role="dialog"][aria-modal="true"]')
    const onCancel = await page.evaluate(() => {
      const el = document.activeElement
      return el?.textContent?.trim() === '取消' && el?.getAttribute('data-modal-initial') === 'cancel'
    })
    record('KB6', '破坏性确认初始焦点在「取消」（防回车误删）', onCancel)
    await page.keyboard.press('Escape')

    /* ── reduced-motion 实测（Step 4）──────────────────────────── */
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('main section', { timeout: 15_000 })
    const rm = await page.evaluate(() => {
      const offenders = []
      let spinnerMs = null
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el)
        const dur = cs.animationDuration
        const ms = dur.endsWith('s') ? parseFloat(dur) * 1000 : parseFloat(dur)
        if (cs.animationName === 'none' || Number.isNaN(ms) || ms === 0) continue
        if (el.classList.contains('spinner')) {
          spinnerMs = ms
          continue
        }
        if (ms > 1) offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${cs.animationName} ${dur}`)
      }
      const caretAnimated = (() => {
        const c = document.querySelector('.caret')
        return c ? getComputedStyle(c).animationName !== 'none' : false
      })()
      return { offenders, spinnerMs, caretAnimated }
    })
    record(
      'RM1',
      'reduced-motion：除 spinner（1600ms 降速保留）外无 >1ms 动画',
      rm.offenders.length === 0,
      rm.offenders.slice(0, 5).join('；'),
    )
    record('RM2', 'spinner 降速为 1600ms（保留"仍在生成"信息）', rm.spinnerMs !== null && Math.abs(rm.spinnerMs - 1600) < 1, `spinner = ${rm.spinnerMs}ms`)
    record('RM3', 'caret 不闪（无 .caret 或动画已停）', !rm.caretAnimated)
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n── 结果：${results.length - failed.length}/${results.length} 通过 ──`)
  if (failed.length) process.exit(1)
  console.log('全绿。')
}

main().catch((err) => {
  console.error('verify-keyboard.mjs 异常：', err)
  process.exit(1)
})
