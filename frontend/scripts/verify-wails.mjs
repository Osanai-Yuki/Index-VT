#!/usr/bin/env node
/**
 * Wails 事件层浏览器探针（计划 Task 2.3 Step 2）
 * ------------------------------------------------------------
 * 前端无单测框架 → 在 dev server 页面上注入**假的 window.runtime**
 * （EventsOn 存回调 / EventsEmit 触发它 / EventsOff 记录被摘的事件名），
 * 然后导入真实模块 /src/lib/wails.ts 断言四件事：
 *
 *   #1 多路分发：A、B 订阅同名事件，emit 一次 → 两者都收到
 *   #2 退订隔离：退订 A 后 emit → B 仍收到，且 EventsOff 未被调用（集合非空）；
 *                再退订 B → EventsOff 恰好被调用一次
 *   #3 早到缓冲：先 emit（无订阅者）→ 再订阅 → 新 handler 立即收到缓冲的那条，
 *                且缓冲被清空（二次订阅不再收到）。用 EV 表内的名字——
 *                模块加载即对 ALWAYS_ON 名字预挂 Wails 监听，否则 emit 在
 *                无订阅者期间根本到不了 dispatch（见 lib/wails.ts 头注释）。
 *   #4 异常隔离：A 抛错，B 仍收到
 *
 * 本机 harness 事实（与 verify-theme/verify-a11y 相同）：IPv4 绑定 127.0.0.1、
 * 直启 node+vite、浏览器走系统 Chrome → Edge → 自带 chromium 顺序。
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

const WAILS_MODULE = '/src/lib/wails.ts'

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

/* 在页面上下文里执行的探针主体（经 page.evaluate 注入）。
   只依赖 window.__fakeRt（addInitScript 注入的假 runtime）与真实模块。 */
const PROBE_SOURCE = async () => {
  const w = await import('/src/lib/wails.ts')
  const rt = window.__fakeRt
  const log = []
  const check = (id, ok, detail) => log.push({ id, ok, detail })
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

  /* ── #1 多路分发 + #2 退订隔离（自定义事件名：动态挂/摘）── */
  const got = []
  const offA = w.on('test:fan', (p) => got.push(['A', p]))
  const offB = w.on('test:fan', (p) => got.push(['B', p]))
  rt.EventsEmit('test:fan', { n: 1 })
  check(
    '#1 emit 一次 A、B 都收到（单点注册多路分发）',
    eq(got, [['A', { n: 1 }], ['B', { n: 1 }]]),
    `收到序列 = ${JSON.stringify(got)}`,
  )

  offA()
  rt.EventsEmit('test:fan', { n: 2 })
  check(
    '#2a 退订 A 后 emit 仅 B 收到（退订只摘自己）',
    eq(got, [['A', { n: 1 }], ['B', { n: 1 }], ['B', { n: 2 }]]),
    `收到序列 = ${JSON.stringify(got)}`,
  )
  const offsAfterA = rt.offNames.filter((x) => x === 'test:fan').length
  check(
    '#2b 集合非空时 EventsOff 未被调用',
    offsAfterA === 0,
    `EventsOff('test:fan') 调用次数 = ${offsAfterA}（期望 0）`,
  )

  offB()
  const offsAfterB = rt.offNames.filter((x) => x === 'test:fan').length
  check(
    '#2c 最后一个退订后 EventsOff 恰好一次',
    offsAfterB === 1,
    `EventsOff('test:fan') 调用次数 = ${offsAfterB}（期望 1）`,
  )

  /* ── #3 早到缓冲（EV 表名字：模块加载即预挂，无订阅者期间进 pending）── */
  rt.EventsEmit('model:progress', { early: true })
  const earlyGot = []
  const offE1 = w.on('model:progress', (p) => earlyGot.push(p))
  check(
    '#3a 订阅时立即收到早到缓冲的那条',
    earlyGot.length === 1 && earlyGot[0]?.early === true,
    `新 handler 收到 = ${JSON.stringify(earlyGot)}`,
  )
  const earlyGot2 = []
  const offE2 = w.on('model:progress', (p) => earlyGot2.push(p))
  check(
    '#3b 缓冲已清空（二次订阅不重放）',
    earlyGot2.length === 0,
    `二次订阅收到 = ${JSON.stringify(earlyGot2)}`,
  )
  offE1()
  offE2()

  /* ── #4 异常隔离 ── */
  const got4 = []
  const offX = w.on('test:err', () => { throw new Error('boom') })
  const offY = w.on('test:err', (p) => got4.push(p))
  rt.EventsEmit('test:err', { n: 9 })
  check(
    '#4 A 抛错不阻断 B（safe 逐个调用）',
    got4.length === 1 && got4[0]?.n === 9,
    `B 收到 = ${JSON.stringify(got4)}`,
  )
  offX()
  offY()

  return log
}
const PROBE_STRING = `(${PROBE_SOURCE.toString()})()`

async function main() {
  console.log('── verify-wails.mjs · 事件分发器浏览器探针 ──')
  const chromium = await loadChromium()
  const child = await ensureDevServer()
  const browser = await launchBrowser(chromium)

  let results
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    /* 假 runtime 必须在任何页面脚本之前就位（addInitScript 先于全部脚本执行），
       这样 lib/wails.ts 模块加载时的 ALWAYS_ON 预挂才能真正挂到假 runtime 上。
       EventsOff 记录被摘的事件名而非直接删除，便于断言调用次数。 */
    await page.addInitScript(() => {
      const ons = {}
      const offNames = []
      window.__fakeRt = {
        ons,
        offNames,
        EventsOn(name, cb) {
          ;(ons[name] = ons[name] ?? []).push(cb)
        },
        EventsOff(name) {
          offNames.push(name)
          delete ons[name]
        },
        EventsEmit(name, payload) {
          for (const cb of ons[name] ?? []) cb(payload)
        },
      }
      window.runtime = window.__fakeRt
    })
    /* 打开 /?primitives（陈列页）：它不订阅任何 EV 表事件。
       曾直接开 / —— Track C 把 App 外壳接到新事件层后，appStore 在挂载时成为
       model:progress 等事件的合法订阅者，会消费掉本应进入"早到缓冲"的事件，
       #3a 的"emit 时无订阅者"前提不再成立。分发器隔离测试需要无订阅者的页面。 */
    await page.goto(`${DEV_URL}?primitives`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    results = await page.evaluate(PROBE_STRING)
  } finally {
    await browser.close()
    if (child) {
      child.kill()
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  for (const r of results) {
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.id}`)
    if (!r.ok) console.log(`        ${r.detail}`)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n── 结果：${results.length - failed.length}/${results.length} 通过 ──`)
  if (failed.length) {
    console.error(`失败项：${failed.map((f) => f.id.split(' ')[0]).join(', ')}`)
    process.exit(1)
  }
  console.log('全绿。')
}

main().catch((err) => {
  console.error('verify-wails.mjs 异常：', err)
  process.exit(1)
})
