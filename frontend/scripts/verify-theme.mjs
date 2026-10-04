#!/usr/bin/env node
/**
 * Task 2.1 验收门禁 —— 素笺 token 层 / 主题运行时 / 离线字体
 * ------------------------------------------------------------
 * 用法：
 *   node scripts/verify-theme.mjs            # 自动起 vite dev server（若 5173 未被占用）
 *   node scripts/verify-theme.mjs --url=http://127.0.0.1:5173/
 *
 * 五条断言里有三条是**现存 bug 的回归锁**，不是新功能检查：
 *   #2 锁旧 `font-family: var(--font-latin), var(--font-cjk)` 把 CJK 栈排在通用族之后
 *      （CSS 字体匹配命中 sans-serif 即停止，中文字体永不可达）
 *   #3 锁旧 `@theme inline { --radius-s: var(--radius-s) }` 一类同名自引用
 *      （CSS 变量成环 = guaranteed-invalid = utility 静默失效）
 *   #5 锁离线约束：产物里不得出现任何字体 CDN 字样
 * #1 锁双主题 token 换值，#4 锁 applyFontSize 只缩放三级正文字号、不动 --text-micro。
 * 另附两条 R29/字体落地检查（#6 #7），见文末说明。
 *
 * 断言失败即 exit 1。**不得为了让它变绿而放宽断言**——修 CSS。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')
const DIST = path.join(FRONTEND, 'dist')

/* 绑定 127.0.0.1 而不是默认的 `localhost`：Windows 上 `localhost` 可能被解析到
   ::1，而本机对 IPv6 loopback 的 connect() 返回 EACCES（实测），探针与 Chromium
   都会连不上。显式 IPv4 让门禁在任何环境下都是确定性的。 */
const DEV_HOST = '127.0.0.1'
const DEV_PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.slice('--port='.length) ?? 5173)
const urlArg = process.argv.find((a) => a.startsWith('--url='))
const DEV_URL = urlArg ? urlArg.slice('--url='.length) : `http://${DEV_HOST}:${DEV_PORT}/`

/* 主题运行时在页面内的模块地址（vite dev 直接服务 TS 源文件）。
   用真实模块而不是在探针里重写一遍逻辑，测的才是交付物本身。 */
const THEME_MODULE = '/src/theme/theme.ts'

const results = []
function record(id, title, ok, detail) {
  results.push({ id, title, ok, detail })
  const tag = ok ? 'PASS' : 'FAIL'
  console.log(`[${tag}] #${id} ${title}`)
  for (const line of String(detail).split('\n')) console.log(`        ${line}`)
}

/* ── 断言 #5：产物里不得出现字体 CDN ─────────────────────────── */
const CDN_NEEDLES = ['fonts.googleapis', 'fonts.gstatic']
function grepDist() {
  const hits = []
  if (!fs.existsSync(DIST)) return { hits, missing: true }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      // 二进制产物只按文件名 + 原始字节扫描，不解码
      const buf = fs.readFileSync(full)
      const text = buf.toString('latin1')
      for (const needle of CDN_NEEDLES) {
        if (text.includes(needle)) hits.push(`${path.relative(DIST, full)} → ${needle}`)
      }
    }
  }
  walk(DIST)
  return { hits, missing: false }
}

/* ── dev server 生命周期 ─────────────────────────────────────── */
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
  /* 直接 spawn node + vite，不经 npm：npm 会再套一层 shell 子进程，
     child.kill() 杀不到真正的 vite，门禁跑完会留下孤儿进程占着端口。 */
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

/* ── Playwright：优先用其自带 chromium，缺失时退回系统 Chrome/Edge ──
   Task 2.2 会把 playwright 正式装成 devDependency 并下载浏览器；
   本脚本对两者都兼容，避免"没装浏览器就跑不了门禁"。 */
async function loadChromium() {
  try {
    return (await import('playwright')).chromium
  } catch { /* 落到下面的报错分支 */ }
  try {
    return (await import('playwright-core')).chromium
  } catch {
    throw new Error('找不到 playwright。先在 frontend/ 下执行：npm i --no-save playwright（Task 2.2 会正式登记依赖）')
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

/* ── 主流程 ─────────────────────────────────────────────────── */
async function runBrowserAssertions(page) {
  const fontResponses = []
  page.on('response', (res) => {
    const u = res.url()
    if (u.includes('.woff2') || u.includes('.woff') || u.includes('.ttf')) {
      fontResponses.push({ status: res.status(), url: u, external: !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(u) })
    }
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`        (page console error) ${msg.text()}`)
  })

  await page.goto(DEV_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  /* 字体是 font-display: swap，等它们真正落地再测，避免拿到回退字体的度量 */
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px Inter'),
      document.fonts.load('600 16px Inter'),
      document.fonts.load('400 16px "JetBrains Mono"'),
    ])
    await document.fonts.ready
  })

  /* ── #1 双主题 --canvas 换值 ─────────────────────────────── */
  const themeFlip = await page.evaluate(async (mod) => {
    const m = await import(mod)
    const read = () => getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim()
    const out = {}
    m.applyTheme('light')
    out.lightAttr = document.documentElement.getAttribute('data-theme')
    out.lightCanvas = read()
    out.lightSurface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    out.lightInk1 = getComputedStyle(document.documentElement).getPropertyValue('--ink-1').trim()
    out.lightColorScheme = getComputedStyle(document.documentElement).colorScheme

    m.applyTheme('dark')
    out.darkAttr = document.documentElement.getAttribute('data-theme')
    out.darkCanvas = read()
    out.darkSurface = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
    out.darkInk1 = getComputedStyle(document.documentElement).getPropertyValue('--ink-1').trim()
    out.darkColorScheme = getComputedStyle(document.documentElement).colorScheme
    out.darkE2 = getComputedStyle(document.documentElement).getPropertyValue('--e-2').trim()
    out.darkAccentSoft = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim()

    m.applyTheme('light')
    out.systemResolved = m.resolveTheme('system')
    out.storedAfter = m.storedTheme()
    return out
  }, THEME_MODULE)

  const lightOk = themeFlip.lightCanvas.toLowerCase() === '#fbfbfa'
  const darkOk = themeFlip.darkCanvas.toLowerCase() === '#131312'
  record(1, '--canvas light=#FBFBFA / dark=#131312（同一套语义 token 换值）', lightOk && darkOk, [
    `light: data-theme="${themeFlip.lightAttr}" --canvas=${themeFlip.lightCanvas} --surface=${themeFlip.lightSurface} --ink-1=${themeFlip.lightInk1} color-scheme=${themeFlip.lightColorScheme}`,
    `dark : data-theme="${themeFlip.darkAttr}" --canvas=${themeFlip.darkCanvas} --surface=${themeFlip.darkSurface} --ink-1=${themeFlip.darkInk1} color-scheme=${themeFlip.darkColorScheme}`,
    `dark : --e-2=${themeFlip.darkE2}`,
    `dark : --accent-soft=${themeFlip.darkAccentSoft}`,
    `resolveTheme('system') → ${themeFlip.systemResolved}；storedTheme() → ${themeFlip.storedAfter}`,
    `期望 light #FBFBFA、dark #131312`,
  ].join('\n'))

  /* ── #2 CJK 栈必须排在通用族之前（旧 bug 回归锁）──────────── */
  const fontStack = await page.evaluate(() => {
    const raw = getComputedStyle(document.body).fontFamily
    const norm = raw.replace(/["']/g, '')
    return {
      raw,
      cjkIdx: norm.toLowerCase().indexOf('microsoft yahei ui'),
      genericIdx: norm.toLowerCase().indexOf('sans-serif'),
      bodyFontSize: getComputedStyle(document.body).fontSize,
    }
  })
  const stackOk = fontStack.cjkIdx >= 0 && fontStack.genericIdx >= 0 && fontStack.cjkIdx < fontStack.genericIdx
  record(2, "body fontFamily 中 'Microsoft YaHei UI' 下标 < 'sans-serif' 下标（CJK 可达）", stackOk, [
    `getComputedStyle(document.body).fontFamily = ${fontStack.raw}`,
    `'Microsoft YaHei UI' @ ${fontStack.cjkIdx}   'sans-serif' @ ${fontStack.genericIdx}   → ${fontStack.cjkIdx} < ${fontStack.genericIdx} ? ${fontStack.cjkIdx < fontStack.genericIdx}`,
    `（旧实现 font-family: var(--font-latin), var(--font-cjk) 把 sans-serif 排在 CJK 之前，中文栈永不可达）`,
  ].join('\n'))

  /* ── #3 --radius-sm 必须是有效长度 6px（@theme 自引用回归锁）── */
  const radius = await page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--radius-sm').trim()
    const probeEl = document.createElement('div')
    probeEl.style.borderRadius = raw
    const validLength = probeEl.style.borderRadius !== ''

    const util = document.createElement('div')
    util.className = 'rounded-sm'
    document.body.appendChild(util)
    const computed = getComputedStyle(util).borderTopLeftRadius
    util.remove()

    const all = {}
    for (const name of ['xs', 'sm', 'md', 'lg', 'full']) {
      all[name] = getComputedStyle(document.documentElement).getPropertyValue(`--radius-${name}`).trim()
    }
    return { raw, validLength, computed, all }
  })
  const radiusOk = radius.raw === '6px' && radius.validLength && radius.computed === '6px'
  record(3, '--radius-sm 解析为 6px 且是有效长度（非空/非 guaranteed-invalid）', radiusOk, [
    `--radius-sm = ${JSON.stringify(radius.raw)}`,
    `赋给 style.borderRadius 后仍非空（= 有效长度）？ ${radius.validLength}`,
    `.rounded-sm 元素 computed border-top-left-radius = ${radius.computed}`,
    `全套：xs=${radius.all.xs} sm=${radius.all.sm} md=${radius.all.md} lg=${radius.all.lg} full=${radius.all.full}`,
    `（旧 @theme inline { --radius-s: var(--radius-s) } 同名自引用 → 成环 → guaranteed-invalid → 值为空）`,
  ].join('\n'))

  /* ── #4 applyFontSize('large')：正文 14.85px，--text-micro 不动 ── */
  const fontScale = await page.evaluate(async (mod) => {
    const m = await import(mod)
    const micro = document.createElement('span')
    micro.className = 'text-micro'
    micro.textContent = 'CUE 00:00:01.000'
    document.body.appendChild(micro)

    const snapshot = (label) => ({
      label,
      body: getComputedStyle(document.body).fontSize,
      micro: getComputedStyle(micro).fontSize,
      read: getComputedStyle(document.documentElement).getPropertyValue('--text-read').trim(),
      bodyToken: getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim(),
      caption: getComputedStyle(document.documentElement).getPropertyValue('--text-caption').trim(),
      microToken: getComputedStyle(document.documentElement).getPropertyValue('--text-micro').trim(),
    })

    const before = snapshot('standard')
    m.applyFontSize('large')
    const large = snapshot('large')
    m.applyFontSize('small')
    const small = snapshot('small')
    m.applyFontSize('standard')
    const restored = snapshot('standard(restored)')
    micro.remove()
    return { before, large, small, restored }
  }, THEME_MODULE)

  const largePx = parseFloat(fontScale.large.body)
  const microPx = parseFloat(fontScale.large.micro)
  const scaleOk = Math.abs(largePx - 14.85) <= 0.01 && Math.abs(microPx - 11) <= 0.01
  record(4, "applyFontSize('large') → body 14.85px，而 .text-micro 仍 11px", scaleOk, [
    `standard : body=${fontScale.before.body} micro=${fontScale.before.micro}  (--text-read=${fontScale.before.read} --text-body=${fontScale.before.bodyToken} --text-caption=${fontScale.before.caption} --text-micro=${fontScale.before.microToken})`,
    `large    : body=${fontScale.large.body} micro=${fontScale.large.micro}  (--text-read=${fontScale.large.read} --text-body=${fontScale.large.bodyToken} --text-caption=${fontScale.large.caption} --text-micro=${fontScale.large.microToken})`,
    `small    : body=${fontScale.small.body} micro=${fontScale.small.micro}  (--text-read=${fontScale.small.read} --text-caption=${fontScale.small.caption})`,
    `restored : body=${fontScale.restored.body} micro=${fontScale.restored.micro}  (--text-body=${fontScale.restored.bodyToken})`,
    `期望 large: body ≈ 14.85px（13.5 × 1.1）、.text-micro = 11px（刻意不缩放，否则表格列宽随字号跳动）`,
  ].join('\n'))

  /* ── #6（附加 R29 锁）--font-mono 必须由新层取胜 ──────────────
     Tailwind 把 @theme 变量输出到 @layer theme，而旧 styles/tokens.css 的
     :root{--font-mono:'IBM Plex Mono',…} 是**非分层**规则，恒胜任何 @layer。
     仅靠 main.tsx 的"旧→新"导入顺序不够；tokens.css 末尾有一条非分层重申。
     这条断言就是那层兜底的回归锁。 */
  const mono = await page.evaluate(() => {
    const el = document.createElement('span')
    el.className = 'font-mono num'
    el.textContent = '00:00:01.000'
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const out = {
      varValue: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim(),
      fontFamily: cs.fontFamily,
      fontVariantNumeric: cs.fontVariantNumeric,
    }
    el.remove()
    return out
  })
  const monoOk = mono.varValue.startsWith("'JetBrains Mono'") && !/IBM Plex/i.test(mono.fontFamily)
  record(6, "[附加·R29] --font-mono 由新层取胜（JetBrains Mono 栈，非旧 IBM Plex）", monoOk, [
    `--font-mono = ${mono.varValue}`,
    `.font-mono.num computed font-family = ${mono.fontFamily}`,
    `.num computed font-variant-numeric = ${mono.fontVariantNumeric}`,
    monoOk ? '非分层重申生效：旧 :root 的 IBM Plex Mono 未胜出' : '旧 styles/tokens.css 的 :root 字面值胜出 → font-mono utility 未按 DESIGN.md §3.2 生效',
  ].join('\n'))

  /* ── #7（附加）vendored woff2 真的被请求且可用 ─────────────── */
  const fontFaces = await page.evaluate(async () => {
    const faces = []
    document.fonts.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.status}`))
    return {
      faces,
      inter: document.fonts.check('600 16px Inter'),
      jbm: document.fonts.check('400 16px "JetBrains Mono"'),
    }
  })
  const interFile = fontResponses.find((r) => r.url.includes('inter-latin'))
  const jbmFile = fontResponses.find((r) => r.url.includes('jetbrains-mono-latin'))
  const external = fontResponses.filter((r) => r.external)
  const fontsOk = Boolean(
    interFile && interFile.status === 200 &&
    jbmFile && jbmFile.status === 200 &&
    fontFaces.inter && fontFaces.jbm &&
    external.length === 0,
  )
  const short = (r) => (r ? `${r.status} ${r.url.replace(/^https?:\/\/[^/]+/, '')}` : '未命中')
  record(7, '[附加·离线字体] 本地 woff2 被请求（200）且 Inter/JetBrains Mono 可用', fontsOk, [
    `字体请求共 ${fontResponses.length} 条：${fontResponses.map(short).join(' | ') || '（无）'}`,
    `inter-latin → ${short(interFile)}`,
    `jetbrains-mono-latin → ${short(jbmFile)}`,
    `document.fonts.check('600 16px Inter') = ${fontFaces.inter}`,
    `document.fonts.check('400 16px "JetBrains Mono"') = ${fontFaces.jbm}`,
    `已注册 @font-face：${fontFaces.faces.join(' | ') || '（无）'}`,
    `指向站外的字体请求：${external.length ? '有（违规）→ ' + external.map((r) => r.url).join(', ') : '无（符合离线约束）'}`,
  ].join('\n'))
}

async function main() {
  console.log('── verify-theme.mjs · Task 2.1 验收门禁 ──')

  /* ── #5 产物内不得出现字体 CDN（不依赖浏览器，先跑）────────── */
  if (!fs.existsSync(DIST)) {
    console.log('· dist/ 不存在 → 先跑一次 vite build')
    const build = spawn(process.execPath, [path.join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], {
      cwd: FRONTEND,
      stdio: 'inherit',
    })
    const code = await new Promise((r) => build.on('close', r))
    if (code !== 0) throw new Error('vite build 失败，无法验证产物')
  }
  const { hits } = grepDist()
  const woff2 = fs.existsSync(path.join(DIST, 'assets'))
    ? fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.woff2'))
    : []
  record(5, 'dist/ 内不出现 fonts.googleapis / fonts.gstatic（离线约束）', hits.length === 0, [
    `扫描 ${DIST}（${countFiles(DIST)} 个文件），needle = ${CDN_NEEDLES.join(' , ')}`,
    hits.length === 0 ? '0 命中' : `${hits.length} 命中：\n${hits.join('\n')}`,
    `产物内的本地字体文件：${woff2.length ? woff2.join(', ') : '（无）'}`,
  ].join('\n'))
  console.log('')

  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 800 } })
    await runBrowserAssertions(page)
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const ordered = [...results].sort((a, b) => a.id - b.id)
  const failed = ordered.filter((r) => !r.ok)
  console.log('')
  console.log(`── 结果：${ordered.length - failed.length}/${ordered.length} 通过 ──`)
  for (const r of ordered) console.log(`   ${r.ok ? 'PASS' : 'FAIL'} #${r.id} ${r.title}`)
  if (failed.length) {
    console.log(`\n失败项：${failed.map((f) => `#${f.id}`).join(', ')}（修 CSS/运行时，不要放宽断言）`)
    process.exit(1)
  }
  console.log('全绿。')
}

function countFiles(dir) {
  let n = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1
  }
  return n
}

main().catch((err) => {
  console.error('verify-theme.mjs 异常：', err)
  process.exit(1)
})
