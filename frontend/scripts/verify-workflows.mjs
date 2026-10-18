// User-facing task, editing, export and glossary flows against independent bridge fixtures.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const base = 'http://127.0.0.1:5181'
const server = spawn(process.execPath, [frontend + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5181', '--strictPort'], { cwd: frontend, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
server.stdout.on('data', d => { output += d }); server.stderr.on('data', d => { output += d })
const results = []
const count = (page, key) => page.evaluate(key => window.__flow.calls.filter(c => c.key === key).length, key)
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const nav = (page, name) => page.getByRole('button', { name, exact: true }).click()

async function install(page) {
  await page.goto(base + '/?mock&page=doc')
  await page.getByRole('button', { name: '导入文档', exact: true }).first().waitFor()
  await page.evaluate(() => {
    const clone = v => structuredClone(v)
    const makeDoc = id => ({ id, path: `C:\\tests\\${id}.txt`, direction: 'zh-en', charsTotal: 8, queueActive: false, chunks: [{ index: 1, text: `${id} 原文一`, translated: `${id} done one`, state: 'done' }, { index: 2, text: `${id} 原文二`, translated: '', state: 'pending' }] })
    const sub = { id: 'sub-A', path: 'C:\\tests\\A.srt', format: 'srt', encoding: 'utf-8', queueActive: false, canUndo: false, canRedo: false, cues: [1, 2].map(index => ({ index, startMs: (index - 1) * 2000, endMs: index * 2000, original: `Original ${index}`, translated: `Translation ${index}`, state: 'done' })) }
    const state = window.__flow = { calls: [], docs: { A: makeDoc('A'), B: makeDoc('B') }, next: 'A', sub, originalSub: clone(sub), savePath: '', holds: {}, held: {}, early: false, confirmExit: false }
    state.finish = id => {
      const doc = state.docs[id]; doc.queueActive = false; doc.chunks.forEach(c => { c.state = 'done'; c.translated = `${id} done ${c.index}` })
      window.runtime.EventsEmit('doc:done', { docId: id })
    }
    const respond = (key, value) => state.holds[key] ? new Promise(resolve => { state.holds[key] = false; state.held[key] = () => resolve(clone(value)) }) : Promise.resolve(clone(value))
    const handlers = {
      DocPick: () => ({ path: state.docs[state.next].path, chars: 8 }),
      DocTranslate: () => { const doc = state.docs[state.next]; doc.queueActive = true; return respond('DocTranslate', doc.id) },
      DocGetDoc: id => respond('DocGetDoc', state.docs[id]),
      DocResume: id => { state.docs[id].queueActive = true },
      DocRestart: id => { const d = state.docs[id]; d.queueActive = true; d.chunks.forEach(c => { c.state = 'pending'; c.translated = '' }) },
      DocCancel: id => { state.docs[id].queueActive = false; window.runtime.EventsEmit('doc:done', { docId: id, canceled: true }) },
      DocExport: () => state.savePath,
      SubOpen: () => clone(state.sub), SubGetDoc: () => clone(state.sub), SubStyles: () => [],
      SubUpdateCue: (id, index, patch) => { Object.assign(state.sub.cues[index - 1], patch); state.sub.canUndo = true; return clone(state.sub) },
      SubShiftCue: async (id, index, field, delta) => { await respond('SubShiftCue', null); state.sub.cues[index - 1][field] += delta; state.sub.canUndo = true; return clone(state.sub) },
      SubDeleteCues: () => { state.sub.cues.shift(); state.sub.canUndo = true; return clone(state.sub) },
      SubUndo: (id, redo) => { state.sub = clone(state.originalSub); state.sub.canRedo = !redo; state.sub.canUndo = !!redo; return clone(state.sub) },
      SubExport: () => state.savePath,
      Translate: () => {
        if (state.early) {
          window.runtime.EventsEmit('translate:delta', { taskId: 't-A', text: 'early ' })
          window.runtime.EventsEmit('translate:done', { taskId: 't-A', output: 'early complete output' })
        }
        return respond('Translate', { taskId: 't-A' })
      },
      CancelTask: () => undefined, ConfirmExit: () => respond('ConfirmExit', state.confirmExit),
      PrepareExit: () => state.failPrepareExit ? Promise.reject(new Error('release failed')) : undefined,
      Quit: () => state.failQuit ? Promise.reject(new Error('quit failed')) : undefined,
    }
    const original = window.go.main.App
    window.go.main.App = new Proxy(original, { get(target, key) { return (...args) => { state.calls.push({ key, args }); return Promise.resolve(handlers[key] ? handlers[key](...args) : target[key](...args)) } } })
  })
}

async function startDoc(page) {
  await page.getByRole('button', { name: '导入文档', exact: true }).first().click()
  await page.getByRole('button', { name: '开始翻译', exact: true }).click()
  await page.getByLabel('译文段落', { exact: true }).first().waitFor()
}
async function openSub(page) {
  await nav(page, '字幕工作台')
  await page.getByRole('button', { name: '导入字幕', exact: true }).first().click()
  await page.getByRole('grid', { name: '字幕条目列表' }).getByRole('row').nth(1).click()
}

const tests = [
  ['document prevents duplicate submission and leaves pending state after start', async page => {
    await page.evaluate(() => { window.__flow.holds.DocTranslate = true })
    await page.getByRole('button', { name: '导入文档', exact: true }).first().click()
    await page.getByRole('button', { name: '开始翻译', exact: true }).dblclick()
    assert.equal(await count(page, 'DocTranslate'), 1)
    assert.equal(await page.getByRole('button', { name: '正在开始…', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.__flow.held.DocTranslate())
    await page.getByRole('button', { name: '翻译中…', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '开始翻译', exact: true }).count(), 0)
    await page.evaluate(() => window.__flow.finish('A'))
    await page.getByRole('button', { name: '重新翻译', exact: true }).waitFor()
    assert.equal(await count(page, 'DocTranslate'), 1)
  }],
  ['cancel/continue reuses document and preserves completed chunk', async page => {
    await startDoc(page)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '继续翻译', exact: true }).click()
    assert.equal(await count(page, 'DocResume'), 1)
    assert.equal(await count(page, 'DocTranslate'), 1)
    assert.match(await page.getByLabel('译文段落', { exact: true }).first().textContent(), /A done one/)
    assert.equal(await page.getByRole('radiogroup', { name: '翻译方向' }).getByRole('radio').first().isDisabled(), true)
  }],
  ['full retranslation requires confirmation and calls restart instead of resume', async page => {
    await startDoc(page); await page.evaluate(() => window.__flow.finish('A'))
    await page.getByRole('button', { name: '重新翻译', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await count(page, 'DocRestart'), 0)
    await page.getByRole('button', { name: '重新翻译', exact: true }).click()
    await page.getByRole('button', { name: '确认重新翻译', exact: true }).click()
    assert.equal(await count(page, 'DocRestart'), 1)
    assert.equal(await count(page, 'DocResume'), 0)
    await page.waitForFunction(() => window.__flow.docs.A.chunks.every(c => c.state === 'pending'))
  }],
  ['late document snapshot and foreign events cannot overwrite newly imported document', async page => {
    await startDoc(page); await page.evaluate(() => window.__flow.finish('A'))
    await page.getByRole('button', { name: '重新翻译', exact: true }).waitFor()
    await page.evaluate(() => { window.__flow.holds.DocGetDoc = true; window.runtime.EventsEmit('doc:done', { docId: 'A' }) })
    await page.waitForFunction(() => window.__flow.held.DocGetDoc)
    await page.evaluate(() => { window.__flow.next = 'B' })
    await page.getByRole('button', { name: '导入文档', exact: true }).first().click()
    await page.getByRole('button', { name: '开始翻译', exact: true }).click()
    await page.getByText('B 原文一', { exact: true }).waitFor()
    await page.evaluate(() => { window.__flow.held.DocGetDoc(); window.runtime.EventsEmit('doc:done', { docId: 'A', error: 'FOREIGN ERROR' }) })
    await settle(page)
    assert.equal(await page.getByText('A 原文一', { exact: true }).count(), 0)
    assert.equal(await page.getByText(/FOREIGN ERROR/).count(), 0)
  }],
  ['document state, running progress and scrolling survive navigation', async page => {
    await startDoc(page)
    await nav(page, '模型中心'); await nav(page, '文档翻译')
    await page.getByText('A 原文一', { exact: true }).waitFor()
    await page.getByRole('button', { name: '翻译中…', exact: true }).waitFor()
    assert.equal(await count(page, 'DocTranslate'), 1)
  }],
  ['main translation buffers terminal event before handle and prevents duplicate starts', async page => {
    await nav(page, '主翻译台')
    await page.evaluate(() => { window.__flow.early = true; window.__flow.holds.Translate = true })
    await page.getByPlaceholder('输入要翻译的文本…').fill('测试早到的终态')
    await page.keyboard.press('Control+Enter'); await page.keyboard.press('Control+Enter')
    assert.equal(await count(page, 'Translate'), 1)
    await page.evaluate(() => window.__flow.held.Translate())
    await page.getByLabel('译文文本', { exact: true }).getByText('early complete output', { exact: true }).waitFor()
    await nav(page, '设置'); await page.keyboard.press('Control+Enter'); await nav(page, '主翻译台')
    assert.equal(await count(page, 'Translate'), 1)
    assert.equal(await page.getByPlaceholder('输入要翻译的文本…').inputValue(), '测试早到的终态')
  }],
  ['main cancel waits for backend terminal event and retains partial translation', async page => {
    await nav(page, '主翻译台')
    await page.getByPlaceholder('输入要翻译的文本…').fill('cancel test')
    await page.keyboard.press('Control+Enter')
    await page.waitForFunction(() => window.__flow.calls.some(c => c.key === 'Translate'))
    await page.evaluate(() => window.runtime.EventsEmit('translate:delta', { taskId: 't-A', text: 'PARTIAL TEXT' }))
    await page.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '正在停止…', exact: true }).isDisabled(), true)
    await page.evaluate(() => window.runtime.EventsEmit('translate:done', { taskId: 't-A', canceled: true, output: 'PARTIAL TEXT' }))
    await page.getByLabel('译文文本', { exact: true }).getByText('PARTIAL TEXT', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '正在停止…', exact: true }).count(), 0)
  }],
  ['IME Enter does not commit subtitle draft; normal Enter does', async page => {
    await openSub(page)
    await page.getByRole('button', { name: '编辑译文', exact: true }).click()
    const editor = page.locator('textarea:visible')
    await editor.fill('正在输入中文')
    await editor.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })))
    assert.equal(await count(page, 'SubUpdateCue'), 0)
    assert.equal(await editor.inputValue(), '正在输入中文')
    await editor.press('Enter')
    await page.waitForFunction(() => window.__flow.sub.cues[0].translated === '正在输入中文')
    assert.equal(await count(page, 'SubUpdateCue'), 1)
  }],
  ['rapid time steps are queued and all increments reach backend', async page => {
    await openSub(page)
    await page.evaluate(() => { window.__flow.holds.SubShiftCue = true })
    const plus = page.getByRole('button', { name: '+100', exact: true }).last()
    await plus.click(); await plus.click()
    assert.equal(await count(page, 'SubShiftCue'), 1)
    await page.evaluate(() => window.__flow.held.SubShiftCue())
    await page.waitForFunction(() => window.__flow.sub.cues[0].endMs === 2200)
    assert.equal(await count(page, 'SubShiftCue'), 2)
  }],
  ['delete exposes undo and authoritative undo snapshot restores original rows', async page => {
    await openSub(page)
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    await page.getByRole('grid').getByText('Original 1', { exact: true }).waitFor()
    assert.equal(await count(page, 'SubUndo'), 1)
    assert.equal(await page.getByRole('button', { name: '重做', exact: true }).isEnabled(), true)
  }],
  ['subtitle menu supports keyboard, viewport edges and focus return', async page => {
    await openSub(page)
    const grid = page.getByRole('grid', { name: '字幕条目列表' })
    await grid.focus(); await grid.press('Shift+F10')
    await page.getByRole('menu').waitFor()
    await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitem')
    await page.keyboard.press('Escape')
    assert.equal(await grid.evaluate(el => el === document.activeElement), true)
    await grid.getByRole('row').nth(1).dispatchEvent('contextmenu', { clientX: 1178, clientY: 698 })
    const box = await page.getByRole('menu').boundingBox()
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1280 && box.y + box.height <= 800)
  }],
  ['subtitle export distinguishes cancel/success and offers reveal-file action', async page => {
    await openSub(page)
    const exportOnce = async () => { await page.getByRole('button', { name: '导出 / 转换', exact: true }).click(); await page.getByRole('button', { name: '保存字幕', exact: true }).click() }
    await exportOnce(); await settle(page)
    assert.equal(await page.getByText(/已导出：/).count(), 0)
    await page.evaluate(() => { window.__flow.savePath = 'C:\\exports\\saved.srt' })
    await exportOnce()
    await page.getByText(/已导出：C:.*saved.srt/).waitFor()
    await page.getByRole('button', { name: '打开所在文件夹', exact: true }).click()
    assert.equal(await count(page, 'RevealFile'), 1)
  }],
  ['document partial export requires confirmation and explicit partial kind', async page => {
    await startDoc(page); await page.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('button', { name: '导出译文', exact: true }).click()
    assert.equal(await count(page, 'DocExport'), 0)
    await page.getByRole('button', { name: '导出部分结果', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__flow.calls.find(c => c.key === 'DocExport').args[1]), 'translation-partial')
  }],
  ['glossary CSV imports quoted content, previews replacement, saves and can undo', async page => {
    await nav(page, '设置'); await page.getByRole('button', { name: '新建术语本', exact: true }).click()
    await page.getByLabel('术语本名称', { exact: true }).fill('导入测试本')
    await page.locator('input[type=file]').setInputFiles({ name: 'terms.csv', mimeType: 'text/csv', buffer: Buffer.from('term,translation\n"青岩关","Green Rock, Pass"\n王妃,Queen') })
    await page.getByLabel('术语导入策略', { exact: true }).selectOption('replace')
    await page.getByRole('button', { name: '采用导入内容', exact: true }).click()
    await page.getByRole('button', { name: '保存术语本', exact: true }).click()
    await page.getByText('导入测试本', { exact: true }).waitFor()
    assert.equal(await count(page, 'SaveGlossary'), 1)
    await page.getByRole('button', { name: '撤销本次保存', exact: true }).click()
    await page.getByText('导入测试本', { exact: true }).waitFor({ state: 'hidden' })
  }],
  ['glossary parser rejects duplicates, empty cells and malformed quoting', async page => {
    const result = await page.evaluate(async () => {
      const { parseGlossary, validateEntries, glossaryCSV } = await import('/src/lib/glossary.ts')
      const sample = [{ term: 'A,B', translation: 'first\nsecond "quote"' }]
      const roundtrip = JSON.stringify(parseGlossary(glossaryCSV(sample))) === JSON.stringify(sample)
      const invalid = ['term,translation\nA,', 'term,translation\nA,b\na,c', 'term,translation\n"A,b']
      return { roundtrip, rejected: invalid.map(s => { try { validateEntries(parseGlossary(s)); return false } catch { return true } }) }
    })
    assert.equal(result.roundtrip, true); assert.deepEqual(result.rejected, [true, true, true])
  }],
  ['exit can return to workbench without releasing engine', async page => {
    await nav(page, '主翻译台'); await page.getByPlaceholder('输入要翻译的文本…').fill('未保存草稿')
    await page.keyboard.press('Control+q'); await settle(page)
    assert.equal(await count(page, 'ConfirmExit'), 1)
    assert.equal(await count(page, 'PrepareExit'), 0)
    assert.ok(await page.evaluate(() => window.__flow.calls.some(c => c.key === 'NoteWorkspace' && c.args[0] === 'translate' && c.args[1])))
  }],
  ['confirmed exit runs release and quit once despite repeated shortcuts', async page => {
    await nav(page, '主翻译台'); await page.getByPlaceholder('输入要翻译的文本…').fill('已有译文的工作台')
    await page.evaluate(() => { window.__flow.confirmExit = true; window.__flow.holds.ConfirmExit = true })
    await page.keyboard.press('Control+q')
    await page.waitForFunction(() => !!window.__flow.held.ConfirmExit)
    await page.keyboard.press('Control+q'); await settle(page)
    assert.equal(await count(page, 'ConfirmExit'), 1)
    await page.evaluate(() => window.__flow.held.ConfirmExit())
    await page.waitForFunction(() => window.__flow.calls.some(c => c.key === 'Quit'))
    assert.equal(await count(page, 'PrepareExit'), 1)
    assert.equal(await count(page, 'Quit'), 1)
  }],
  ['canceling exit permits another confirmation and release failure still quits', async page => {
    await page.keyboard.press('Control+q'); await settle(page)
    assert.equal(await count(page, 'Quit'), 0)
    await page.evaluate(() => { window.__flow.confirmExit = true; window.__flow.failPrepareExit = true })
    await page.keyboard.press('Control+q')
    await page.waitForFunction(() => window.__flow.calls.some(c => c.key === 'Quit'))
    assert.equal(await count(page, 'ConfirmExit'), 2)
    assert.equal(await count(page, 'Quit'), 1)
  }],
  ['quit failure restores interface with a visible error and allows retry', async page => {
    await page.evaluate(() => { window.__flow.confirmExit = true; window.__flow.failQuit = true })
    await page.keyboard.press('Control+q')
    await page.getByText('退出失败，请重试关闭窗口：Error: quit failed', { exact: true }).waitFor()
    await page.getByRole('navigation', { name: '页面导航' }).waitFor()
    await page.evaluate(() => { window.__flow.failQuit = false })
    await page.keyboard.press('Control+q')
    await page.waitForFunction(() => window.__flow.calls.filter(c => c.key === 'Quit').length === 2)
  }],
  ['all pages expose a main heading and main landmark', async page => {
    for (const name of ['主翻译台', '字幕工作台', '文档翻译', '模型中心', '设置']) {
      await nav(page, name)
      assert.equal(await page.getByRole('heading', { level: 1, name, exact: true }).count(), 1)
      assert.equal(await page.getByRole('main').count(), 1)
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
  for (const channel of ['chrome', 'msedge', undefined]) { try { browser = await chromium.launch(channel ? { channel } : {}); break } catch {} }
  if (!browser) throw new Error('No browser available')
  for (const [name, run] of tests) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(6000)
    try { await install(page); await run(page); results.push({ name, ok: true }); console.log('PASS ' + name) }
    catch (error) { results.push({ name, ok: false, error: error.stack }); console.error(`FAIL ${name}: ${error.stack}`) }
    finally { await page.close() }
  }
  writeFileSync(new URL('../../docs/review-2026-10-17/workflow-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
  console.log(`${results.filter(r => r.ok).length}/${results.length} workflow checks passed`)
  if (results.some(r => !r.ok)) process.exitCode = 1
} finally { await browser?.close(); server.kill(); if (server.exitCode === null) await once(server, 'exit') }
