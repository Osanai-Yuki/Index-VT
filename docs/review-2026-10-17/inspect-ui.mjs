// Read-only application review: mock browser sessions, screenshots, reproducible observations.
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const out = fileURLToPath(new URL('./', import.meta.url))
const base = 'http://127.0.0.1:5175'
const server = spawn(process.execPath, [root + 'frontend/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: root + 'frontend', stdio: 'ignore', windowsHide: true })
let browser
const findings = {}
try {
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(base)).ok) break } catch {}
    if (n === 59) throw new Error('Vite unavailable')
    await new Promise(r => setTimeout(r, 250))
  }
  browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  await page.goto(base + '/?mock&page=doc')
  await page.getByRole('button', { name: '导入文档', exact: true }).first().click()
  await page.evaluate(() => {
    window.__reviewStarts = 0
    const original = window.go.main.App
    window.go.main.App = new Proxy(original, { get(target, key) {
      const value = target[key]
      return key === 'DocTranslate' ? (...args) => { window.__reviewStarts++; return value(...args) } : value
    } })
  })
  await page.getByRole('button', { name: '开始翻译', exact: true }).click()
  await page.getByRole('button', { name: '导出译文', exact: true }).waitFor()
  findings.docAfterDone = {
    startVisible: await page.getByRole('button', { name: '开始翻译', exact: true }).isVisible(),
    continueCount: await page.getByRole('button', { name: '继续翻译', exact: true }).count(),
    rerunCount: await page.getByRole('button', { name: '重新翻译', exact: true }).count(),
  }
  await page.screenshot({ path: out + 'doc-after-done.png' })
  await page.getByRole('button', { name: '开始翻译', exact: true }).click()
  findings.docAfterSecondClick = { starts: await page.evaluate(() => window.__reviewStarts) }
  await page.goto(base + '/?mock&page=subtitle')
  await page.getByRole('button', { name: '导入字幕', exact: true }).first().click()
  await page.screenshot({ path: out + 'subtitle-loaded.png' })
  await page.evaluate(() => window.runtime.EventsEmit('subtitle:cue', { docId: 'a-different-document', cueIndex: 1, state: 'done', translated: 'REVIEW_WRONG_DOCUMENT' }))
  findings.subtitleForeignEventVisible = await page.getByText('REVIEW_WRONG_DOCUMENT', { exact: true }).count() > 0
  await page.screenshot({ path: out + 'subtitle-foreign-event.png' })
  await page.getByRole('button', { name: '模型中心', exact: true }).click()
  await page.getByRole('button', { name: '字幕工作台', exact: true }).click()
  findings.subtitleLostOnNavigation = await page.getByText('导入字幕文件开始翻译', { exact: true }).isVisible()
  for (const [width, theme] of [[1180, 'light'], [1680, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(base + '/?mock&page=translate')
    await page.evaluate(async theme => {
      const { applyTheme } = await import('/src/theme/theme.ts')
      applyTheme(theme)
      await document.fonts.ready
    }, theme)
    await page.waitForTimeout(300) // wait for the application's opacity entrance animation
    await page.screenshot({ path: out + `translate-${width}-${theme}.png` })
    findings[`translate-${width}-${theme}`] = await page.evaluate(() => {
      const texts = ['重新翻译', '复制原文与译文']
      return [...document.querySelectorAll('button')].filter(el => texts.includes(el.textContent.trim())).map(el => {
        const r = el.getBoundingClientRect()
        return { text: el.textContent.trim(), x: r.x, right: r.right, viewport: innerWidth, clipped: r.right > innerWidth }
      })
    })
  }
  await writeFile(out + 'browser-findings.json', JSON.stringify(findings, null, 2) + '\n')
  console.log(JSON.stringify(findings, null, 2))
} finally {
  await browser?.close()
  server.kill()
}
