// Real DOM drag/copy and activity handling; bridge responses are independently controlled.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const base = 'http://127.0.0.1:5178'
const server = spawn(process.execPath, [frontend + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { cwd: frontend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
server.stdout.on('data', d => { output += d })
server.stderr.on('data', d => { output += d })
const results = []
const reportDir = fileURLToPath(new URL('../../docs/review-2026-10-17/', import.meta.url))
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const warn = (page, seconds = 30) => page.evaluate(seconds => window.runtime.EventsEmit('orch:event', { kind: 'notice', text: 'idle-warning', extra: { remainingSeconds: seconds } }), seconds)
const warning = page => page.getByRole('complementary', { name: '模型空闲释放提示' })

async function install(page, route = 'translate') {
  await page.addInitScript(() => {
    window.__life = { calls: [], idle: -1 }
    Object.defineProperty(window, 'go', {
      configurable: true,
      get() { return this.__go },
      set(value) {
        const original = value.main.App
        value.main.App = new Proxy(original, { get(target, key) {
          const method = target[key]
          return (...args) => {
            window.__life.calls.push({ key, args })
            if (key === 'WarmDefaultModel' && window.__failWarm) return Promise.reject(new Error('测试：模型文件不存在'))
            if (key === 'KeepAlive') window.__life.idle = -1
            return Promise.resolve(method(...args)).then(result => {
              if (key === 'GetSystemStatus') return { ...result, activeTasks: 0, idleReleaseSeconds: window.__life.idle }
              return result
            })
          }
        } })
        this.__go = value
      }
    })
  })
  await page.goto(base + '/?mock&page=' + route)
  await page.getByRole('button', { name: '模型中心', exact: true }).waitFor()
  await page.waitForFunction(() => window.__life.calls.some(c => c.key === 'WarmDefaultModel'))
}

async function dragCopy(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  assert.equal(await locator.evaluate(el => getComputedStyle(el).userSelect), 'text')
  const points = await locator.evaluate(el => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let text
    while ((text = walker.nextNode())) if (text.textContent.trim().length >= 6) break
    if (!text) throw new Error('no selectable text')
    const point = offset => {
      const range = document.createRange()
      range.setStart(text, offset); range.setEnd(text, offset + 1)
      const box = range.getBoundingClientRect()
      return { x: box.x + 0.5, y: box.y + box.height / 2 }
    }
    return { start: point(0), end: point(6) }
  })
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 })
  await page.mouse.up()
  const selected = await page.evaluate(() => getSelection().toString())
  assert.ok(selected.length > 1, 'mouse drag must select text')
  await page.keyboard.press('Control+c')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selected, 'Ctrl+C must copy only selection')
}

const tests = [
  ['startup preloads once; navigation does not reload; saved context defaults to 8K', async page => {
    assert.equal(await page.evaluate(() => window.__life.calls.filter(c => c.key === 'WarmDefaultModel').length), 1)
    assert.equal(await page.evaluate(async () => (await window.go.main.App.GetConfig()).inference.ctxTier), '8K')
    await page.getByRole('button', { name: '模型中心', exact: true }).click()
    await page.getByRole('button', { name: '主翻译台', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__life.calls.filter(c => c.key === 'WarmDefaultModel').length), 1)
  }],
  ['main translation supports actual mouse selection and Ctrl+C', async page => {
    await page.getByPlaceholder('输入要翻译的文本…').fill('请翻译这段测试文字。')
    await page.keyboard.press('Control+Enter')
    await page.getByRole('button', { name: '复制译文', exact: true }).waitFor({ state: 'visible' })
    await page.waitForTimeout(1800)
    await dragCopy(page, page.getByLabel('译文文本', { exact: true }))
  }],
  ['subtitle list and full detail support actual mouse selection and Ctrl+C', async page => {
    await page.getByRole('button', { name: '字幕工作台', exact: true }).click()
    await page.getByRole('button', { name: '导入字幕', exact: true }).first().click()
    const row = page.getByRole('grid', { name: '字幕条目列表' }).getByRole('row').nth(1)
    await dragCopy(page, row.getByRole('gridcell').nth(3).locator('span').first())
    await page.evaluate(() => getSelection().removeAllRanges())
    await row.click()
    const detail = page.locator('div.select-text').filter({ has: page.getByRole('button', { name: '编辑译文', exact: true }) })
    await dragCopy(page, detail)
  }],
  ['long-document translation supports actual mouse selection and Ctrl+C', async page => {
    await page.getByRole('button', { name: '文档翻译', exact: true }).click()
    await page.getByRole('button', { name: '导入文档', exact: true }).first().click()
    await page.getByRole('button', { name: '开始翻译', exact: true }).click()
    await page.getByLabel('译文段落', { exact: true }).first().waitFor()
    await dragCopy(page, page.getByLabel('译文段落', { exact: true }).first())
  }],
  ['warning starts at 30 seconds and updates from backend events', async page => {
    await warn(page)
    await warning(page).waitFor()
    assert.match(await warning(page).textContent(), /30 秒后/)
    assert.match(await page.locator('footer').textContent(), /30 秒后释放/)
    await warn(page, 17)
    assert.match(await warning(page).textContent(), /17 秒后/)
    assert.match(await page.locator('footer').textContent(), /17 秒后释放/)
  }],
  ...['pointermove', 'wheel', 'keydown', 'pointerdown', 'touchmove'].map(event => [`${event} cancels countdown and notifies backend`, async page => {
    await warn(page)
    await warning(page).waitFor()
    const before = await page.evaluate(() => window.__life.calls.filter(c => c.key === 'KeepAlive').length)
    await page.evaluate(event => window.dispatchEvent(new Event(event)), event)
    await settle(page)
    assert.equal(await warning(page).count(), 0)
    assert.ok(await page.evaluate(before => window.__life.calls.filter(c => c.key === 'KeepAlive').length > before, before))
  }]),
  ['activity bridge calls are throttled during continuous pointer movement', async page => {
    const before = await page.evaluate(() => window.__life.calls.filter(c => c.key === 'KeepAlive').length)
    await page.evaluate(() => { for (let i = 0; i < 100; i++) window.dispatchEvent(new Event('pointermove')) })
    await page.waitForTimeout(1100)
    const calls = await page.evaluate(before => window.__life.calls.filter(c => c.key === 'KeepAlive').length - before, before)
    assert.ok(calls >= 1 && calls <= 2, `100 pointer moves produced ${calls} bridge calls`)
  }],
  ['programmatic scroll does not reset inactivity', async page => {
    const before = await page.evaluate(() => window.__life.calls.filter(c => c.key === 'KeepAlive').length)
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
    await settle(page)
    assert.equal(await page.evaluate(() => window.__life.calls.filter(c => c.key === 'KeepAlive').length), before)
  }],
  ['busy/stop events remove warning; current text is retained after release', async page => {
    await page.getByPlaceholder('输入要翻译的文本…').fill('测试资源释放后保留译文。')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(1800)
    const before = await page.getByLabel('译文文本', { exact: true }).innerText()
    assert.ok(before.length > 10)
    await warn(page)
    await page.evaluate(() => window.runtime.EventsEmit('orch:event', { kind: 'notice', text: 'idle-reset' }))
    await settle(page)
    assert.equal(await warning(page).count(), 0)
    await warn(page)
    await page.evaluate(() => window.runtime.EventsEmit('orch:event', { kind: 'state', state: 'idle', reason: 'idle-timeout' }))
    await settle(page)
    assert.equal(await warning(page).count(), 0)
    assert.equal(await page.getByLabel('译文文本', { exact: true }).innerText(), before)
  }],
  ['late status response cannot reopen warning canceled by activity', async page => {
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/stores/appStore.ts')
      const original = window.go.main.App
      window.go.main.App = new Proxy(original, { get: (target, key) => key === 'GetSystemStatus' ? () => new Promise(resolve => { window.__life.release = () => resolve({ orchestration: 'running', idleReleaseSeconds: 20 }) }) : target[key] })
      useAppStore.getState().refreshStatus()
    })
    await page.waitForFunction(() => window.__life.release)
    await page.evaluate(() => { window.dispatchEvent(new Event('keydown')); window.__life.release() })
    await settle(page)
    assert.equal(await warning(page).count(), 0)
  }],
  ['preload failure gives a persistent actionable error', async page => {
    await page.addInitScript(() => { window.__failWarm = true })
    await page.reload()
    await page.getByText(/默认模型加载失败.*请到模型中心检查模型与引擎/).waitFor()
  }],
  ['countdown notice has no accessibility violations in light/dark at minimum width', async page => {
    await page.setViewportSize({ width: 1180, height: 700 })
    mkdirSync(reportDir, { recursive: true })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => (await import('/src/theme/theme.ts')).applyTheme(theme), theme)
      await warn(page)
      await warning(page).waitFor()
      // Theme changes animate button colors for 150ms; inspect the settled theme.
      await page.waitForTimeout(350)
      const result = await new AxeBuilder({ page }).include('[aria-label="模型空闲释放提示"]').analyze()
      assert.deepEqual(result.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })), [])
      const box = await warning(page).boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1180 && box.y + box.height <= 700)
      await page.screenshot({ path: reportDir + `idle-warning-${theme}.png` })
    }
  }],
]

try {
  for (let n = 0; ; n++) {
    if (server.exitCode !== null) throw new Error(output)
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    if (n > 40) throw new Error(output)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  let lastError
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break } catch (error) { lastError = error }
  }
  if (!browser) throw lastError
  for (const [name, run] of tests) {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    page.setDefaultTimeout(6000)
    try { await install(page); await run(page); results.push({ name, ok: true }); console.log('PASS ' + name) }
    catch (error) { results.push({ name, ok: false }); console.error(`FAIL ${name}: ${error.stack}`) }
    finally { await context.close() }
  }
  console.log(`${results.filter(r => r.ok).length}/${results.length} lifecycle checks passed`)
  if (results.some(r => !r.ok)) process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
  if (server.exitCode === null) await once(server, 'exit')
}
