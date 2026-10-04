// 主翻译台（01 文档 §6.2 / mockups 屏 1）：双栏即输即译 + 流式打字机 +
// 历史侧栏 + off-target 徽标 + 快捷键。约束抽屉与配音模式为 M3 范围。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Copy, RotateCcw, Star, Trash2, AlertTriangle } from 'lucide-react'
import { Chip, Btn } from '../components/ui'
import { LangSelect, Lang } from '../LangSelect'
import { useAppStore } from '../stores/appStore'
import {
  apiTranslate,
  apiCancelTask,
  apiListHistory,
  apiSearchHistory,
  apiDeleteHistory,
  eventsOn,
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

type Phase = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

export function MainTranslate({ langs }: { langs: Lang[] }) {
  const orchState = useAppStore((s) => s.orchState)
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('en')
  const [recent, setRecent] = useState<string[]>(['ja', 'es', 'ko'])
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [taskId, setTaskId] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<{ tokPerSec?: number; firstTokenMs?: number }>({})
  const [offTarget, setOffTarget] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState<string>('')
  const [history, setHistory] = useState<HistItem[]>([])
  const [search, setSearch] = useState('')
  const [curHistId, setCurHistId] = useState<number | null>(null)
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

  // 流式事件订阅
  useEffect(() => {
    const offDelta = eventsOn('translate:delta', (d: any) => {
      if (d.taskId !== taskId) return
      setOutput((prev) => prev + d.text)
      setPhase((p) => (p === 'loading' ? 'streaming' : p))
    })
    const offDone = eventsOn('translate:done', (d: any) => {
      if (d.taskId !== taskId) return
      setTaskId(null)
      if (d.error && !d.canceled) {
        setError(d.error)
        setPhase('error')
        return
      }
      if (d.canceled) {
        setPhase('idle')
        setOutput('')
        return
      }
      setOutput(d.output ?? '')
      setMetrics({ tokPerSec: d.tokPerSec, firstTokenMs: d.firstTokenMs })
      setOffTarget(!!d.offTarget)
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
    setPhase('loading')
    apiTranslate({
      sourceLang: sourceLang,
      targetLang,
      text,
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
  }, [input, sourceLang, targetLang, taskId])

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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doTranslate, taskId, output])

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

  const dualCopy = () => {
    navigator.clipboard.writeText(`${input}\n${output}`).catch(() => {})
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
    <div className="grid gap-4 h-full" style={{ gridTemplateColumns: '236px 1fr' }}>
      {/* 历史侧栏 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] flex flex-col overflow-hidden min-h-0">
        <div className="px-4 pt-3.5 pb-2.5 flex items-center justify-between">
          <span className="label">
            历史记录 · <b>HISTORY</b>
          </span>
        </div>
        <div className="mx-3 mb-2.5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索历史…"
            className="flex-1 w-full bg-bg-3 border border-hairline rounded-lg px-3 py-1.5 text-[12.5px] text-ink-1 outline-none focus:border-accent-line"
          />
        </div>
        <ul className="flex-1 overflow-auto px-2 pb-3 list-none min-h-0">
          {(['today', 'yesterday', 'earlier'] as const).map((g) =>
            histGroups[g].length > 0 ? (
              <li key={g} className="mb-1">
                <div className="label px-2 py-1">
                  {g === 'today' ? '今天' : g === 'yesterday' ? '昨天' : '更早'}
                </div>
                {histGroups[g].map((h) => (
                  <div
                    key={h.id}
                    onClick={() => openHist(h)}
                    className={`px-2.5 pt-2.5 pb-2 rounded-lg cursor-pointer transition-colors border ${
                      curHistId === h.id ? 'bg-bg-2 border-hairline-2' : 'border-transparent hover:bg-bg-2'
                    }`}
                  >
                    <div className="text-[12.5px] text-ink-1 line-clamp-1">{h.sourceText}</div>
                    <div className="text-[11.5px] text-ink-3 mt-0.5 line-clamp-1">{h.output}</div>
                    <div className="flex gap-2 mt-1.5 font-mono text-[9.5px] text-ink-3 tracking-wide">
                      <span>
                        {h.sourceLang === 'auto' ? 'auto' : h.sourceLang} → {h.targetLang}
                      </span>
                      <span>{new Date(h.createdAt * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                      {/* TODO(TrackC): 收藏动作缺失——apiStarHistory 绑定已存在但从未接线，
                          此处仅展示 h.starred。接收藏按钮时重新导入 apiStarHistory（PRD S2）。 */}
                      {h.starred && <Star size={10} className="text-accent" />}
                      <span
                        className="ml-auto hover:text-danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          apiDeleteHistory(h.id).then(refreshHistory)
                        }}
                      >
                        <Trash2 size={11} />
                      </span>
                    </div>
                  </div>
                ))}
              </li>
            ) : null,
          )}
          {history.length === 0 && (
            <li className="text-xs text-ink-3 px-2 py-4">暂无记录，翻译后自动保存到本机</li>
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
            title="交换源/目标语言"
            onClick={swap}
            className={`w-[34px] h-[34px] rounded-full border border-accent-line bg-accent-soft text-accent grid place-items-center cursor-pointer transition-all hover:bg-accent hover:text-bg-0 ${
              sourceLang === 'auto' ? 'opacity-50' : ''
            }`}
          >
            <ArrowLeftRight size={15} strokeWidth={2} />
          </button>
          <LangSelect langs={langs} value={targetLang} onChange={setTargetLang} isSource={false} recent={recent} />
          <div className="ml-auto flex items-center gap-2">
            <Chip tone="amber" dot>
              模型：{orchState === 'running' ? '运行中' : orchState === 'idle' ? '休眠' : orchState}
            </Chip>
            <span className="label">Ctrl+Enter 触发 · ESC 取消</span>
          </div>
        </div>

        {/* 双栏编辑器 */}
        <div className="relative flex-1 grid grid-cols-2 bg-bg-1 border border-hairline rounded-[14px] shadow-[var(--shadow-1)] min-h-0">
          <span className="absolute left-1/2 top-3 bottom-3 w-px dual-divider" />
          {/* 源文 */}
          <div className="flex flex-col overflow-hidden min-h-0">
            <div className="px-4 pt-3 pb-2 flex items-center gap-2.5">
              <span className="label">
                源文 · <b>SOURCE</b>
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-ink-3">
                {input.length} / 8000
              </span>
            </div>
            <textarea
              spellCheck={false}
              value={input}
              maxLength={8000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要翻译的文本…"
              className="flex-1 resize-none bg-transparent border-0 outline-none text-ink-1 text-[15.5px] leading-[1.9] px-4.5 pb-4 font-cjk px-4"
            />
            <div className="flex gap-2 px-4 pb-3.5">
              <Btn kind="ghost" onClick={() => { setInput(''); setOutput(''); setPhase('idle') }}>
                清空
              </Btn>
              <Btn kind="ghost" onClick={() => navigator.clipboard.readText().then(setInput).catch(() => {})}>
                粘贴
              </Btn>
            </div>
          </div>
          {/* 译文 */}
          <div
            className="flex flex-col overflow-hidden min-h-0 rounded-r-[14px]"
            style={{ background: 'linear-gradient(180deg,rgba(79,214,190,.045),transparent 30%), var(--bg-1)' }}
          >
            <div className="px-4 pt-3 pb-2 flex items-center gap-2.5">
              <span className="label">
                译文 · <b>OUTPUT</b>
              </span>
              {offTarget && (
                <Chip tone="danger" dot title="输出语言可能不是目标语言（2B 模型低资源语言 off-target 率 4.2%）">
                  <AlertTriangle size={10} /> off-target
                </Chip>
              )}
              {phase === 'done' && metrics.tokPerSec ? (
                <Chip tone="on" dot>
                  {metrics.tokPerSec.toFixed(1)} tok/s · TTFT {((metrics.firstTokenMs ?? 0) / 1000).toFixed(2)}s
                </Chip>
              ) : null}
            </div>
            <div ref={outRef} className="flex-1 overflow-auto px-4 pb-4">
              {phase === 'loading' && !output && (
                <div className="text-ink-3 text-[13px] mt-1">
                  {wakeHint ? '模型唤醒中…（首次加载约 10 秒）' : '翻译中…'}
                </div>
              )}
              {phase === 'error' ? (
                <div className="text-danger text-[13px] mt-1">{error}</div>
              ) : (
                <div className="text-[15.5px] leading-[1.9] text-ink-1 whitespace-pre-wrap break-words">
                  {output}
                  {(phase === 'streaming' || (phase === 'loading' && output)) && <span className="caret" />}
                </div>
              )}
            </div>
            <div className="flex gap-2 px-4 pb-3.5 items-center flex-wrap">
              <Btn kind="primary" onClick={() => navigator.clipboard.writeText(output).catch(() => {})} disabled={!output}>
                <Copy size={14} strokeWidth={2} /> 复制译文
              </Btn>
              <Btn onClick={dualCopy} disabled={!output}>
                复制对照
              </Btn>
              <Btn onClick={doTranslate} disabled={!input.trim() || !!taskId}>
                <RotateCcw size={14} /> 重新翻译
              </Btn>
              {taskId && (
                <Btn
                  kind="danger"
                  onClick={() => {
                    apiCancelTask(taskId).catch(() => {})
                    setTaskId(null)
                    setPhase('idle')
                  }}
                >
                  取消
                </Btn>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
