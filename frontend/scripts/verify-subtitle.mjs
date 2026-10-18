#!/usr/bin/env node
// Exercise the real page with independently controlled documents and delayed bridge responses.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? 5177)
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [frontend + 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: frontend, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
let output = ''
server.stdout.on('data', data => { output += data })
server.stderr.on('data', data => { output += data })
let browser
const results = []

async function openDocument(page, id) {
  await page.evaluate(id => { window.__subTest.next = id }, id)
  await page.getByRole('button', { name: '导入字幕', exact: true }).first().click()
}
const grid = page => page.getByRole('grid', { name: '字幕条目列表' })
const expectDocument = async (page, id) => {
  await page.waitForFunction(id => document.querySelector('main')?.textContent.includes(`${id}.srt`), id)
  assert.equal(await grid(page).getByText(`${id} original 1`, { exact: true }).count(), 1)
}
const defer = (page, method, key) => page.evaluate(({ method, key }) => {
  (window.__subTest.plans[method] ??= []).push(key)
}, { method, key })
const held = (page, key) => page.waitForFunction(key => !!window.__subTest.held[key], key)
const release = (page, key) => page.evaluate(key => window.__subTest.release(key), key)
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function install(page) {
  await page.goto(base + '/?mock&page=subtitle')
  await page.getByRole('button', { name: '导入字幕', exact: true }).first().waitFor()
  await page.evaluate(() => {
    const clone = value => structuredClone(value)
    const style = id => ({ name: `Style ${id}`, fontName: 'Arial', fontSize: 24, primaryRGB: '#FFFFFF', outlineRGB: '#000000', outline: 2, bold: false, alignment: 2, marginV: 20 })
    const docs = Object.fromEntries(['A', 'B'].map(id => [id, {
      id, path: `C:\\test\\${id}.srt`, format: 'srt', encoding: 'utf-8', queueActive: false,
      cues: Array.from({ length: 80 }, (_, i) => ({ index: i + 1, startMs: i * 3000, endMs: i * 3000 + 2000, original: `${id} original ${i + 1}`, translated: `${id} translation ${i + 1}`, state: 'done' })),
      styles: [style(id)],
    }]))
    const state = { docs, next: 'A', plans: {}, held: {}, calls: [] }
    state.release = key => {
      const response = state.held[key]
      delete state.held[key]
      response.resolve(response.value)
    }
    const respond = (method, args, value) => {
      state.calls.push({ method, args })
      const key = state.plans[method]?.shift()
      return key ? new Promise(resolve => { state.held[key] = { value: clone(value), resolve } }) : Promise.resolve(clone(value))
    }
    const handlers = {
      SubOpen: () => respond('SubOpen', [], docs[state.next]),
      SubGetDoc: id => respond('SubGetDoc', [id], docs[id]),
      SubStyles: id => respond('SubStyles', [id], docs[id].styles),
      SubTranslate: id => respond('SubTranslate', [id], undefined),
      SubPauseQueue: id => respond('SubPauseQueue', [id], undefined),
      SubResumeQueue: id => respond('SubResumeQueue', [id], undefined),
      SubCancelQueue: id => respond('SubCancelQueue', [id], undefined),
      SubUpdateCue: (id, index, patch) => {
        Object.assign(docs[id].cues.find(cue => cue.index === index), patch)
        return respond('SubUpdateCue', [id, index, patch], docs[id])
      },
      SubDeleteCues: (id, indices) => {
        docs[id].cues = docs[id].cues.filter(cue => !indices.includes(cue.index))
        return respond('SubDeleteCues', [id, indices], docs[id])
      },
    }
    const original = window.go.main.App
    window.go.main.App = new Proxy(original, { get: (target, key) => handlers[key] ?? target[key] })
    window.__subTest = state
  })
}

const tests = [
  ['foreign and missing document IDs are ignored; current events still update', async page => {
    await openDocument(page, 'B')
    await page.evaluate(() => {
      for (const docId of ['A', undefined]) window.runtime.EventsEmit('subtitle:cue', { docId, cueIndex: 1, state: 'done', translated: 'FOREIGN' })
    })
    await settle(page)
    assert.equal(await grid(page).getByText('FOREIGN', { exact: true }).count(), 0)
    await page.waitForTimeout(1100)
    assert.equal(await page.evaluate(() => window.__subTest.calls.filter(c => c.method === 'SubGetDoc').length), 0, 'foreign events must not schedule reconciliation')
    await page.evaluate(() => {
      window.__subTest.docs.B.cues[0].translated = 'CURRENT'
      window.runtime.EventsEmit('subtitle:cue', { docId: 'B', cueIndex: 1, state: 'done', translated: 'CURRENT' })
    })
    await page.waitForFunction(() => document.querySelector('[role=grid]')?.textContent.includes('CURRENT'))
  }],
  ['old document snapshot cannot replace a newly imported document', async page => {
    await page.evaluate(() => { window.__subTest.docs.A.queueActive = true })
    await openDocument(page, 'A')
    await defer(page, 'SubGetDoc', 'read-A')
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await held(page, 'read-A')
    await openDocument(page, 'B')
    await release(page, 'read-A')
    await settle(page)
    await expectDocument(page, 'B')
  }],
  ['same-document snapshots arriving out of order keep the latest request', async page => {
    await page.evaluate(() => { window.__subTest.docs.A.queueActive = true })
    await openDocument(page, 'A')
    await defer(page, 'SubGetDoc', 'old-read')
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await held(page, 'old-read')
    await page.evaluate(() => { window.__subTest.docs.A.cues[0].translated = 'NEWEST SNAPSHOT' })
    await page.evaluate(() => window.runtime.EventsEmit('subtitle:cue', { docId: 'A', cueIndex: 1, state: 'done', translated: 'NEWEST SNAPSHOT' }))
    await page.waitForTimeout(1100)
    await page.waitForFunction(() => document.querySelector('[role=grid]')?.textContent.includes('NEWEST SNAPSHOT'))
    await release(page, 'old-read')
    await settle(page)
    assert.equal(await grid(page).getByText('NEWEST SNAPSHOT', { exact: true }).count(), 1)
  }],
  ['a response with the wrong document ID is rejected', async page => {
    await page.evaluate(() => { window.__subTest.docs.B.queueActive = true })
    await openDocument(page, 'B')
    await defer(page, 'SubGetDoc', 'wrong-id')
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await held(page, 'wrong-id')
    await page.evaluate(() => { window.__subTest.held['wrong-id'].value = structuredClone(window.__subTest.docs.A) })
    await release(page, 'wrong-id')
    await settle(page)
    await expectDocument(page, 'B')
  }],
  ['an in-flight snapshot cannot roll back a newer cue event', async page => {
    await page.evaluate(() => { window.__subTest.docs.A.queueActive = true })
    await openDocument(page, 'A')
    await defer(page, 'SubGetDoc', 'before-event')
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await held(page, 'before-event')
    await page.evaluate(() => {
      window.__subTest.docs.A.cues[0].translated = 'NEWER EVENT'
      window.runtime.EventsEmit('subtitle:cue', { docId: 'A', cueIndex: 1, state: 'done', translated: 'NEWER EVENT' })
    })
    await release(page, 'before-event')
    await settle(page)
    assert.equal(await grid(page).getByText('NEWER EVENT', { exact: true }).count(), 1)
    await page.waitForTimeout(1100)
    assert.equal(await grid(page).getByText('NEWER EVENT', { exact: true }).count(), 1)
  }],
  ['late delete response cannot replace B or clear B selection', async page => {
    await page.evaluate(() => { window.__subTest.docs.A.queueActive = false })
    await openDocument(page, 'A')
    await grid(page).getByText('A original 1', { exact: true }).click()
    await defer(page, 'SubDeleteCues', 'delete-A')
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await held(page, 'delete-A')
    await openDocument(page, 'B')
    await grid(page).getByText('B original 1', { exact: true }).click()
    await release(page, 'delete-A')
    await settle(page)
    await expectDocument(page, 'B')
    assert.equal(await page.getByRole('button', { name: '编辑原文', exact: true }).count(), 1)
  }],
  ['late style list cannot replace the current document styles', async page => {
    await page.evaluate(() => { for (const doc of Object.values(window.__subTest.docs)) doc.queueActive = false })
    await defer(page, 'SubStyles', 'styles-A')
    await openDocument(page, 'A')
    await held(page, 'styles-A')
    await openDocument(page, 'B')
    await release(page, 'styles-A')
    await settle(page)
    await page.getByRole('button', { name: '样式', exact: true }).click()
    assert.equal(await page.getByText('Style B', { exact: true }).count(), 1)
    assert.equal(await page.getByText('Style A', { exact: true }).count(), 0)
  }],
  ['editing the current document still commits and refreshes its cue', async page => {
    await page.evaluate(() => { window.__subTest.docs.B.queueActive = false })
    await openDocument(page, 'B')
    await grid(page).getByText('B original 1', { exact: true }).click()
    await page.getByRole('button', { name: '编辑译文', exact: true }).click()
    await page.locator('textarea:visible').fill('EDITED CURRENT CUE')
    await page.locator('textarea:visible').press('Enter')
    await page.waitForFunction(() => document.querySelector('[role=grid]')?.textContent.includes('EDITED CURRENT CUE'))
    assert.equal(await page.evaluate(() => window.__subTest.docs.B.cues[0].translated), 'EDITED CURRENT CUE')
  }],
  ['late import result cannot replace a newer import', async page => {
    await defer(page, 'SubOpen', 'import-A')
    await openDocument(page, 'A')
    await held(page, 'import-A')
    await openDocument(page, 'B')
    await release(page, 'import-A')
    await settle(page)
    await expectDocument(page, 'B')
  }],
  ['switching pages preserves document, selection, draft and scrolling', async page => {
    await openDocument(page, 'B')
    await grid(page).getByText('B original 1', { exact: true }).click()
    await page.getByRole('button', { name: '编辑原文', exact: true }).click()
    await page.locator('textarea:visible').fill('UNSAVED DRAFT')
    const scrollTop = await grid(page).evaluate(el => { el.scrollTop = 560; el.dispatchEvent(new Event('scroll', { bubbles: true })); return el.scrollTop })
    await page.getByRole('button', { name: '模型中心', exact: true }).click()
    await page.evaluate(() => {
      window.__subTest.docs.B.cues[19].translated = 'BACKGROUND RESULT'
      window.runtime.EventsEmit('subtitle:cue', { docId: 'B', cueIndex: 20, state: 'done', translated: 'BACKGROUND RESULT' })
    })
    await page.getByRole('button', { name: '字幕工作台', exact: true }).click()
    assert.equal(await page.getByText('导入字幕文件开始翻译', { exact: true }).count(), 0)
    assert.equal(await page.locator('textarea:visible').inputValue(), 'UNSAVED DRAFT')
    assert.equal(await grid(page).evaluate(el => el.scrollTop), scrollTop)
    await grid(page).evaluate(el => { el.scrollTop = 19 * 56; el.dispatchEvent(new Event('scroll', { bubbles: true })) })
    await page.waitForFunction(() => document.querySelector('[role=grid]')?.textContent.includes('BACKGROUND RESULT'))
  }],
  ['late queue action refreshes neither the new document nor the old one', async page => {
    await page.evaluate(() => { window.__subTest.docs.A.queueActive = true })
    await openDocument(page, 'A')
    await defer(page, 'SubPauseQueue', 'pause-A')
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await held(page, 'pause-A')
    await openDocument(page, 'B')
    await release(page, 'pause-A')
    await settle(page)
    assert.equal(await page.evaluate(() => window.__subTest.calls.filter(c => c.method === 'SubGetDoc').length), 0)
    await expectDocument(page, 'B')
  }],
  ['inactive subtitle page does not leave a modal over another page', async page => {
    await page.evaluate(() => { window.__subTest.docs.B.queueActive = false })
    await openDocument(page, 'B')
    await page.getByRole('button', { name: '平移', exact: true }).click()
    await page.getByRole('dialog', { name: '整体平移', exact: true }).waitFor()
    await page.evaluate(async () => {
      const { useAppStore } = await import('/src/stores/appStore.ts')
      useAppStore.getState().setPage('model')
    })
    await settle(page)
    assert.equal(await page.getByRole('dialog').count(), 0)
    await page.getByRole('button', { name: '字幕工作台', exact: true }).click()
    await page.getByRole('dialog', { name: '整体平移', exact: true }).waitFor()
    await page.getByRole('button', { name: '取消', exact: true }).last().click()
    await expectDocument(page, 'B')
  }],
]

try {
  for (let n = 0; ; n++) {
    if (server.exitCode !== null) throw new Error(`Vite exited: ${output}`)
    try { if ((await fetch(base, { signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    if (n >= 40) throw new Error(`Vite unavailable: ${output}`)
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  let lastError
  for (const channel of ['chrome', 'msedge', undefined]) {
    try { browser = await chromium.launch(channel ? { channel } : {}); break } catch (error) { lastError = error }
  }
  if (!browser) throw lastError
  for (const [name, run] of tests) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    page.setDefaultTimeout(5000)
    try {
      await install(page)
      await run(page)
      results.push({ name, ok: true })
      console.log(`PASS ${name}`)
    } catch (error) {
      results.push({ name, ok: false })
      console.error(`FAIL ${name}: ${error.message}`)
    } finally { await page.close() }
  }
  console.log(`${results.filter(r => r.ok).length}/${results.length} subtitle checks passed`)
  if (results.some(r => !r.ok)) process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
  if (server.exitCode === null) await once(server, 'exit')
}
