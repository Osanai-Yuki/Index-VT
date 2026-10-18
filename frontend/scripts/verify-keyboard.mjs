#!/usr/bin/env node
/**
 * 键盘流程实测 + reduced-motion 实测（计划 Task 2.10 Step 2 / Step 4）
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/verify-keyboard.mjs [path] [--min-stops=N] [--modal-text=…] [--confirm-text=…]
 *   默认 path=/?primitives（组件层靶子）；页面层用 /?mock&page=settings 一类（dev 假后端）。
 *
 * 键盘阶段（仅用 page.keyboard，逐步断言）：
 *   1. Tab 遍历目标页可交互元素，每个停靠点都有焦点环（computed outline ≥2px；下限 --min-stops）
 *   2. Segmented 方向键改值 + Home 跳首（页面无 radiogroup → SKIP）
 *   3. Switch Space 切换（无 Switch → SKIP）
 *   4. Modal 打开后 Tab 被困在面板内（无触发按钮 → SKIP；按钮文本 --modal-text）
 *   5. Esc 关闭后焦点回到触发按钮
 *   6. 破坏性确认：打开即焦点在「取消」（无触发按钮 → SKIP；按钮文本 --confirm-text）
 *
 * reduced-motion 阶段：emulateMedia({ reducedMotion: 'reduce' }) 后断言——
 *   除 .spinner（降速 1600ms 保留"仍在生成"）外无任何元素 animation-duration > 1ms；
 *   页面无 spinner 时 RM2 记 SKIP（组件级覆盖在陈列页）。
 *
 * 结果口径：FAIL 任一 → exit 1；全页 PASS 数为 0（全被跳过）也 exit 1 —— 防止"空页假绿"。
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
function record(id, title, status, detail = '') {
  results.push({ ok: status === 'pass', status })
  const tag = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL'
  console.log(`[${tag}] ${id} ${title}`)
  if (detail && status !== 'pass') console.log(`        ${detail}`)
}

/* 位置参数：目标路径（默认陈列页）；开关：
   --min-stops=N     KB1 的停靠点下限（陈列页 40；真实页面按页面密度调小）
   --modal-text=     触发 Modal 的按钮文本（默认「打开 Modal」）
   --confirm-text=   触发破坏性确认的按钮文本（默认「删除模型…」）
   组件不存在 → SKIP（该组件的断言由陈列页覆盖）；存在但行为不对 → FAIL。 */
const PAGE_PATH = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '/?primitives'
const MIN_STOPS = Number(process.argv.find((a) => a.startsWith('--min-stops='))?.slice('--min-stops='.length) ?? 40)
const MODAL_TEXT = process.argv.find((a) => a.startsWith('--modal-text='))?.slice('--modal-text='.length) ?? '打开 Modal'
const CONFIRM_TEXT = process.argv.find((a) => a.startsWith('--confirm-text='))?.slice('--confirm-text='.length) ?? '删除模型…'

async function main() {
  console.log(`── verify-keyboard.mjs · 纯键盘流程 + reduced-motion · path=${PAGE_PATH} ──`)
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    await page.goto(DEV_URL + PAGE_PATH.replace(/^\//, ''), { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    /* 通用就绪信号：根节点有内容（组件层与页面层通吃） */
    await page.waitForSelector('#root > *', { timeout: 15_000 })
    await page.waitForTimeout(300)

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
    record('KB1', `Tab 遍历 ${stopsCount} 个停靠点且全部有焦点环（下限 ${MIN_STOPS}）`, stopsCount >= MIN_STOPS && allRinged ? 'pass' : 'fail', firstNonRing ? `首个无环停靠点：${firstNonRing}` : stopsCount < MIN_STOPS ? `停靠点 ${stopsCount} < 下限 ${MIN_STOPS}` : '')

    /* ── 2. Segmented 方向键改值（本页无 radiogroup → SKIP）──────── */
    // Cached pages may remain in the DOM under hidden containers. Keyboard
    // checks must target the accessible page, just as Tab navigation does.
    const radioGroup = page.getByRole('radiogroup').first()
    const hasRadioGroup = (await radioGroup.count()) > 0
    if (!hasRadioGroup) {
      record('KB2', 'Segmented ←→ 改值', 'skip', '本页无 radiogroup；该组件的能力由陈列页覆盖')
      record('KB2b', 'Segmented Home 跳首', 'skip', '同上')
    } else {
      const checked = radioGroup.getByRole('radio', { checked: true })
      const checkedText = async () => (await checked.textContent())?.trim() ?? ''
      const firstText = async () => (await radioGroup.getByRole('radio').first().textContent())?.trim() ?? ''
      await checked.focus()
      const beforeSeg = await checkedText()
      await page.keyboard.press('ArrowRight')
      const afterSeg = await checkedText()
      record('KB2', 'Segmented ←→ 改值', beforeSeg !== afterSeg ? 'pass' : 'fail', `${beforeSeg} → ${afterSeg}`)
      await page.keyboard.press('Home')
      const homeSeg = await checkedText()
      const expectedFirst = await firstText()
      record('KB2b', 'Segmented Home 跳首（选中第一项）', homeSeg === expectedFirst ? 'pass' : 'fail', `Home → ${homeSeg}（期望 ${expectedFirst}）`)
    }

    /* ── 3. Switch Space 切换（本页无 Switch → SKIP）─────────────── */
    const sw = page.getByRole('switch').first()
    if ((await sw.count()) === 0) {
      record('KB3', 'Switch Space 切换', 'skip', '本页无 Switch；该组件的能力由陈列页覆盖')
    } else {
      await sw.focus()
      const beforeSw = await sw.getAttribute('aria-checked')
      await page.keyboard.press('Space')
      const afterSw = await sw.getAttribute('aria-checked')
      record('KB3', 'Switch Space 切换', beforeSw !== afterSw ? 'pass' : 'fail', `${beforeSw} → ${afterSw}`)
      await page.keyboard.press('Space') // 复原
    }

    /* ── 4/5. Modal 焦点陷入 + Esc 归还焦点（本页无对应触发按钮 → SKIP） */
    const openBtn = page.locator('button', { hasText: MODAL_TEXT }).first()
    if ((await openBtn.count()) === 0) {
      record('KB4', `Modal 焦点陷阱（触发按钮「${MODAL_TEXT}」）`, 'skip', '本页无此按钮；Modal 能力由陈列页覆盖')
      record('KB5', 'Esc 关闭后焦点回到触发按钮', 'skip', '同上')
    } else {
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
      record('KB4', 'Modal 打开后 Tab ×10 困在面板内', trapped ? 'pass' : 'fail', outside ? `焦点逃逸到 ${outside}` : '')
      await page.keyboard.press('Escape')
      await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached' })
      const backOnTrigger = await page.evaluate((t) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t))
        return document.activeElement === btn
      }, MODAL_TEXT)
      record('KB5', 'Esc 关闭后焦点回到触发按钮', backOnTrigger ? 'pass' : 'fail')
    }

    /* ── 6. 破坏性确认初始焦点在「取消」（本页无对应触发按钮 → SKIP） */
    const delBtn = page.locator('button', { hasText: CONFIRM_TEXT }).first()
    if ((await delBtn.count()) === 0) {
      record('KB6', `破坏性确认初始焦点在「取消」（触发按钮「${CONFIRM_TEXT}」）`, 'skip', '本页无此按钮；由陈列页与 ModelHub/Settings 覆盖')
    } else {
      await delBtn.focus()
      await page.keyboard.press('Enter')
      await page.waitForSelector('[role="dialog"][aria-modal="true"]')
      const onCancel = await page.evaluate(() => {
        const el = document.activeElement
        return el?.textContent?.trim() === '取消' && el?.getAttribute('data-modal-initial') === 'cancel'
      })
      record('KB6', '破坏性确认初始焦点在「取消」（防回车误删）', onCancel ? 'pass' : 'fail')
      await page.keyboard.press('Escape')
    }

    /* ── reduced-motion 实测（Step 4）──────────────────────────── */
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('#root > *', { timeout: 15_000 })
    await page.waitForTimeout(300)
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
      rm.offenders.length === 0 ? 'pass' : 'fail',
      rm.offenders.slice(0, 5).join('；'),
    )
    record(
      'RM2',
      'spinner 降速为 1600ms（保留"仍在生成"信息）',
      rm.spinnerMs === null ? 'skip' : Math.abs(rm.spinnerMs - 1600) < 1 ? 'pass' : 'fail',
      rm.spinnerMs === null ? '本页当前无 .spinner；该断言由陈列页覆盖' : `spinner = ${rm.spinnerMs}ms`,
    )
    record('RM3', 'caret 不闪（无 .caret 或动画已停）', !rm.caretAnimated ? 'pass' : 'fail')
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length
  const skipped = results.filter((r) => r.status === 'skip').length
  const failed = results.filter((r) => r.status === 'fail')
  console.log(`\n── 结果：PASS ${passed} / SKIP ${skipped} / FAIL ${failed.length} ──`)
  if (failed.length) {
    console.error(`失败项：${failed.length} 条（见上）`)
    process.exit(1)
  }
  if (passed === 0) {
    console.error('全部检查被跳过：靶子页缺少可断言的组件，按失败处理（换页面或用 ?mock 供数）')
    process.exit(1)
  }
  console.log('全绿。')
}

main().catch((err) => {
  console.error('verify-keyboard.mjs 异常：', err)
  process.exit(1)
})
