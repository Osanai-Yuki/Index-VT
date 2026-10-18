#!/usr/bin/env node
/**
 * Screenshot targets through the project's own browser harness.
 *
 * Two kinds of target:
 *   · a local .html file (the type specimens from tools/fonts/render-specimen.py,
 *     whose fonts are inlined as data URIs, so they need no server); and
 *   · an http://127.0.0.1 URL, in which case a vite dev server is started if one
 *     is not already listening, so a real page can be captured and inspected.
 *
 * Usage:
 *   node scripts/shoot-specimen.mjs <file.html|url> <out.png> [<target> <out.png> ...]
 *   node scripts/shoot-specimen.mjs --width=1680 --route="/?mock&page=translate" shots/x.png
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')

/* 绑定 127.0.0.1 而不是 localhost：Windows 上 localhost 可能解析到 ::1，
   而本机对 IPv6 loopback 的 connect() 返回 EACCES（实测，见 verify-theme.mjs）。 */
const DEV_HOST = '127.0.0.1'
const DEV_PORT = 5173
const DEV_URL = `http://${DEV_HOST}:${DEV_PORT}`

const argv = process.argv.slice(2)
const widthArg = argv.find((a) => a.startsWith('--width='))
const width = widthArg ? Number(widthArg.slice('--width='.length)) : 1520
const heightArg = argv.find((a) => a.startsWith('--height='))
const height = heightArg ? Number(heightArg.slice('--height='.length)) : 1200
/* --selector 只截某一个元素（例如某个原语小节），避免整页缩放到看不清数字列。 */
const selectorArg = argv.find((a) => a.startsWith('--selector='))
const selector = selectorArg ? selectorArg.slice('--selector='.length) : null
const targets = argv.filter((a) => !a.startsWith('--'))

const pairs = []
for (let i = 0; i + 1 < targets.length; i += 2) {
  pairs.push({ target: targets[i], png: targets[i + 1] })
}
if (pairs.length === 0) {
  console.error('用法：node scripts/shoot-specimen.mjs [--width=N] <file.html|url> <out.png> [...]')
  process.exit(2)
}

function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function ensureDevServer() {
  if (await probe(DEV_URL)) {
    console.log(`· 复用已在监听的 dev server：${DEV_URL}`)
    return null
  }
  console.log(`· 启动 vite dev server（${DEV_URL}）`)
  const vite = path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, '--host', DEV_HOST, '--port', String(DEV_PORT), '--strictPort'], {
    cwd: FRONTEND,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  for (let i = 0; i < 225; i++) {
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
    { label: 'playwright chromium', opts: {} },
    { label: 'system chrome', opts: { channel: 'chrome' } },
    { label: 'system msedge', opts: { channel: 'msedge' } },
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

/* 目标是「路由」（/… 或 http…）时需要 dev server；是本地 .html 文件则不需要。 */
const isRoute = (t) => /^https?:\/\//.test(t) || t.startsWith('/')
const needsServer = pairs.some((p) => isRoute(p.target))
let child = null
const chromium = await loadChromium()
if (needsServer) child = await ensureDevServer()
const browser = await launchBrowser(chromium)

let failed = 0
for (const { target, png } of pairs) {
  const route = isRoute(target)
  const url = route ? (/^https?:\/\//.test(target) ? target : DEV_URL + target) : target
  if (!route && !fs.existsSync(url)) {
    console.log(`[SKIP] ${url} 不存在`)
    failed += 1
    continue
  }
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await page.goto(route ? url : path.resolve(url), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready).catch(() => {})
  await page.waitForTimeout(600)
  fs.mkdirSync(path.dirname(png), { recursive: true })
  if (selector) {
    const el = page.locator(selector).first()
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await el.screenshot({ path: png })
  } else {
    await page.screenshot({ path: png, fullPage: !route })
  }
  const kb = (fs.statSync(png).size / 1024).toFixed(0)
  console.log(`[OK] ${png}  (${kb} KB)`)
  await page.close()
}

await browser.close()
if (child) {
  child.kill()
  await new Promise((r) => setTimeout(r, 300))
}
process.exit(failed ? 1 : 0)
