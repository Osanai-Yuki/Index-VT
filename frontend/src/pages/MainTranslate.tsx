// 主翻译台（01 文档 §6.2）· Track C 迁移版（2026-10-06）
// 新设计系统组合（Badge/Button/Drawer/Field/Switch/Textarea）+ 瑞士风格 token +
// R17 错误态保留部分译文 + 收藏历史（PRD S2）+ 约束抽屉五字段（真实 Constraints）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeftRight, Check, ClipboardPaste, Copy, Eraser, Info, RotateCcw, SlidersHorizontal, Star, Trash2 } from 'lucide-react'
import { Badge, Button, Drawer, Field, IconButton, Switch, Textarea } from '../components/ui/index'
import { on, EV } from '../lib/wails'
import { allModes, MANUAL_CUSTOM_ID, useModeStore, type ModeConstraints, type ModePreset } from '../lib/modes'
import { ModeDetails } from '../components/ModeDetails'
import { LangSelect, Lang } from '../LangSelect'
import { useAppStore } from '../stores/appStore'
import {
  apiTranslate,
  apiCancelTask,
  apiListHistory,
  apiSearchHistory,
  apiDeleteHistory,
  apiStarHistory,
  apiListGlossaries,
} from '../wailsapi'

interface HistItem {
  id: number
  createdAt: number
  sourceLang: string
  targetLang: string
  sourceText: string
  output: string
  mode: string
  starred: boolean
}

interface Glossary {
  id: number
  name: string
  items: { term: string; translation: string }[]
}

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

interface ConstraintState {
  glossaryId: number
  hard: string
  soft: string
  genre: string
  jsonPreserve: boolean
}

const lines = (s: string): string[] =>
  s.split('\n').map((l) => l.trim()).filter(Boolean)

export function MainTranslate({ langs }: { langs: Lang[] }) {
  const orchState = useAppStore((s) => s.orchState)
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('en')
  const [recent, setRecent] = useState<string[]>(['ja', 'es', 'ko'])
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  // 约束模板详情（只读弹窗；跟随下拉当前所选）
  const [modeDetail, setModeDetail] = useState<ModePreset | null>(null)
  const [metrics, setMetrics] = useState<{ tokPerSec?: number; firstTokenMs?: number }>({})
  const [offTarget, setOffTarget] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState<string>('')
  const [history, setHistory] = useState<HistItem[]>([])
  const [search, setSearch] = useState('')
  const [curHistId, setCurHistId] = useState<number | null>(null)
  // 复制反馈：刚复制成功的按钮短暂显示 Check 线性图标，1.5s 后还原
  const [copied, setCopied] = useState<'output' | 'both' | null>(null)
  const copiedTimer = useRef<number | null>(null)
  // 约束抽屉（真实 Constraints 五字段：Glossary / Hard / Soft / Genre / JSONPreserve）
  const [consOpen, setConsOpen] = useState(false)
  const [glossaries, setGlossaries] = useState<Glossary[]>([])
  const [cons, setCons] = useState<ConstraintState>({
    glossaryId: 0, hard: '', soft: '', genre: '', jsonPreserve: false,
  })
  // 翻译模式（领域模板）：切换即整套预填；手动改任一约束字段自动落到"自定义"档
  const [modeId, setModeId] = useState('standard')
  // 配音模式（ADR-004：ModeDubbing → Index-Homura-2B，音节预算翻译；01 文档 §6.2）
  const [dubbing, setDubbing] = useState(false)
  const [syllables, setSyllables] = useState(7) // 默认取 F-07 验收用例值
  const [syl, setSyl] = useState<{ target: number; actual: number } | null>(null)
  const customModes = useModeStore((s) => s.customModes)
  const modeOptions = allModes(customModes)
  const activeModeDesc =
    modeId === MANUAL_CUSTOM_ID
      ? '自定义：手动调整的约束（自动记住最近一份）'
      : (modeOptions.find((m) => m.id === modeId)?.description ?? '')
  const outRef = useRef<HTMLDivElement>(null)
  const wakeHint = orchState !== 'running' && (phase === 'loading' || phase === 'streaming')

  const refreshHistory = useCallback(async () => {
    try {
      const list = search.trim() ? await apiSearchHistory(search) : await apiListHistory(1)
      setHistory(list ?? [])
    } catch {
      /* runtime 不可用 */
    }
  }, [search])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // 流式事件订阅（新事件层：早到缓冲 + 退订隔离）
  useEffect(() => {
    const offDelta = on(EV.DELTA, (d) => {
      const delta = d as { taskId?: string; text?: string }
      if (delta.taskId !== taskId) return
      setOutput((prev) => prev + (delta.text ?? ''))
      setPhase((p) => (p === 'loading' ? 'streaming' : p))
    })
    const offDone = on(EV.DONE, (d) => {
      const done = d as { taskId?: string; error?: string; canceled?: boolean; output?: string; tokPerSec?: number; firstTokenMs?: number; offTarget?: boolean; targetSyllables?: number; actualSyllables?: number }
      if (done.taskId !== taskId) return
      setTaskId(null)
      if (done.error && !done.canceled) {
        // R17：错误分支也带已产出的部分译文（后端 app.go error 分支附带 output）
        if (done.output) setOutput(done.output)
        setError(done.error)
        setPhase('error')
        return
      }
      if (done.canceled) {
        setPhase('idle')
        setOutput('')
        return
      }
      setOutput(done.output ?? '')
      setMetrics({ tokPerSec: done.tokPerSec, firstTokenMs: done.firstTokenMs })
      setOffTarget(!!done.offTarget)
      // 配音模式回显「目标 N / 实测 M」：后端仅在 dubbing 时发非零 targetSyllables
      setSyl(done.targetSyllables ? { target: done.targetSyllables, actual: done.actualSyllables ?? 0 } : null)
      setPhase('done')
      refreshHistory()
    })
    return () => {
      offDelta()
      offDone()
    }
  }, [taskId, refreshHistory])

  // 输出区滚动跟随
  useEffect(() => {
    if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight
  }, [output])

  const doTranslate = useCallback(() => {
    const text = input.trim()
    if (!text || taskId) return
    setOutput('')
    setError(null)
    setOffTarget(false)
    setMetrics({})
    setSyl(null)
    setPhase('loading')
    apiTranslate({
      sourceLang: sourceLang,
      targetLang,
      text,
      hard: lines(cons.hard),
      soft: lines(cons.soft),
      genre: cons.genre.trim() || undefined,
      jsonPreserve: cons.jsonPreserve || undefined,
      glossaryId: cons.glossaryId || undefined,
      dubbing: dubbing || undefined,
      syllables: dubbing ? syllables : undefined,
    })
      .then((h) => {
        setTaskId(h.taskId)
        if (sourceLang === 'auto') setDetected('…')
        setRecent((r) => [targetLang, ...r.filter((c) => c !== targetLang)].slice(0, 3))
      })
      .catch((e) => {
        setError(String(e?.message ?? e))
        setPhase('error')
      })
  }, [input, sourceLang, targetLang, taskId, cons, dubbing, syllables])

  // Ctrl+Enter 翻译 / Esc 取消 / Ctrl+Shift+C 复制译文
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault()
        doTranslate()
      } else if (e.key === 'Escape' && taskId) {
        e.preventDefault()
        apiCancelTask(taskId).catch(() => {})
        setTaskId(null)
        setPhase('idle')
      } else if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault()
        navigator.clipboard.writeText(output).catch(() => {})
        markCopied('output')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doTranslate, taskId, output])

  // 复制成功反馈：Check 图标闪现 1.5s
  const markCopied = (which: 'output' | 'both') => {
    setCopied(which)
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1500)
  }
  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])

  const copyOutput = () => {
    navigator.clipboard.writeText(output).catch(() => {})
    markCopied('output')
  }

  // 复制原文与译文（一个按钮，两段一起进剪贴板，空行分隔）
  const dualCopy = () => {
    navigator.clipboard.writeText(`${input}\n${output}`).catch(() => {})
    markCopied('both')
  }

  const openCons = () => {
    setConsOpen(true)
    apiListGlossaries().then((gs) => setGlossaries(gs ?? [])).catch(() => {})
  }

  // 模式 → 约束整套预填（术语本不随模式重置，属术语本自身的选择）
  const applyMode = (id: string) => {
    setModeId(id)
    const source: ModeConstraints =
      id === MANUAL_CUSTOM_ID
        ? useModeStore.getState().lastCustom
        : (modeOptions.find((m) => m.id === id)?.constraints ?? { hard: [], soft: [], genre: '', jsonPreserve: false })
    setCons((c) => ({
      glossaryId: c.glossaryId,
      hard: source.hard.join('\n'),
      soft: source.soft.join('\n'),
      genre: source.genre,
      jsonPreserve: source.jsonPreserve,
    }))
  }

  // 抽屉内手动编辑 → 自动落到"自定义"档并记住（术语本选择除外）
  const editCons = (patch: Partial<ConstraintState>) => {
    const next = { ...cons, ...patch }
    setCons(next)
    if (modeId !== MANUAL_CUSTOM_ID) setModeId(MANUAL_CUSTOM_ID)
    useModeStore.getState().setLastCustom({
      hard: lines(next.hard),
      soft: lines(next.soft),
      genre: next.genre,
      jsonPreserve: next.jsonPreserve,
    })
  }

  const swap = () => {
    if (sourceLang === 'auto') return
    const s = sourceLang
    setSourceLang(targetLang)
    setTargetLang(s)
    if (output) {
      const t = input
      setInput(output)
      setOutput(t)
    }
  }

  const toggleStar = (h: HistItem) => {
    apiStarHistory(h.id, !h.starred)
      .then(refreshHistory)
      .catch(() => {})
  }

  const openHist = (h: HistItem) => {
    setCurHistId(h.id)
    setInput(h.sourceText)
    setOutput(h.output)
    setSourceLang(h.sourceLang || 'auto')
    setTargetLang(h.targetLang)
    setPhase('done')
  }

  const histGroups = useMemo(() => {
    const today: HistItem[] = []
    const yesterday: HistItem[] = []
    const earlier: HistItem[] = []
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    for (const h of history) {
      const t = h.createdAt * 1000
      if (t >= startOfDay) today.push(h)
      else if (t >= startOfDay - 86400000) yesterday.push(h)
      else earlier.push(h)
    }
    return { today, yesterday, earlier }
  }, [history])

  return (
    <div className="grid gap-5 h-full" style={{ gridTemplateColumns: '236px 1fr' }}>
      {/* 历史侧栏 */}
      <div className="bg-surface border border-line flex flex-col overflow-hidden min-h-0">
        <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between">
          <span className="text-micro uppercase tracking-caps text-ink3">
            历史记录 · <b className="text-ink2 font-medium">HISTORY</b>
          </span>
        </div>
        <div className="mx-3 mb-2.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索历史…"
            className="w-full bg-sunken border border-line px-3 py-1.5 text-caption text-ink1 focus:border-accent"
          />
        </div>
        <ul className="flex-1 overflow-auto px-2 pb-3 list-none min-h-0">
          {(['today', 'yesterday', 'earlier'] as const).map((g) =>
            histGroups[g].length > 0 ? (
              <li key={g} className="mb-1">
                <div className="text-micro uppercase tracking-caps text-ink3 px-2 py-1">
                  {g === 'today' ? '今天' : g === 'yesterday' ? '昨天' : '更早'}
                </div>
                {histGroups[g].map((h) => (
                  <div
                    key={h.id}
                    className={`mb-1 border transition-colors duration-150 ${
                      curHistId === h.id ? 'bg-sunken border-lineStrong' : 'border-transparent hover:bg-sunken'
                    }`}
                  >
                    <div className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => openHist(h)}
                        className="flex-1 min-w-0 text-left px-2.5 pt-2.5 pb-2 bg-transparent border-0 p-0 cursor-pointer"
                      >
                        <span className="text-body text-ink1 line-clamp-1" title={h.sourceText}>{h.sourceText}</span>
                        <span className="text-micro text-ink3 mt-0.5 line-clamp-1" title={h.output}>{h.output}</span>
                        <span className="flex gap-2 mt-1.5 text-micro text-ink3 tracking-wide">
                          <span>
                            {h.sourceLang === 'auto' ? 'auto' : h.sourceLang} → {h.targetLang}
                          </span>
                          <span className="num">
                            {new Date(h.createdAt * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </button>
                      <div className="flex flex-col justify-center gap-1.5 pr-2">
                        <button
                          type="button"
                          title={h.starred ? '取消收藏' : '收藏'}
                          aria-label={h.starred ? '取消收藏' : '收藏'}
                          onClick={(e) => { e.stopPropagation(); toggleStar(h) }}
                          className="bg-transparent border-0 p-0 cursor-pointer"
                        >
                          <Star
                            size={11}
                            strokeWidth={h.starred ? 2.5 : 1.8}
                            className={h.starred ? 'text-accent' : 'text-ink3 hover:text-ink1'}
                          />
                        </button>
                        <button
                          type="button"
                          title="删除"
                          aria-label="删除历史"
                          onClick={(e) => {
                            e.stopPropagation()
                            apiDeleteHistory(h.id).then(refreshHistory)
                          }}
                          className="bg-transparent border-0 p-0 cursor-pointer text-ink3 hover:text-danger"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </li>
            ) : null,
          )}
          {history.length === 0 && (
            <li className="text-caption text-ink3 px-2 py-4">暂无记录，翻译后自动保存到本机</li>
          )}
        </ul>
      </div>

      {/* 中央双栏 */}
      <div className="flex flex-col gap-3 min-w-0 min-h-0">
        {/* 语言栏 */}
        <div className="flex items-center gap-3">
          <LangSelect
            langs={langs}
            value={sourceLang}
            onChange={setSourceLang}
            isSource
            detected={detected || undefined}
            recent={recent}
          />
          <button
            type="button"
            title="交换源/目标语言"
            onClick={swap}
            className={`w-9 h-9 border border-lineStrong text-ink2 grid place-items-center cursor-pointer transition-colors duration-150 hover:border-accent hover:text-accent ${
              sourceLang === 'auto' ? 'opacity-50' : ''
            }`}
          >
            <ArrowLeftRight size={15} strokeWidth={2} />
          </button>
          <LangSelect langs={langs} value={targetLang} onChange={setTargetLang} isSource={false} recent={recent} />
          <IconButton icon={<SlidersHorizontal size={15} strokeWidth={2} />} label="翻译约束" onClick={openCons} />
          {/* 翻译模式：领域约束模板下拉（自定义模式在设置页管理） */}
          <label className="flex items-center gap-2 shrink-0 whitespace-nowrap" title={activeModeDesc}>
            <span className="text-micro uppercase tracking-caps text-ink3">模式</span>
            <select
              value={modeId}
              onChange={(e) => applyMode(e.target.value)}
              aria-label="翻译模式"
              className="h-(--suj-h-control) bg-sunken border border-line px-2.5 text-body text-ink1"
            >
              {modeOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={MANUAL_CUSTOM_ID}>自定义</option>
            </select>
          </label>
          <IconButton
            icon={<Info size={15} strokeWidth={2} />}
            label="查看当前模式详情"
            onClick={() => setModeDetail(modeOptions.find((m) => m.id === modeId) ?? null)}
          />
          {/* 配音模式（F-07）：ModeDubbing → Index-Homura-2B，音节预算翻译（01 文档 §6.2） */}
          <label className="flex items-center gap-2 shrink-0 whitespace-nowrap pl-1">
            <span className="text-micro uppercase tracking-caps text-ink3">配音</span>
            <Switch checked={dubbing} onChange={setDubbing} label="配音模式" srOnly />
          </label>
          {dubbing && (
            <label className="flex items-center gap-2 shrink-0 whitespace-nowrap" title="译文音节预算（配音时长对齐；2B 为近似达标，偏差大可重新生成）">
              <span className="text-micro uppercase tracking-caps text-ink3">音节</span>
              <input
                type="number"
                aria-label="目标音节数"
                min={1}
                max={99}
                step={1}
                value={syllables}
                onChange={(e) => {
                  const n = e.target.valueAsNumber
                  if (!Number.isNaN(n)) setSyllables(Math.round(n))
                }}
                className="num h-(--suj-h-control) w-16 bg-sunken border border-line px-2.5 text-right text-body text-ink1"
              />
            </label>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0 whitespace-nowrap">
            {dubbing && (
              <Badge tone="accent" dot title="配音模式：本次翻译由 Index-Homura-2B 执行（音节预算）">
                配音 · Index-Homura-2B
              </Badge>
            )}
            <Badge tone={orchState === 'running' ? 'ok' : 'neutral'} dot>
              模型：{orchState === 'running' ? '运行中' : orchState === 'idle' ? '休眠' : orchState}
            </Badge>
            <span className="text-micro uppercase tracking-caps text-ink3">Ctrl+Enter 触发 · ESC 取消</span>
          </div>
        </div>

        {/* 约束抽屉（真实 Constraints：Glossary / Hard / Soft / Genre / JSONPreserve） */}
        <Drawer open={consOpen} onClose={() => setConsOpen(false)} title="翻译约束" width={420}>
          <div className="flex flex-col gap-5">
            {dubbing && (
              <p className="text-caption text-ink3">
                配音模式（Index-Homura-2B）仅术语本与目标音节数生效；硬/软约束与文体域属于
                Translate 模型的普通翻译档，字段值会保留，切回普通模式即恢复生效。
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-body text-ink2">
              术语本
              <select
                value={cons.glossaryId}
                onChange={(e) => setCons({ ...cons, glossaryId: Number(e.target.value) })}
                className="h-(--suj-h-control) bg-sunken border border-line px-2.5 text-body text-ink1"
              >
                <option value={0}>不使用</option>
                {glossaries.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}（{g.items?.length ?? 0} 条）
                  </option>
                ))}
              </select>
            </label>
            <Textarea
              label="硬约束（每行一条，译文必须遵守）"
              rows={4}
              value={cons.hard}
              onChange={(e) => editCons({ hard: e.target.value })}
              placeholder={'例如：\n专有名词保留原文\n数字一律用阿拉伯数字'}
            />
            <Textarea
              label="软约束（每行一条，风格倾向）"
              rows={4}
              value={cons.soft}
              onChange={(e) => editCons({ soft: e.target.value })}
              placeholder="例如：口吻简洁，避免长句"
            />
            <Field
              label="文体域"
              value={cons.genre}
              onChange={(e) => editCons({ genre: e.target.value })}
              placeholder="文本"
            />
            <Switch
              checked={cons.jsonPreserve}
              onChange={(v) => editCons({ jsonPreserve: v })}
              label="JSON 保序（输入为 JSON dict 时保留键结构）"
            />
          </div>
        </Drawer>

        {/* 双栏编辑器 */}
        <div className="relative flex-1 grid grid-cols-2 bg-surface border border-line min-h-0">
          <span className="absolute left-1/2 top-3 bottom-3 w-px bg-lineStrong" />
          {/* 源文 */}
          <div className="flex flex-col overflow-hidden min-h-0">
            <div className="px-5 pt-3 pb-2 flex items-center gap-2.5">
              <span className="text-micro uppercase tracking-caps text-ink3">
                源文 · <b className="text-ink2 font-medium">SOURCE</b>
              </span>
              <span className="ml-auto num text-micro text-ink3">
                {input.length} / 8000
              </span>
            </div>
            <textarea
              spellCheck={false}
              value={input}
              maxLength={8000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要翻译的文本…"
              className="flex-1 resize-none bg-transparent border-0 text-ink1 text-read px-5 pb-4"
            />
            {/* pt-5 而非 pt-4：textarea 的 :focus-visible 轮廓（2px offset + 2px 宽）
                会吃掉 4px，补回来才与 pb-4 的下方间距等视觉（实测 16 / 17）。 */}
            <div className="flex gap-2 px-5 pt-5 pb-4">
              <Button kind="ghost" onClick={() => { setInput(''); setOutput(''); setPhase('idle') }}>
                <Eraser size={14} strokeWidth={2} />
                清空
              </Button>
              <Button kind="ghost" onClick={() => navigator.clipboard.readText().then(setInput).catch(() => {})}>
                <ClipboardPaste size={14} strokeWidth={2} />
                粘贴
              </Button>
            </div>
          </div>
          {/* 译文 */}
          <div className="flex flex-col overflow-hidden min-h-0 border-l border-lineStrong">
            <div className="px-5 pt-3 pb-2 flex items-center gap-2.5">
              <span className="text-micro uppercase tracking-caps text-ink3">
                译文 · <b className="text-ink2 font-medium">OUTPUT</b>
              </span>
              {offTarget && (
                <Badge tone="danger" dot title="输出语言可能不是目标语言（2B 模型低资源语言 off-target 率 4.2%）">
                  <AlertTriangle size={10} /> off-target
                </Badge>
              )}
              {phase === 'done' && metrics.tokPerSec ? (
                <Badge tone="ok" dot>
                  {metrics.tokPerSec.toFixed(1)} tok/s · TTFT {((metrics.firstTokenMs ?? 0) / 1000).toFixed(2)}s
                </Badge>
              ) : null}
              {dubbing && syl && phase === 'done' && (
                <Badge tone="neutral" dot title="2B 音节控制为近似达标；偏差大可重新生成（temperature 0.3 产出不同表述）">
                  目标 {syl.target} / 实测 {syl.actual}
                </Badge>
              )}
            </div>
            <div ref={outRef} className="flex-1 overflow-auto px-5 pb-4">
              {phase === 'error' && (
                <div className="text-caption text-danger mb-2">{error}</div>
              )}
              {phase === 'loading' && !output && (
                <div className="text-body text-ink3 mt-1">
                  {wakeHint ? '模型唤醒中…（首次加载约 10 秒）' : '翻译中…'}
                </div>
              )}
              {/* R17：错误态保留已产出的部分译文 */}
              <div className="text-read text-ink1 whitespace-pre-wrap break-words">
                {output}
                {(phase === 'streaming' || (phase === 'loading' && output)) && <span className="caret" />}
              </div>
            </div>
            <div className="flex gap-2 px-5 pt-5 pb-4 items-center flex-wrap">
              <Button kind="primary" onClick={copyOutput} disabled={!output}>
                {copied === 'output' ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
                {copied === 'output' ? '已复制' : '复制译文'}
              </Button>
              <Button onClick={dualCopy} disabled={!output}>
                {copied === 'both' ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
                {copied === 'both' ? '已复制' : '复制原文与译文'}
              </Button>
              <Button onClick={doTranslate} disabled={!input.trim() || !!taskId} arrow>
                <RotateCcw size={14} /> {dubbing ? '重新生成' : '重新翻译'}
              </Button>
              {taskId && (
                <Button
                  kind="danger"
                  onClick={() => {
                    apiCancelTask(taskId).catch(() => {})
                    setTaskId(null)
                    setPhase('idle')
                  }}
                >
                  取消
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ModeDetails preset={modeDetail} open={modeDetail !== null} onClose={() => setModeDetail(null)} />
    </div>
  )
}
