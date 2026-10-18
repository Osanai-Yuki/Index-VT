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
 * #8/#9 是**新旧 token 层共存**的回归锁（Fix round 1，见报告「Fix round 1」）：
 *   新层原始变量一律加 `--suj-` 前缀，与旧 styles/tokens.css 的原始变量零重名。
 *   #9 锁新变量独立解析（--suj-ink-1 light=#000000 / dark=#FFFFFF）。
 *   （2026-10-06 Track C 收尾：旧层已随页面迁移删除，原 #8「旧值未覆盖」与
 *    #10「旧 utility 对比度」两条并存期断言随之退役；#9 保留为语义变量换值锁。）
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

/* ══════════════════════════════════════════════════════════════
   本机 harness 两条硬事实（Task 2.2 的 verify-a11y.mjs、Task 2.10 的
   contrast/keyboard 脚本会踩同样的坑，务必照抄，别重新发现）：

   (1) 浏览器：`npx playwright install chromium` 在本机失败——cdn.playwright.dev
       单请求 30s 超时（实测），ms-playwright 缓存里的 chromium-1228 又与
       playwright 1.63 要的 1243 不匹配。因此**不依赖 Playwright 自带浏览器**，
       直接用 `channel: 'chrome'` 驱动系统已装的 Chrome（本机 154.x）。
       playwright 目前是 `npm i --no-save` 装的（未进 package.json）；
       Task 2.2 才正式登记 devDependency。

   (2) 主机：本机对 IPv6 loopback `::1` 的 connect() 返回 **EACCES**（不是 refused），
       而 vite 默认 host `localhost` 只绑 `[::1]` → Node 探针连不上。所以显式
       `--host 127.0.0.1`（见下方 DEV_HOST），浏览器与探针都走 IPv4。
   ══════════════════════════════════════════════════════════════ */

/* Playwright 只作为"驱动系统 Chrome 的库"使用，不下载自带浏览器（见上 (1)）。 */
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
  /* 顺序即优先级：系统 Chrome 优先（无需下载自带浏览器，见上 (1)），
     再退 Edge，最后才试 Playwright 自带 chromium（本机通常没有）。 */
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
  /* 字体是 font-display: swap，等它们真正落地再测，避免拿到回退字体的度量。
     v2.2 起内嵌三份：Public Sans（拉丁）+ Noto Sans SC 子集（中文）+ Geist Mono（等宽）。 */
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 16px "Geist Mono"'),
      document.fonts.load('600 16px "Public Sans"'),
      document.fonts.load('400 16px "Noto Sans SC"'),
    ])
    await document.fonts.ready
  })

  /* ── #1 双主题 --suj-canvas 换值 ─────────────────────────────── */
  const themeFlip = await page.evaluate(async (mod) => {
    const m = await import(mod)
    const read = () => getComputedStyle(document.documentElement).getPropertyValue('--suj-canvas').trim()
    const out = {}
    m.applyTheme('light')
    out.lightAttr = document.documentElement.getAttribute('data-theme')
    out.lightCanvas = read()
    out.lightSurface = getComputedStyle(document.documentElement).getPropertyValue('--suj-surface').trim()
    out.lightInk1 = getComputedStyle(document.documentElement).getPropertyValue('--suj-ink-1').trim()
    out.lightColorScheme = getComputedStyle(document.documentElement).colorScheme

    m.applyTheme('dark')
    out.darkAttr = document.documentElement.getAttribute('data-theme')
    out.darkCanvas = read()
    out.darkSurface = getComputedStyle(document.documentElement).getPropertyValue('--suj-surface').trim()
    out.darkInk1 = getComputedStyle(document.documentElement).getPropertyValue('--suj-ink-1').trim()
    out.darkColorScheme = getComputedStyle(document.documentElement).colorScheme
    out.darkE2 = getComputedStyle(document.documentElement).getPropertyValue('--suj-e-2').trim()
    out.darkAccentSoft = getComputedStyle(document.documentElement).getPropertyValue('--suj-accent-soft').trim()

    m.applyTheme('light')
    out.systemResolved = m.resolveTheme('system')
    out.storedAfter = m.storedTheme()
    return out
  }, THEME_MODULE)

  const lightOk = themeFlip.lightCanvas.toLowerCase() === '#ffffff'
  const darkOk = themeFlip.darkCanvas.toLowerCase() === '#000000'
  record(1, '--suj-canvas light=#FFFFFF / dark=#000000（瑞士化重映射，同一套语义 token 换值）', lightOk && darkOk, [
    `light: data-theme="${themeFlip.lightAttr}" --suj-canvas=${themeFlip.lightCanvas} --suj-surface=${themeFlip.lightSurface} --suj-ink-1=${themeFlip.lightInk1} color-scheme=${themeFlip.lightColorScheme}`,
    `dark : data-theme="${themeFlip.darkAttr}" --suj-canvas=${themeFlip.darkCanvas} --suj-surface=${themeFlip.darkSurface} --suj-ink-1=${themeFlip.darkInk1} color-scheme=${themeFlip.darkColorScheme}`,
    `dark : --suj-e-2=${themeFlip.darkE2}`,
    `dark : --suj-accent-soft=${themeFlip.darkAccentSoft}`,
    `resolveTheme('system') → ${themeFlip.systemResolved}；storedTheme() → ${themeFlip.storedAfter}`,
    `期望 light #FFFFFF、dark #000000（2026-10-06 瑞士风格重映射）`,
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
  const radiusOk = radius.raw === '0px' && radius.validLength && radius.computed === '0px'
  record(3, '--radius-sm 解析为 0px（瑞士直角网格）且是有效长度（非空/非 guaranteed-invalid）', radiusOk, [
    `--radius-sm = ${JSON.stringify(radius.raw)}`,
    `赋给 style.borderRadius 后仍非空（= 有效长度）？ ${radius.validLength}`,
    `.rounded-sm 元素 computed border-top-left-radius = ${radius.computed}`,
    `全套：xs=${radius.all.xs} sm=${radius.all.sm} md=${radius.all.md} lg=${radius.all.lg} full=${radius.all.full}`,
    `（2026-10-06 瑞士化：四档盒圆角全部 0px；--radius-full 仅供圆点字形）`,
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
      read: getComputedStyle(document.documentElement).getPropertyValue('--suj-text-read').trim(),
      bodyToken: getComputedStyle(document.documentElement).getPropertyValue('--suj-text-body').trim(),
      caption: getComputedStyle(document.documentElement).getPropertyValue('--suj-text-caption').trim(),
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
    `standard : body=${fontScale.before.body} micro=${fontScale.before.micro}  (--suj-text-read=${fontScale.before.read} --suj-text-body=${fontScale.before.bodyToken} --suj-text-caption=${fontScale.before.caption} --text-micro=${fontScale.before.microToken})`,
    `large    : body=${fontScale.large.body} micro=${fontScale.large.micro}  (--suj-text-read=${fontScale.large.read} --suj-text-body=${fontScale.large.bodyToken} --suj-text-caption=${fontScale.large.caption} --text-micro=${fontScale.large.microToken})`,
    `small    : body=${fontScale.small.body} micro=${fontScale.small.micro}  (--suj-text-read=${fontScale.small.read} --suj-text-caption=${fontScale.small.caption})`,
    `restored : body=${fontScale.restored.body} micro=${fontScale.restored.micro}  (--suj-text-body=${fontScale.restored.bodyToken})`,
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
  const monoOk = mono.varValue.startsWith("'Geist Mono'") && !/IBM Plex/i.test(mono.fontFamily)
  record(6, "[附加·R29] --font-mono 由新层取胜（Geist Mono 栈，非旧 IBM Plex）", monoOk, [
    `--font-mono = ${mono.varValue}`,
    `.font-mono.num computed font-family = ${mono.fontFamily}`,
    `.num computed font-variant-numeric = ${mono.fontVariantNumeric}`,
    monoOk ? '非分层重申生效：旧 :root 的 IBM Plex Mono 未胜出' : '旧 styles/tokens.css 的 :root 字面值胜出 → font-mono utility 未按 DESIGN.md §3.2 生效',
  ].join('\n'))

  /* ── #7（附加）三份 vendored woff2 都被请求且可用 ─────────────── */
  const fontFaces = await page.evaluate(async () => {
    const faces = []
    document.fonts.forEach((f) => faces.push(`${f.family} ${f.weight} ${f.status}`))
    return {
      faces,
      mono: document.fonts.check('400 16px "Geist Mono"'),
      app: document.fonts.check('600 16px "Public Sans"'),
      noto: document.fonts.check('400 16px "Noto Sans SC"'),
      /* v2.1 已弃用 Inter：若仍注册即为回归（字体栈或 @font-face 被人加回来了） */
      interRegistered: faces.some((f) => f.startsWith('Inter ')),
      /* v2.2 换字体：Archivo / JetBrains Mono 已退役，若仍注册说明 @font-face 没换干净 */
      retiredRegistered: faces.some((f) => /^(Archivo|JetBrains Mono) /.test(f)),
    }
  })
  const monoFile = fontResponses.find((r) => r.url.includes('geist-mono-latin'))
  const appFile = fontResponses.find((r) => r.url.includes('public-sans-latin'))
  const notoFile = fontResponses.find((r) => r.url.includes('noto-sans-sc-cjk'))
  const interFile = fontResponses.find((r) => r.url.includes('inter-latin'))
  const retiredFile = fontResponses.find((r) => /(archivo|jetbrains-mono)-latin/.test(r.url))
  const external = fontResponses.filter((r) => r.external)
  const fontsOk = Boolean(
    monoFile && monoFile.status === 200 &&
    appFile && appFile.status === 200 &&
    notoFile && notoFile.status === 200 &&
    fontFaces.mono && fontFaces.app && fontFaces.noto &&
    !interFile && !fontFaces.interRegistered &&
    !retiredFile && !fontFaces.retiredRegistered &&
    external.length === 0,
  )
  const short = (r) => (r ? `${r.status} ${r.url.replace(/^https?:\/\/[^/]+/, '')}` : '未请求')
  record(7, '[附加·离线字体] 三份 woff2 均被请求（200）且可用；无 Inter/退役字体、无站外请求', fontsOk, [
    `字体请求共 ${fontResponses.length} 条：${fontResponses.map(short).join(' | ') || '（无）'}`,
    `geist-mono-latin → ${short(monoFile)}`,
    `public-sans-latin → ${short(appFile)}`,
    `noto-sans-sc-cjk → ${short(notoFile)}`,
    `inter-latin → ${interFile ? `仍被请求（${interFile.status}）——v2.1 应已移出仓库` : '未请求（符合预期）'}`,
    `已退役字体（archivo / jetbrains-mono）→ ${retiredFile ? `仍被请求（${retiredFile.status}）——v2.2 应已移出仓库` : '未请求（符合预期）'}`,
    `@font-face 里是否残留 Inter：${fontFaces.interRegistered ? '有（违规）' : '无'}`,
    `@font-face 里是否残留退役字体：${fontFaces.retiredRegistered ? '有（违规）' : '无'}`,
    `check: mono=${fontFaces.mono} app=${fontFaces.app} noto=${fontFaces.noto}`,
    `已注册 @font-face：${fontFaces.faces.join(' | ') || '（无）'}`,
    `指向站外的字体请求：${external.length ? '有（违规）→ ' + external.map((r) => r.url).join(', ') : '无（符合离线约束）'}`,
  ].join('\n'))

  /* ── #8（共存锁）旧原始变量已被 Track C 删除（styles/tokens.css 不复存在）──────
     原断言「旧 --ink-1/--accent 保持旧字面值」随旧层退役；此处改为锁
     旧变量名确实**不再定义**——防止任何人悄悄复活旧 token 层造成双权威。 */
  const legacyGone = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      ink1: cs.getPropertyValue('--ink-1').trim(),
      accent: cs.getPropertyValue('--accent').trim(),
      bg0: cs.getPropertyValue('--bg-0').trim(),
    }
  })
  const legacyOk = legacyGone.ink1 === '' && legacyGone.accent === '' && legacyGone.bg0 === ''
  record(8, '[共存收尾] 旧 token 原始变量（--ink-1/--accent/--bg-0）已不复定义', legacyOk, [
    `--ink-1  = ${JSON.stringify(legacyGone.ink1)}   （期望空：styles/tokens.css 已删除）`,
    `--accent = ${JSON.stringify(legacyGone.accent)}   （期望空）`,
    `--bg-0   = ${JSON.stringify(legacyGone.bg0)}   （期望空）`,
    legacyOk
      ? '旧层已彻底移除，theme/tokens.css 是唯一权威'
      : '旧变量又出现了 → 有人复活了旧 token 层，新旧双权威会重现 1.11:1 缺陷',
  ].join('\n'))

  /* ── #9（共存锁）新层 --suj-ink-1 独立解析并随主题换值 ─────────────── */
  const sujVars = await page.evaluate(async (mod) => {
    const m = await import(mod)
    const read = () => getComputedStyle(document.documentElement).getPropertyValue('--suj-ink-1').trim()
    m.applyTheme('light')
    const light = read()
    m.applyTheme('dark')
    const dark = read()
    m.applyTheme('light')
    return { light, dark }
  }, THEME_MODULE)
  const sujOk =
    sujVars.light.toLowerCase() === '#000000' &&
    sujVars.dark.toLowerCase() === '#ffffff'
  record(9, '[共存] 新层 --suj-ink-1 light=#000000 / dark=#FFFFFF（瑞士化重映射，独立解析）', sujOk, [
    `light: --suj-ink-1 = ${sujVars.light}   （期望 #000000）`,
    `dark : --suj-ink-1 = ${sujVars.dark}   （期望 #FFFFFF）`,
    sujOk
      ? '--suj-ink-1 与旧 --ink-1 各自独立换值：两条链互不干扰'
      : '--suj-ink-1 为空或错值 → 新层原始变量未按 --suj- 前缀定义',
  ].join('\n'))

  /* ── #10（可读性）真实渲染的墨色/底色对比度 ≥4.5:1 ──
     原断言锁旧 utility bg-bg-3 + text-ink-1（并存期缺陷现场）。旧层随 Track C
     删除后，改为锁新层的语义组合 surface + ink1 —— 现实页面的可读性下限。 */
  const semanticContrast = await page.evaluate(async (mod) => {
    const m = await import(mod)
    m.applyTheme('light')
    const el = document.createElement('div')
    el.className = 'bg-surface text-ink1'
    el.textContent = 'Cue row 00:00:01.000 中文样本'
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const fg = cs.color
    const bg = cs.backgroundColor
    el.remove()

    const parse = (c) => {
      const mm = c.match(/rgba?\(([^)]+)\)/i)
      if (!mm) return null
      const p = mm[1].split(',').map((s) => parseFloat(s))
      return { r: p[0], g: p[1], b: p[2] }
    }
    const lum = ({ r, g, b }) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const F = parse(fg)
    const B = parse(bg)
    let ratio = null
    if (F && B) {
      const l1 = lum(F)
      const l2 = lum(B)
      ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    return { fg, bg, ratio: ratio == null ? null : Math.round(ratio * 100) / 100 }
  }, THEME_MODULE)
  const contrastOk = semanticContrast.ratio != null && semanticContrast.ratio >= 4.5
  record(10, '[可读性] 语义组合 bg-surface + text-ink1 对比度 ≥4.5:1', contrastOk, [
    `.bg-surface.text-ink1 computed color           = ${semanticContrast.fg}`,
    `.bg-surface.text-ink1 computed background-color = ${semanticContrast.bg}`,
    `WCAG 对比度 = ${semanticContrast.ratio}:1   （门槛 ≥4.5:1）`,
    contrastOk
      ? '正文墨色落在面板底上充分可读 —— 可读性下限锁保持'
      : '墨色/底色对比不足 → 检查瑞士化后的 ink/surface token 值',
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

  /* ── #11（发布阻塞项 A1）三份字体许可证必须随产物分发 ────────────
     OFL 1.1 §2 的原话是"每一份拷贝都要带上上面的版权声明与本许可证"，
     且明确列出三种可接受的载体（独立文本文件 / 可读头 / 机器可读元数据），
     条件是"那些字段必须能被用户轻易看到"。
     本应用是 Wails 单文件 exe：字体是内嵌的 woff2，用户打不开二进制里
     的 name 表，所以"机器可读元数据"这一路走不通，必须落成独立文本文件。
     这些文件放在 `frontend/public/licenses/`（Vite 原样拷到 dist 根），
     不能放在 `src/assets/fonts/` —— 那里没有被任何模块 import，
     Vite 会静默丢弃，这正是修复前的真实缺陷：字体进了 exe，许可证没有。 */
  const LICENSE_DIR = path.join(DIST, 'licenses')
  const LICENSE_FILES = [
    { file: 'OFL-PublicSans.txt', must: 'Copyright 2015 The Public Sans Project Authors' },
    { file: 'OFL-NotoSansSC.txt', must: "Reserved Font Name 'Source'" },
    { file: 'OFL-GeistMono.txt', must: 'Copyright 2024 The Geist Project Authors' },
  ]
  const licenseChecks = LICENSE_FILES.map(({ file, must }) => {
    const full = path.join(LICENSE_DIR, file)
    if (!fs.existsSync(full)) return { file, ok: false, why: '未随产物分发（OFL §2 不满足）' }
    const text = fs.readFileSync(full, 'utf8')
    const hasOfl = /SIL OPEN FONT LICENSE Version 1\.1/.test(text)
    const hasNotice = text.includes(must)
    return {
      file,
      ok: hasOfl && hasNotice,
      why: hasOfl && hasNotice ? `OFL 1.1 全文 + ${must}` : `缺 ${[!hasOfl && 'OFL 正文', !hasNotice && must].filter(Boolean).join(' / ')}`,
    }
  })
  const licensesOk = licenseChecks.every((c) => c.ok)
  record(11, '[发布阻塞项 A1] dist/licenses/ 内三份 OFL 许可证齐全（字体随 exe 分发的前提）', licensesOk, [
    ...licenseChecks.map((c) => `${c.ok ? 'OK  ' : 'MISS'} ${c.file} — ${c.why}`),
    '依据：OFL 1.1 §2 要求每份拷贝含版权声明+许可证，且"能被用户轻易看到"；',
    '内嵌 woff2 的 name 表在单文件 exe 里用户看不到，故必须附独立文本文件。',
    `来源：frontend/public/licenses/（Vite 原样拷贝到 dist 根；放 src/assets/ 会被静默丢弃）`,
  ].join('\n'))

  /* ── #12 OFL §3：子集是 Modified Version，换字体必须先过授权审计 ──
     build-subsets.py 会钳制 fvar 的 wght 轴并重写 instances，所以产物在 OFL
     定义下就是 Modified Version，§3 由此生效："不得使用保留字体名，除非得到
     版权持有人的书面许可"。三份内嵌字体的审计结果（2026 v2.2 换字后）：
       Public Sans —— OFL 未声明保留名（USWDS）→ 用原名合法
       Geist Mono  —— OFL 未声明保留名（Vercel）→ 用原名合法
       Noto Sans SC —— Adobe 版权，保留名 'Source'；子集族名不含它 → 合法
     注意不能靠 grep woff2 二进制来验这条：woff2 的 name 表在 brotli 压缩流里，
     明文搜索恒为 0 命中，那样的断言永远"通过"却什么都没检查。
     改为**授权审计白名单**：@font-face 里出现的每个族名都必须在表内登记过，
     换字体时若不更新这张表，门禁就红 —— 迫使新字体先被人工审一遍许可证。 */
  const FONT_LICENSE_AUDIT = {
    'Public Sans': 'OFL 1.1 · 无保留字体名（Copyright 2015 The Public Sans Project Authors）',
    'Noto Sans SC': "OFL 1.1 (Adobe) · 保留名 'Source' —— 子集族名不含它，§3 满足",
    'Geist Mono': 'OFL 1.1 · 无保留字体名（Copyright 2024 The Geist Project Authors）',
  }
  const cssFiles = fs.existsSync(path.join(DIST, 'assets'))
    ? fs.readdirSync(path.join(DIST, 'assets')).filter((f) => f.endsWith('.css'))
    : []
  const embeddedFamilies = new Set()
  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(path.join(DIST, 'assets', cssFile), 'utf8')
    for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const family = block.match(/font-family\s*:\s*['"]?([^;'"]+)/)?.[1]?.trim()
      /* 产物里的族名可能被压缩器改写（chunk 级字面量提升），保留原样的才登记 */
      if (family) embeddedFamilies.add(family)
    }
  }
  const unaudited = [...embeddedFamilies].filter((f) => !(f in FONT_LICENSE_AUDIT))
  const auditOk = unaudited.length === 0 && embeddedFamilies.size > 0
  record(12, '[OFL §3] 内嵌字体族名均已在许可证审计表登记', auditOk, [
    `产物 @font-face 族名：${[...embeddedFamilies].join(' | ') || '（未读到，检查 CSS 是否内联到 JS）'}`,
    ...Object.entries(FONT_LICENSE_AUDIT).map(([family, audit]) => `  ${family} → ${audit}`),
    unaudited.length === 0
      ? '全部已登记：子集虽属 Modified Version，但未使用任何保留字体名'
      : `未审计：${unaudited.join(', ')} —— 换字体必须先在 verify-theme.mjs 登记其许可证结论`,
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
