// 字幕工作台 P0（01 文档 §6.3）· Track C 迁移版（2026-10-06）
// 导入 / 翻译队列（开始/暂停/取消/重试失败）/ 双语三模式 / 导出（格式+编码）。
// cue 编辑五操作与样式编辑为 M4 范围（F-17/18）。
// Track C 接线：EV.CUE 实时刷新译文列 + 终态后 SubGetDoc 拉权威快照；
// alert 全部下线（toast）。事件订阅走 lib/wails 新事件层。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Hash, Play, Upload } from 'lucide-react'
import { Badge, Button, Segmented } from '../components/ui/index'
import { toast } from '../stores/toastStore'
import { useAppStore } from '../stores/appStore'
import { on, EV } from '../lib/wails'
import {
  apiSubOpen,
  apiSubTranslate,
  apiSubPauseQueue,
  apiSubResumeQueue,
  apiSubCancelQueue,
  apiSubRetryFailed,
  apiSubGetDoc,
  apiSubExport,
} from '../wailsapi'

interface Cue {
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

interface Doc {
  id: string
  path: string
  format: string
  encoding: string
  cues: Cue[]
}

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const STATE_TONE: Record<string, BadgeTone> = {
  done: 'ok',
  translating: 'warn',
  failed: 'danger',
  pending: 'neutral',
  skipped: 'neutral',
}

function tc(ms: number) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`
}

const errToast = (e: unknown) =>
  toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })

export function SubtitleWorkbench({ langs }: { langs: any[] }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [targetLang, setTargetLang] = useState('en')
  const [bilingual, setBilingual] = useState('双语双行')
  const [exportFmt, setExportFmt] = useState('SRT')
  const [queueMsg, setQueueMsg] = useState<string | null>(null)
  const [selIdx, setSelIdx] = useState<number | null>(null)
  // 终态对账：cue 到达终态后去抖拉一次权威快照（队列结束/个别失败的最终文案）
  const reconcileTimer = useRef<number | null>(null)

  const refreshStatus = useAppStore((s) => s.refreshStatus)

  useEffect(() => {
    const off = on(EV.CUE, (p) => {
      const cue = p as { cueIndex?: number; state?: string; offTarget?: boolean; needsCheck?: boolean; translated?: string }
      setDoc((d) => {
        if (!d) return d
        const cues = d.cues.map((c) =>
          c.index === cue.cueIndex
            ? {
                ...c,
                state: cue.state ?? c.state,
                offTarget: cue.offTarget,
                needsCheck: cue.needsCheck,
                translated: cue.translated ?? c.translated,
              }
            : c,
        )
        return { ...d, cues }
      })
      // 终态 → 去抖 1s 对账（SubGetDoc 是权威快照：覆写标签回填等后处理在事件外完成）
      if (cue.state === 'done' || cue.state === 'failed' || cue.state === 'skipped') {
        if (reconcileTimer.current !== null) window.clearTimeout(reconcileTimer.current)
        reconcileTimer.current = window.setTimeout(() => {
          setDoc((cur) => {
            if (cur) apiSubGetDoc(cur.id).then((fresh) => fresh && setDoc(fresh)).catch(() => {})
            return cur
          })
        }, 1000)
      }
    })
    return () => {
      off()
      if (reconcileTimer.current !== null) window.clearTimeout(reconcileTimer.current)
    }
  }, [])

  const doImport = useCallback(async () => {
    try {
      const d = await apiSubOpen()
      if (d) {
        setDoc(d)
        setSelIdx(null)
        setQueueMsg(null)
      }
    } catch (e) {
      errToast(e)
    }
  }, [])

  const queueOpt = { targetLang, bilingual: bilingual === '仅译文' ? 'translation-only' : bilingual === '双语双行' ? 'dual-line' : 'keep-original' }

  const doneCount = doc ? doc.cues.filter((c) => c.state === 'done' || c.state === 'skipped').length : 0

  return (
    <div className="flex flex-col gap-3.5 h-full min-h-0 screen-in">
      {/* 工具栏 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button onClick={doImport}>
          <Upload size={14} /> 导入字幕
        </Button>
        {doc && (
          <Badge tone="accent" dot>
            {doc.path.split(/[\\/]/).pop()} · <span className="num">{doc.cues.length}</span> cues · {doc.format.toUpperCase()}
          </Badge>
        )}
        <Button kind="primary" disabled={!doc} onClick={() => apiSubTranslate(doc!.id, queueOpt).then(refreshStatus).catch(errToast)}>
          <Play size={14} /> 全部翻译
        </Button>
        <Button disabled={!doc} onClick={() => apiSubPauseQueue(doc!.id).catch(errToast)}>
          暂停
        </Button>
        <Button disabled={!doc} onClick={() => apiSubResumeQueue(doc!.id).catch(errToast)}>
          继续
        </Button>
        <Button disabled={!doc} onClick={() => apiSubCancelQueue(doc!.id)}>
          取消
        </Button>
        <Button
          disabled={!doc}
          onClick={() =>
            apiSubRetryFailed(doc!.id, queueOpt).catch((e) => setQueueMsg(String((e as { message?: string })?.message ?? e)))
          }
        >
          重试失败
        </Button>
        <Segmented<string>
          options={['仅译文', '双语双行', '原文另存']}
          value={bilingual}
          aria-label="双语模式"
          onChange={setBilingual}
        />
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          aria-label="目标语言"
          className="bg-sunken border border-line text-ink1 px-2.5 py-1.5 text-caption"
        >
          {langs
            .filter((l) => l.core)
            .map((l) => (
              <option key={l.code} value={l.code}>
                {l.zhName}
              </option>
            ))}
        </select>
        {doc && (
          <Badge tone="ok" dot>
            <span className="num">{doneCount} / {doc.cues.length}</span>
          </Badge>
        )}
        {queueMsg && <Badge tone="danger" dot>{queueMsg}</Badge>}
        <div className="ml-auto flex gap-2.5">
          <Segmented<string>
            options={['SRT', 'ASS', 'VTT', 'LRC']}
            value={exportFmt}
            aria-label="导出格式"
            onChange={setExportFmt}
          />
          <Button
            kind="primary"
            disabled={!doc}
            onClick={() =>
              apiSubExport(doc!.id, {
                format: exportFmt.toLowerCase(),
                encoding: 'utf-8',
                bilingual: bilingual === '仅译文' ? 'translation-only' : bilingual === '双语双行' ? 'dual-line' : 'keep-original',
              }).catch(errToast)
            }
          >
            导出 / 转换
          </Button>
        </div>
      </div>

      {/* 主体 */}
      {!doc ? (
        <div className="flex-1 grid place-items-center bg-surface border border-line">
          <div className="text-center">
            <Clapperboard size={40} strokeWidth={1.5} className="mx-auto mb-3 text-ink3" aria-hidden="true" />
            <div className="text-title text-ink2">导入字幕文件开始翻译</div>
            <div className="text-caption text-ink3 mt-1.5">
              支持 SRT / ASS / VTT / LRC · 自动识别编码（UTF-8 / GBK）· 双语三模式 · 格式转换导出
            </div>
            <div className="mt-4">
              <Button kind="primary" onClick={doImport}>
                <Upload size={14} /> 导入字幕
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid gap-4 min-h-0" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
          {/* cue 表格 */}
          <div className="bg-surface border border-line flex flex-col overflow-hidden min-h-0">
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
              <span className="text-micro uppercase tracking-caps text-ink3">
                字幕条目 · <b className="text-ink2 font-medium">CUES</b>
              </span>
              <span className="num text-micro text-ink3">
                {doc.format.toUpperCase()} → {exportFmt} 转换就绪
              </span>
            </div>
            <div className="grid px-3.5 pt-1.5 pb-2 border-b border-line text-micro tracking-caps text-ink3 uppercase"
              style={{ gridTemplateColumns: '44px 132px 1fr 1fr 96px', gap: 10 }}>
              <span aria-hidden="true"><Hash size={11} strokeWidth={2} /></span>
              <span>起止时间</span>
              <span>原文</span>
              <span>译文</span>
              <span>状态</span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {doc.cues.map((c) => (
                <button
                  type="button"
                  key={c.index}
                  onClick={() => setSelIdx(c.index)}
                  className={`w-full grid px-3.5 py-2.5 border-b border-line text-left cursor-pointer transition-colors duration-150 items-center bg-transparent ${
                    selIdx === c.index ? 'bg-sunken border-l-2 border-l-accent' : 'hover:bg-sunken'
                  }`}
                  style={{ gridTemplateColumns: '44px 132px 1fr 1fr 96px', gap: 10 }}
                >
                  <span className="num text-micro text-ink3">{String(c.index).padStart(4, '0')}</span>
                  <span className="num text-micro text-ink2 whitespace-nowrap">
                    <b className="text-ink1 font-medium">{tc(c.startMs)}</b> → {tc(c.endMs).slice(3)}
                  </span>
                  <span className="text-caption text-ink2 line-clamp-2">{c.original}</span>
                  <span className="text-caption text-ink1 line-clamp-2">{c.translated}</span>
                  <span>
                    <Badge tone={STATE_TONE[c.state] ?? 'neutral'} dot>
                      {c.state}
                      {c.offTarget ? ' · off' : ''}
                      {c.needsCheck ? ' · check' : ''}
                    </Badge>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 右侧：选中 cue 详情 */}
          <div className="bg-surface border border-line p-4 overflow-auto min-h-0">
            {selIdx == null ? (
              <div className="text-caption text-ink3 mt-2">点击左侧条目查看详情</div>
            ) : (
              (() => {
                const c = doc.cues.find((x) => x.index === selIdx)!
                return (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-micro uppercase tracking-caps text-ink3">
                        CUE #<span className="num">{String(c.index).padStart(4, '0')}</span> · 详情
                      </span>
                      <Badge tone="ok">
                        <span className="num">{tc(c.startMs)} → {tc(c.endMs)}</span>
                      </Badge>
                    </div>
                    <div className="bg-sunken p-3 text-body text-ink2 leading-relaxed">{c.original}</div>
                    <div className="bg-sunken p-3 text-body text-ok leading-relaxed min-h-11">
                      {c.translated || <span className="text-ink3">（未翻译）</span>}
                    </div>
                    {c.needsCheck && (
                      <Badge tone="warn" dot>
                        覆写标签回填失败，需人工检查
                      </Badge>
                    )}
                    {c.styleName && (
                      <div className="text-caption text-ink3">
                        样式: <span className="text-ink2">{c.styleName}</span>（样式编辑为 M4 范围）
                      </div>
                    )}
                  </div>
                )
              })()
            )}
          </div>
        </div>
      )}
    </div>
  )
}
