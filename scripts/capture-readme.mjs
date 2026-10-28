// Capture the exact production frontend embedded in the current executable.
// All displayed text is public sample data; no user files, inference or telemetry are used.
import { chromium } from '../frontend/node_modules/playwright/index.mjs'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const assets = join(root, 'app/frontenddist')
const executable = join(root, 'app/build/bin/Index-VT.exe')
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) ?? 'docs/assets/screenshots'
const outputPath = resolve(root, output)
if (!outputPath.startsWith(resolve(root) + sep)) throw new Error('Capture output must stay inside the project.')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const executableBytes = readFileSync(executable)
const source = '周六清晨，我们沿着河边的小路走到旧书店。店主把新到的书放在窗边，还给来客准备了热茶。\n\n下午的读书会改到三点开始。请提前十分钟到场，并带上想与大家分享的一段文字。\n\n如果下雨，我们就在二楼的小厅见面；天气晴朗时，活动会移到院子里。'
const translation = 'Early on Saturday morning, we followed the riverside path to the old bookshop. The owner had placed the new arrivals by the window and prepared hot tea for visitors.\n\nThe afternoon reading group will now begin at three. Please arrive ten minutes early and bring a passage you would like to share.\n\nIf it rains, we will meet in the small room upstairs. If the weather is fine, we will move to the courtyard.'
const cuePairs = [
  ['周六清晨，我们沿着河边的小路出发。', 'Early on Saturday morning, we set off along the riverside path.'],
  ['旧书店就在桥的另一边。', 'The old bookshop was just across the bridge.'],
  ['店主把新到的书放在窗边。', 'The owner had placed the new arrivals by the window.'],
  ['他还给来客准备了热茶。', 'He had also prepared hot tea for visitors.'],
  ['下午的读书会改到三点开始。', 'The afternoon reading group will now begin at three.'],
  ['请提前十分钟到场。', 'Please arrive ten minutes early.'],
  ['如果下雨，我们就在二楼见面。', 'If it rains, we will meet upstairs.'],
  ['天气晴朗时，活动会移到院子里。', 'If the weather is fine, we will move to the courtyard.'],
]
const buildAssets = []
for (const name of readdirSync(join(assets, 'assets'))) {
  const bytes = readFileSync(join(assets, 'assets', name))
  if (executableBytes.indexOf(bytes) < 0) throw new Error(`The current executable does not embed ${name}; rebuild first.`)
  buildAssets.push({ file: `assets/${name}`, sha256: sha256(bytes) })
}
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.txt': 'text/plain' }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
  const file = resolve(assets, pathname === '/' ? 'index.html' : pathname.slice(1))
  if (!file.startsWith(resolve(assets) + sep) || !existsSync(file)) { response.writeHead(404); response.end(); return }
  const suffix = file.slice(file.lastIndexOf('.'))
  response.setHeader('Content-Type', contentTypes[suffix] ?? 'application/octet-stream')
  response.end(readFileSync(file))
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5193, '127.0.0.1', resolve) })
let browser
const errors = []
try {
  browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await context.addInitScript(({ source, translation, cuePairs }) => {
    localStorage.setItem('indexvt.theme', 'light')
    localStorage.setItem('indexvt.fontSize', 'standard')
    const clone = value => value === undefined ? undefined : structuredClone(value)
    const history = [{ id: 1, createdAt: Date.parse('2026-10-19T09:00:00+08:00') / 1000, sourceLang: 'zh', targetLang: 'en', sourceText: source, output: translation, model: 'Index-Translate-2B', mode: 'standard', starred: false }]
    const subtitle = { id: 'readme-subtitles', revision: 1, path: 'reading-club.zh.srt', format: 'srt', encoding: 'utf-8', queueActive: false, queuePaused: false, canUndo: false, canRedo: false, cues: cuePairs.map(([original, translated], index) => ({ index: index + 1, startMs: index * 5000, endMs: (index + 1) * 5000, original, translated, state: 'done', offTarget: false, needsCheck: false })) }
    const config = { onboarded: true, activeModel: 'translate', inference: { nglOverride: -1, ctxTier: '8K', cpuThreads: 0 }, resource: { idleUnloadMinutes: 30, closeBehavior: 'exit-release' }, appearance: { theme: 'light', fontSize: 'standard' }, download: { sourcePref: 'auto' }, history: { maxEntries: 100 }, loggingEnabled: false }
    const listeners = new Map()
    window.runtime = {
      EventsOn(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback) },
      EventsOff(name) { listeners.delete(name) },
      EventsEmit(name, ...data) { for (const callback of listeners.get(name) ?? []) callback(...data) },
    }
    window.__screenshotCalls = []
    const handlers = {
      GetConfig: () => config, SetConfig: value => Object.assign(config, value),
      GetSystemStatus: () => ({ orchestration: 'idle', activeModel: 'translate', runningModel: '', gpu: { present: true, totalMB: 0, usedMB: 0 }, idleMinutes: 30, idleSeconds: 0, idleReleaseSeconds: -1, activeTasks: 0, version: '1.0.0', models: [] }),
      GetLanguages: () => [{ code: 'zh', zhName: '中文', enName: 'Chinese', core: true }, { code: 'en', zhName: '英语', enName: 'English', core: true }, { code: 'ja', zhName: '日语', enName: 'Japanese', core: true }],
      ListHistory: () => history, SearchHistory: () => history, ListGlossaries: () => [],
      WarmDefaultModel: () => undefined, KeepAlive: () => undefined, NoteWorkspace: () => undefined,
      SubOpen: () => subtitle, SubGetDoc: () => subtitle, SubStyles: () => [],
    }
    window.go = { main: { App: new Proxy({}, { get: (_, key) => (...args) => {
      window.__screenshotCalls.push(String(key))
      if (!handlers[key]) return Promise.reject(new Error(`Screenshot fixture does not implement ${String(key)}`))
      return Promise.resolve(clone(handlers[key](...args)))
    } }) } }
  }, { source, translation, cuePairs })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5193/')
  await page.getByRole('button').filter({ hasText: '周六清晨' }).first().click()
  await page.getByRole('region', { name: '译文文本', exact: true }).filter({ hasText: 'Early on Saturday' }).waitFor()
  const screenshot = async name => {
    await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready })
    await page.waitForTimeout(400)
    const bytes = await page.screenshot({ animations: 'disabled' })
    mkdirSync(outputPath, { recursive: true })
    writeFileSync(join(outputPath, name), bytes)
    return { file: name, width: 1440, height: 900, sha256: sha256(bytes) }
  }
  const screenshots = [await screenshot('translation-light.png')]
  await page.getByRole('button', { name: '字幕工作台', exact: true }).click()
  await page.getByRole('button', { name: '导入字幕', exact: true }).first().click()
  const grid = page.getByRole('grid', { name: '字幕条目列表' })
  await grid.getByRole('row').nth(1).click()
  const rows = grid.getByRole('row')
  if (await rows.count() !== 9) throw new Error('The screenshot must show all eight subtitle cues.')
  if (await grid.getByText('done', { exact: true }).count() !== 8) throw new Error('Subtitle sample status mismatch.')
  screenshots.push(await screenshot('subtitles.png'))
  if (errors.length) throw new Error(errors.join('\n'))
  const screenshotCalls = await page.evaluate(() => window.__screenshotCalls)
  const metadata = {
    capturedAt: new Date().toISOString(), captureDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date()),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    executableSHA256: sha256(executableBytes), buildAssets, captureMethod: 'Exact production frontend embedded in the current executable, rendered in Chromium with an isolated sample bridge.',
    data: 'Predefined public sample text and translations; no real inference, GPU measurements or private user data.',
    sourceLanguage: 'Chinese', targetLanguage: 'English', source, translation, subtitlePairs: cuePairs, screenshots, screenshotCalls,
  }
  writeFileSync(join(outputPath, 'capture.json'), JSON.stringify(metadata, null, 2) + '\n')
  console.log(JSON.stringify({ output, screenshots, pageErrors: errors, screenshotCalls: [...new Set(screenshotCalls)] }, null, 2))
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
