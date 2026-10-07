// dev-only mock 后端（?mock=1）
// ------------------------------------------------------------
// 唯一样本源的假数据只服务于一件事：让**真实页面**在纯浏览器里渲染出有数据的形态，
// 使四道页面门禁（a11y / contrast / keyboard / datatable）能在真实页面上当靶子跑，
// 而不是只能扫陈列页。
//
// 只在 import.meta.env.DEV 且 URL 带 ?mock 时由 main.tsx 动态 import —— 生产包不含本模块。
// 覆盖前端已封装的全部绑定（wailsapi.ts 的 34 个 api*）+ window.runtime 事件三件套。
// 未覆盖的方法会 resolve(null) 并在控制台点名一次，方便发现漏配。
//
// 参数：
//   ?mock&page=settings   初始页（translate|subtitle|doc|model|settings）
//   ?mock&fresh=1         config.onboarded=false，用于扫首次引导页
import { useAppStore } from '../stores/appStore'

/* ── 假数据（形状逐字段对齐 Go 的 json tag） ───────────────── */

const gpu = { present: true, name: 'NVIDIA GeForce RTX 3060', totalMB: 12288, usedMB: 3400, freeMB: 8888, driverOK: true }

const quantsFor = (present: boolean) => [
  { quant: 'Q4_K_M', present, sizeBytes: 1312164352 },
  { quant: 'Q8_0', present: false, sizeBytes: 2235000000 },
]

const models = () => [
  {
    id: 'translate',
    name: 'Index-Translate-2B',
    role: '主翻译 · 150 语言 · 字幕逐条',
    languages: '150 语言',
    repo: 'IndexTeam/Index-Translate-2B-GGUF',
    state: 'running',
    active: true,
    port: 8101,
    quants: quantsFor(true),
    source: 'hf',
    idleSec: 187,
  },
  {
    id: 'nailong',
    name: 'Index-Nailong-2B',
    role: '长文档 · zh↔en / zh↔ja',
    languages: 'zh / en / ja',
    repo: 'IndexTeam/Index-Nailong-2B-GGUF',
    state: 'ready',
    active: false,
    quants: quantsFor(true),
  },
  {
    id: 'homura',
    name: 'Index-Homura-2B',
    role: '配音模式 · 目标音节预算',
    languages: 'zh / en / ja',
    repo: 'IndexTeam/Index-Homura-2B-GGUF',
    state: 'not-downloaded',
    active: false,
    quants: quantsFor(false),
  },
]

const status = () => ({
  orchestration: 'running',
  activeModel: 'translate',
  port: 8101,
  gpu,
  idleMinutes: 5,
  idleSeconds: 187,
  activeTasks: 1,
  version: 'dev-mock',
  offline: false,
  models: models(),
})

let cfg = {
  inference: { nglOverride: -1, ctxTier: '8K', cpuThreads: 0, tempOverride: false },
  resource: { idleUnloadMinutes: 5, closeBehavior: 'exit-release' },
  download: { sourcePref: 'auto' },
  appearance: { theme: 'system', fontSize: 'standard' },
  history: { maxEntries: 2000 },
  onboarded: true,
  activeModel: 'translate',
}

const LANGS = [
  { code: 'en', zhName: '英语', enName: 'English', script: 'Latin', core: true },
  { code: 'zh', zhName: '中文', enName: 'Chinese', script: 'Han', core: true },
  { code: 'ja', zhName: '日语', enName: 'Japanese', script: 'Japanese', core: true },
  { code: 'ko', zhName: '韩语', enName: 'Korean', script: 'Hangul', core: true },
  { code: 'de', zhName: '德语', enName: 'German', script: 'Latin', core: true },
  { code: 'fr', zhName: '法语', enName: 'French', script: 'Latin', core: true },
  { code: 'es', zhName: '西班牙语', enName: 'Spanish', script: 'Latin', core: true },
  { code: 'ru', zhName: '俄语', enName: 'Russian', script: 'Cyrillic', core: true },
  { code: 'pt', zhName: '葡萄牙语', enName: 'Portuguese', script: 'Latin', core: true },
  { code: 'it', zhName: '意大利语', enName: 'Italian', script: 'Latin', core: true },
  { code: 'ar', zhName: '阿拉伯语', enName: 'Arabic', script: 'Arabic' },
  { code: 'th', zhName: '泰语', enName: 'Thai', script: 'Thai' },
  { code: 'vi', zhName: '越南语', enName: 'Vietnamese', script: 'Latin' },
  { code: 'id', zhName: '印尼语', enName: 'Indonesian', script: 'Latin' },
  { code: 'tr', zhName: '土耳其语', enName: 'Turkish', script: 'Latin' },
  { code: 'pl', zhName: '波兰语', enName: 'Polish', script: 'Latin' },
  { code: 'nl', zhName: '荷兰语', enName: 'Dutch', script: 'Latin' },
  { code: 'sv', zhName: '瑞典语', enName: 'Swedish', script: 'Latin' },
  { code: 'he', zhName: '希伯来语', enName: 'Hebrew', script: 'Hebrew' },
  { code: 'hi', zhName: '印地语', enName: 'Hindi', script: 'Devanagari' },
]

const SRC = [
  '今天下午的会议临时取消了，改天我们再碰一下商量。',
  '王平仲采用了更加昂贵的碳纤维材料。碳纤维的好处就是它抗裂缝。',
  'The weather is nice today. Let us go for a walk in the park.',
  'この翻訳モデルはすべてローカルで動作します。',
  '回复 @零岭七 :乱说，外购不算消费啦？[藏狐] #每日一喵#',
  '该方案在成本与工期上都不具备可行性，建议重新评估。',
  'モデルの読み込みには十秒ほどかかります。',
  'Please keep the JSON structure intact when translating.',
  '数据表明，低资源语言的翻译质量仍有提升空间。',
  '字幕时间轴需要与画面严格对齐。',
  '本工具不收集任何遥测数据。',
  '术语表可以让专有名词的译法保持稳定。',
]
const OUT = [
  'The meeting this afternoon was cancelled; let us talk it over another day.',
  'Wang Pingzhong used more expensive carbon fiber, which resists cracking.',
  '今天天气不错，我们去公园散步吧。',
  '这个翻译模型完全在本地运行。',
  'Reply @零岭七: nonsense, buying externally does not count? [fox] #DailyMeow#',
  'The plan is infeasible in both cost and schedule; a re-assessment is advised.',
  '模型加载大约需要十秒。',
  '翻译时请保持 JSON 结构不变。',
  'Data shows there is still room to improve low-resource translation quality.',
  'Subtitle timings must align strictly with the picture.',
  'This tool collects no telemetry whatsoever.',
  'A glossary keeps proper nouns translated consistently.',
]

const history = () =>
  SRC.map((s, i) => ({
    id: 1000 + i,
    createdAt: Date.now() - i * 3_600_000 * 7,
    sourceLang: i % 3 === 0 ? 'zh' : i % 3 === 1 ? 'auto' : 'ja',
    targetLang: i % 2 === 0 ? 'en' : 'zh',
    sourceText: s,
    output: OUT[i],
    model: 'Index-Translate-2B',
    mode: i % 4 === 0 ? 'custom' : 'standard',
    starred: i === 1 || i === 4,
  }))

const glossaries = () => [
  {
    id: 1,
    name: '人名库',
    items: [
      { term: '王妃', translation: 'Wang Fei' },
      { term: '王平仲', translation: 'Wang Pingzhong' },
    ],
  },
  {
    id: 2,
    name: '碳纤维术语',
    items: [
      { term: '碳纤维', translation: 'carbon fiber' },
      { term: '抗裂缝', translation: 'crack resistance' },
    ],
  },
]

const unknownModels = () => [
  {
    id: 'unknown',
    name: 'my-custom-model.gguf',
    role: '未识别',
    languages: '',
    repo: '',
    state: 'ready',
    active: false,
    quants: [],
    isUnknown: true,
    path: 'models/my-custom-model.gguf',
  },
]

/* 字幕：48 条 cue，覆盖 done / pending / failed / off-target / needsCheck 各种徽标形态 */
const cues = () =>
  Array.from({ length: 48 }, (_, i) => {
    const state = i < 30 ? 'done' : i < 36 ? 'pending' : i < 40 ? 'failed' : 'done'
    return {
      index: i + 1,
      startMs: i * 3200,
      endMs: i * 3200 + 2800,
      original: SRC[i % SRC.length],
      translated: state === 'pending' ? '' : OUT[i % OUT.length],
      styleName: i % 7 === 0 ? 'Title' : 'Default',
      state,
      offTarget: i % 11 === 0,
      needsCheck: i % 13 === 0,
    }
  })

const subtitleDoc = () => ({
  id: 'mock-doc',
  path: 'C:\\subs\\demo.zh.srt',
  format: 'srt',
  encoding: 'utf-8',
  cues: cues(),
  queueActive: false, // mock 无真实队列；暂停/继续/取消随之禁用，与空跑行为一致
})

/* ── 事件三件套 ─────────────────────────────────────────────── */

const listeners = new Map<string, Set<(...a: unknown[]) => void>>()

const runtime = {
  EventsOn(name: string, cb: (...a: unknown[]) => void) {
    const set = listeners.get(name) ?? new Set()
    set.add(cb)
    listeners.set(name, set)
  },
  EventsOff(name: string) {
    listeners.delete(name)
  },
  EventsEmit(name: string, ...data: unknown[]) {
    for (const cb of listeners.get(name) ?? []) cb(...data)
  },
  BrowserOpenURL() {},
  LogPrint() {},
  WindowSetTitle() {},
}

let warnCount = 0
function emitTranslateDemo(taskId: string, syl: { target: number; actual: number } | null) {
  const text = OUT[0]
  const step = Math.ceil(text.length / 12)
  let at = 0
  const timer = setInterval(() => {
    runtime.EventsEmit('translate:delta', { taskId, text: text.slice(at, at + step) })
    at += step
    if (at >= text.length) {
      clearInterval(timer)
      runtime.EventsEmit('translate:done', {
        taskId,
        output: text,
        tokPerSec: 32.4,
        firstTokenMs: 412,
        offTarget: false,
        // 配音模式（F-07）：确定性偏差 +1，dev 假后端下「目标 N / 实测 M」胶囊可断言
        targetSyllables: syl?.target,
        actualSyllables: syl?.actual,
      })
    }
  }, 90)
}

/* ── 方法表 ─────────────────────────────────────────────────── */

const handlers: Record<string, (...args: never[]) => unknown> = {
  GetSystemStatus: () => status(),
  ListModels: () => models(),
  ListUnknownModels: () => unknownModels(),
  AssignUnknown: () => models()[0],
  DownloadModel: () => undefined,
  CancelDownload: () => undefined,
  DeleteModel: () => undefined,
  SetActiveModel: (id: never) => {
    cfg = { ...cfg, activeModel: id as unknown as string }
  },
  KeepAlive: () => undefined,
  GetConfig: () => cfg,
  SetConfig: (patch: never) => {
    cfg = { ...cfg, ...(patch as unknown as typeof cfg) }
  },
  EstimateCtxVRAM: (tokens: never) => {
    // 必须与 app.go 的 estimateCtxVRAM 保持同式（真源在那边；这里是 dev 假后端的镜像）：
    // KV 按比例 120 MiB/8K、固定开销 260 MiB，2026-10-06 实测标定。
    const t = tokens as unknown as number
    const weights = 1251
    const kv = Math.floor((t * 120) / 8192)
    const activate = 260
    const gpu = { present: true, totalMB: 4096, usedMB: 900, freeMB: 3196, name: 'NVIDIA GeForce RTX 3050 Laptop GPU', driverOK: true }
    const total = weights + kv + activate
    return {
      tokens: t,
      weightsMiB: weights,
      kvMiB: kv,
      activateMiB: activate,
      totalMiB: total,
      gpu,
      exceedsFree: total > gpu.freeMB,
      basis: 'mock：线性估算（镜像 app.go）',
    }
  },
  GetLanguages: () => LANGS,
  ListHistory: () => history(),
  SearchHistory: () => history().slice(0, 4),
  DeleteHistory: () => undefined,
  StarHistory: () => undefined,
  ClearHistory: () => undefined,
  ListGlossaries: () => glossaries(),
  SaveGlossary: () => 3,
  DeleteGlossary: () => undefined,
  ExportGlossaryCSV: () => 'models/exports/mock-glossary.csv',
  ProbeEnv: () => ({
    gpu,
    webView2Present: true,
    webView2Version: '120.0.2210.144',
    llamaServerPath: 'thirdparty/llama-server/llama-server.exe',
    llamaServerOK: true,
    modelsDir: 'models',
    cpuLogicalCores: 12,
    cpuModel: 'AMD Ryzen 5 5600 6-Core',
    sweep: { cleaned: [], count: 0 },
    probedAt: Date.now(),
  }),
  Translate: (req: never) => {
    const r = req as unknown as { dubbing?: boolean; syllables?: number }
    const taskId = 'mock-task-1'
    // dubbing → 回配音音节（确定性偏差 +1）；普通模式回 null，done 事件不带音节字段
    const syl = r.dubbing ? { target: r.syllables ?? 7, actual: (r.syllables ?? 7) + 1 } : null
    setTimeout(() => emitTranslateDemo(taskId, syl), 120)
    return { taskId }
  },
  CancelTask: () => undefined,
  SubOpen: () => subtitleDoc(),
  SubGetDoc: () => subtitleDoc(),
  SubTranslate: () => undefined,
  SubPauseQueue: () => undefined,
  SubResumeQueue: () => undefined,
  SubCancelQueue: () => undefined,
  SubRetryFailed: () => undefined,
  SubRetryCues: () => undefined,
  SubExport: () => undefined,
  CollectLogs: () => 'logs/mock-bundle.zip',
  OpenModelsFolder: () => undefined,
  OpenLogsFolder: () => undefined,
  PrepareExit: () => undefined,
  Quit: () => undefined,
}

/* ── 装配 ───────────────────────────────────────────────────── */

export function installMockBackend(): void {
  const params = new URLSearchParams(window.location.search)

  // 未知方法：resolve(null) + 点名一次。宁可页面缺一块，也不要整页炸掉。
  const backend = new Proxy(handlers, {
    get(target, key: string) {
      if (key in target) return (...args: never[]) => Promise.resolve(target[key](...args))
      if (typeof key === 'string' && warnCount < 8 && !key.startsWith('__')) {
        warnCount++
        console.warn(`[mock] 未覆盖的绑定：${key}（已 resolve null）`)
      }
      return () => Promise.resolve(null)
    },
  })

  ;(window as unknown as { runtime: unknown }).runtime = runtime
  ;(window as unknown as { go: unknown }).go = { main: { App: backend } }

  if (params.get('fresh') === '1') {
    cfg = { ...cfg, onboarded: false }
  }
  const page = params.get('page')
  const VALID = ['translate', 'subtitle', 'doc', 'model', 'settings'] as const
  if (page && (VALID as readonly string[]).includes(page)) {
    useAppStore.setState({ page: page as (typeof VALID)[number] })
  }

  console.info('[mock] 假后端已装配（?mock）：页面带数据渲染，仅 dev 生效')
}
