// dev-only mock 后端（?mock=1）
// ------------------------------------------------------------
// 唯一样本源的假数据只服务于一件事：让**真实页面**在纯浏览器里渲染出有数据的形态，
// 使四道页面门禁（a11y / contrast / keyboard / datatable）能在真实页面上当靶子跑，
// 而不是只能扫陈列页。
//
// 只在 import.meta.env.DEV 且 URL 带 ?mock 时由 main.tsx 动态 import —— 生产包不含本模块。
// 覆盖 wailsapi.ts 全部 54 个 api* 封装 + 未封装的 ExportGlossaryCSV，共 55 个方法。
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
  idleMinutes: 30,
  idleReleaseSeconds: -1,
  idleSeconds: 187,
  activeTasks: 1,
  version: 'dev-mock',
  offline: false,
  models: models(),
})

let cfg = {
  inference: { nglOverride: -1, ctxTier: '8K', cpuThreads: 0, tempOverride: false },
  resource: { idleUnloadMinutes: 30, closeBehavior: 'exit-release' },
  download: { sourcePref: 'auto' },
  appearance: { theme: 'system', fontSize: 'standard' },
  history: { maxEntries: 2000 },
  loggingEnabled: false,
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

let glossaryBooks = [
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

const glossaries = () => structuredClone(glossaryBooks)

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

/* 字幕 cue 形状（对齐 Go subtitle.Cue 的 json tag；
   omitempty 字段在前端侧为可选——拆分/插入的新条本来就不带它们） */
interface MockCue {
  index: number
  startMs: number
  endMs: number
  original: string
  translated: string
  styleName?: string
  state: string
  offTarget?: boolean
  needsCheck?: boolean
}

/* 字幕：48 条 cue，覆盖 done / pending / failed / off-target / needsCheck 各种徽标形态 */
const cues = (): MockCue[] =>
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

/* M4 编辑载体：一份活文档 + 一份样式库。引擎语义是「编辑就地改内存、
   返回浅拷贝快照」，mock 同样维护活状态——下方 10 个 Sub* 编辑/样式绑定
   真实改写这份状态，?mock 下编辑路径与真实交互同构（可连续点、结果可见）。
   SubOpen 重开 = 重置回 48 条样例（引擎语义：新文件即新文档、条目全回 pending）。 */
interface MockStyle {
  name: string
  fontName: string
  fontSize: number
  primaryRGB: string
  outlineRGB: string
  outline: number
  bold: boolean
  alignment: number
  marginV: number
}

const newSubDoc = () => ({
  id: 'mock-doc',
  path: 'C:\\subs\\demo.zh.srt',
  format: 'srt',
  encoding: 'utf-8',
  cues: cues(),
  queueActive: false, // mock 无真实队列；暂停/继续/取消随之禁用，与空跑行为一致
})
let subDoc = newSubDoc()

// ASS 样式库样例（Default / Title 两枚，对齐 cues 的 styleName 引用）
const newStyles = (): MockStyle[] => [
  { name: 'Default', fontName: 'Microsoft YaHei', fontSize: 20, primaryRGB: '#FFFFFF', outlineRGB: '#000000', outline: 2, bold: false, alignment: 2, marginV: 30 }, // lint-allow: raw-color —— ASS 样式字段值（假数据），不进界面渲染链
  { name: 'Title', fontName: 'Microsoft YaHei', fontSize: 28, primaryRGB: '#E60000', outlineRGB: '#000000', outline: 3, bold: true, alignment: 8, marginV: 60 }, // lint-allow: raw-color —— 同上（ASS #RRGGBB 字段值）
]
let subStyles = newStyles()

// 快照与引擎同语义：浅拷贝 cue 切片，改动不串扰渲染中的旧快照
const subSnapshot = () => ({ ...subDoc, cues: [...subDoc.cues] })

// 序号重排（1 起始连续，engine.reindex 同款）
const reindexSub = () => {
  subDoc.cues.forEach((c, i) => {
    c.index = i + 1
  })
}

// 按时间占比切文本，就近落空白/标点边界（ engine.splitTextByRatio 同款效果；
// 扫 ±20% 长度找边界，找不到就在占比位置硬切）
const splitText = (text: string, ratio: number): [string, string] => {
  if (!text) return ['', '']
  const want = Math.round(text.length * ratio)
  let best = Math.min(Math.max(want, 1), text.length - 1)
  let bestDist = Infinity
  const scan = Math.max(1, Math.floor(text.length / 5))
  for (let i = Math.max(0, want - scan); i <= Math.min(text.length - 1, want + scan); i++) {
    if (/[\s，。；：、,.;:!？！?]/.test(text[i])) {
      const dist = Math.abs(i - want)
      if (dist < bestDist) {
        bestDist = dist
        best = i + 1 // 切在标点之后
      }
    }
  }
  return [text.slice(0, best), text.slice(best).trim()]
}

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

// 长文档演示流（M5 步 4 的 ?mock&page=doc 用）：两段进度 + 完成事件。
// docDemoDone 同步进快照：演示完成后 chunk 2 落成 done，否则页面的
// allDone（全部 done 才出导出按钮）永远为假，「导入→翻译→导出」走不通。
let docDemoDone = false
function emitDocDemo(docId: string) {
  const total = 12000
  let done = 0
  const timer = setInterval(() => {
    done += 6000
    runtime.EventsEmit('doc:progress', {
      docId,
      charsDone: Math.min(done, total),
      charsTotal: total,
      etaSeconds: Math.max(0, Math.round((total - done) / 50)),
    })
    if (done >= total) {
      clearInterval(timer)
      docDemoDone = true
      runtime.EventsEmit('doc:done', {
        docId,
        coverage: [{ term: '王妃', translation: 'Queen', sourceChunks: 2, hitChunks: 2 }],
      })
    }
  }, 700)
}

const mockDocSnapshot = () => ({
  id: 'mock-doc-1',
  path: 'C:\\docs\\novel.zh.txt',
  direction: 'zh-en',
  chunks: [
    { index: 1, text: '第一章 白狼河……', translated: 'Chapter 1 The White Wolf River…', state: 'done' },
    { index: 2, text: '第二年开春……', translated: docDemoDone ? 'In the spring of the second year…' : '', state: docDemoDone ? 'done' : 'pending' },
  ],
  charsTotal: 12000,
  queueActive: false,
})
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
  GetDownloadLocation: () => ({ path: 'models/', freeBytes: 100 * (1 << 30), known: true }),
  NoteWorkspace: () => undefined,
  ConfirmExit: () => true,
  RevealFile: () => undefined,
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
  WarmDefaultModel: () => undefined,
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
  SaveGlossary: (input: never) => {
    const book = structuredClone(input) as unknown as { id: number; name: string; items: { term: string; translation: string }[] }
    if (!book.id) book.id = Math.max(0, ...glossaryBooks.map(g => g.id)) + 1
    glossaryBooks = [...glossaryBooks.filter(g => g.id !== book.id), book]
    return book.id
  },
  DeleteGlossary: (id: never) => { glossaryBooks = glossaryBooks.filter(g => g.id !== Number(id)) },
  SaveGlossaryCSV: () => 'models/exports/glossary.csv',
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
  SubOpen: () => {
    subDoc = newSubDoc()
    subStyles = newStyles()
    return subSnapshot()
  },
  SubGetDoc: () => subSnapshot(),
  SubTranslate: () => undefined,
  SubPauseQueue: () => undefined,
  SubResumeQueue: () => undefined,
  SubCancelQueue: () => undefined,
  SubRetryFailed: () => undefined,
  SubRetryCues: () => undefined,
  SubExport: () => 'models/exports/mock.srt',
  SubShiftCue: (_id: never, index: never, field: never, delta: never) => {
    const cue = subDoc.cues[Number(index) - 1]
    if (cue && field === 'startMs') cue.startMs = Math.max(0, Math.min(cue.endMs - 1, cue.startMs + Number(delta)))
    if (cue && field === 'endMs') cue.endMs = Math.max(cue.startMs + 1, cue.endMs + Number(delta))
    return subSnapshot()
  },
  SubUndo: () => subSnapshot(),
  /* ── M4 字幕编辑（10 个绑定）。越界/非法入参按当前快照原样返回
        （真实后端走报错路径；mock 保持 resolve，页面不闪退）── */
  SubUpdateCue: (_docId: never, index: never, patch: never) => {
    const c = subDoc.cues[(index as unknown as number) - 1]
    const p = patch as unknown as { startMs?: number; endMs?: number; original?: string; translated?: string; styleName?: string }
    if (c) {
      if (p.startMs !== undefined) c.startMs = p.startMs
      if (p.endMs !== undefined) c.endMs = p.endMs
      if (p.original !== undefined) {
        if (c.state === 'done') c.state = 'pending' // 引擎语义：旧译文不再对应新原文
        c.original = p.original
      }
      if (p.translated !== undefined) c.translated = p.translated
      if (p.styleName !== undefined) c.styleName = p.styleName
    }
    return subSnapshot()
  },
  SubSplitCue: (_docId: never, index: never, atMs: never) => {
    const i = (index as unknown as number) - 1
    const c = subDoc.cues[i]
    const at = atMs as unknown as number
    // 引擎校验：拆分点须在 (start, end) 开区间内
    if (c && at > c.startMs && at < c.endMs) {
      const ratio = (at - c.startMs) / (c.endMs - c.startMs)
      const [o1, o2] = splitText(c.original, ratio)
      const [t1, t2] = splitText(c.translated, ratio)
      const endMs = c.endMs
      c.endMs = at
      c.original = o1
      c.translated = t1
      if (c.state === 'done') c.state = 'pending'
      // 后条继承原样式，在原位后插入并重排（engine.SplitCue 同款）
      subDoc.cues.splice(i + 1, 0, {
        index: i + 2,
        startMs: at,
        endMs,
        original: o2,
        translated: t2,
        styleName: c.styleName,
        state: 'pending',
      })
      reindexSub()
    }
    return subSnapshot()
  },
  SubMergeCues: (_docId: never, fromIndex: never, toIndex: never) => {
    const f = (fromIndex as unknown as number) - 1
    const t = (toIndex as unknown as number) - 1
    // 引擎另要求区间首尾相接（prev.endMs == next.startMs）；
    // 本样例相邻条目间隔 400ms 不相接 —— mock 放宽此项，合并照常发生
    if (f >= 0 && f < t && t < subDoc.cues.length) {
      const first = subDoc.cues[f]
      const origParts: string[] = []
      const tranParts: string[] = []
      for (let k = f; k <= t; k++) {
        const c = subDoc.cues[k]
        origParts.push(c.original)
        if (c.translated) tranParts.push(c.translated)
        if (c.needsCheck) first.needsCheck = true
      }
      first.endMs = subDoc.cues[t].endMs
      first.original = origParts.join(' ')
      first.translated = tranParts.join(' ')
      subDoc.cues.splice(f + 1, t - f)
      reindexSub()
    }
    return subSnapshot()
  },
  SubShiftAll: (_docId: never, deltaMs: never) => {
    const d = deltaMs as unknown as number
    for (const c of subDoc.cues) {
      c.startMs += d
      c.endMs += d
      // 负到 <0 钳到 0 并标 needsCheck（engine.ShiftAll 同款）
      if (c.startMs < 0) {
        c.startMs = 0
        c.needsCheck = true
      }
      if (c.endMs < 0) {
        c.endMs = 0
        c.needsCheck = true
      }
    }
    return subSnapshot()
  },
  SubCalibrate: (_docId: never, anchor1Idx: never, anchor2Idx: never, anchor1Ms: never, anchor2Ms: never) => {
    const a1 = (anchor1Idx as unknown as number) - 1
    const a2 = (anchor2Idx as unknown as number) - 1
    const m1 = anchor1Ms as unknown as number
    const m2 = anchor2Ms as unknown as number
    const cs = subDoc.cues
    if (a1 >= 0 && a1 < cs.length && a2 >= 0 && a2 < cs.length) {
      const old1 = cs[a1].startMs
      const old2 = cs[a2].startMs
      if (old1 === old2) {
        // 两锚点旧时间重合 → 退化为纯平移（engine.Calibrate 同款）
        const offset = m1 - old1
        for (const c of cs) {
          c.startMs += offset
          c.endMs += offset
          if (c.startMs < 0) c.startMs = 0
          if (c.endMs < 0) c.endMs = 0
        }
      } else {
        const scale = (m2 - m1) / (old2 - old1)
        const offset = m1 - old1 * scale
        for (const c of cs) {
          c.startMs = Math.round(c.startMs * scale + offset)
          c.endMs = Math.round(c.endMs * scale + offset)
          if (c.startMs < 0) c.startMs = 0
          if (c.endMs < 0) c.endMs = 0
        }
      }
      // 校准即人工确认时间轴 → needsCheck 全清
      for (const c of cs) c.needsCheck = false
    }
    return subSnapshot()
  },
  SubDeleteCues: (_docId: never, indices: never) => {
    const doomed = new Set((indices as unknown as number[]).filter((i) => i >= 1 && i <= subDoc.cues.length))
    if (doomed.size > 0) {
      subDoc.cues = subDoc.cues.filter((c) => !doomed.has(c.index))
      reindexSub()
    }
    return subSnapshot()
  },
  SubInsertCue: (_docId: never, afterIndex: never) => {
    const after = afterIndex as unknown as number
    // afterIndex=0 表示在开头插入；新条为 2s 空白、state=pending
    if (after >= 0 && after <= subDoc.cues.length) {
      const startMs = after === 0 ? 0 : subDoc.cues[after - 1].endMs
      subDoc.cues.splice(after, 0, {
        index: after + 1,
        startMs,
        endMs: startMs + 2000,
        original: '',
        translated: '',
        state: 'pending',
      })
      reindexSub()
    }
    return subSnapshot()
  },
  SubStyles: () => [...subStyles],
  SubSetStyle: (_docId: never, style: never) => {
    const s = style as unknown as MockStyle
    // 按 Name upsert（engine.SetStyle 同款；Raw 重建是真实后端的事，mock 无 Raw 概念）
    if (s && s.name) {
      const at = subStyles.findIndex((x) => x.name === s.name)
      if (at >= 0) subStyles[at] = { ...subStyles[at], ...s }
      else subStyles = [...subStyles, { ...s }]
    }
    return subSnapshot()
  },
  SubAssignStyle: (_docId: never, indices: never, styleName: never) => {
    const name = styleName as unknown as string
    for (const i of indices as unknown as number[]) {
      const c = subDoc.cues[i - 1]
      if (c) c.styleName = name
    }
    return subSnapshot()
  },
  DocPick: () => ({
    // mock 没有系统文件对话框：固定回一份可读样例，
    // 「导入文档」在 ?mock 下可走完整个流程（导入 → 开始翻译 → 进度 → 导出）
    path: 'C:\\docs\\novel.zh.txt',
    chars: 9876,
    tooLong: false,
    unsupported: false,
  }),
  DocTranslate: (req: never) => {
    const r = req as unknown as { path?: string }
    void r
    docDemoDone = false // 重跑演示时回到「翻译中」快照
    setTimeout(() => emitDocDemo('mock-doc-1'), 100)
    return 'mock-doc-1'
  },
  DocResume: () => undefined,
  DocRestart: () => { docDemoDone = false; setTimeout(() => emitDocDemo('mock-doc-1'), 100) },
  DocCancel: () => undefined,
  DocGetDoc: (docId: never) => ({ ...mockDocSnapshot(), id: (docId as unknown as string) ?? 'mock-doc-1' }),
  DocExport: () => 'models/exports/mock-translation.txt',
  CollectLogs: () => 'logs/mock-bundle.zip',
  ClearLogs: () => ({ removed: 2, skipped: [] }),
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
