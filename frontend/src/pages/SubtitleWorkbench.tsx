// 字幕工作台 P0（01 文档 §6.3 / mockups 屏 2）：
// 导入 / 翻译队列（开始/暂停/取消/重试失败）/ 双语三模式 / 导出（格式+编码）。
// cue 编辑五操作与样式编辑为 M4 范围（F-17/18）。
import { useCallback, useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { Btn, Chip, Seg } from '../components/ui'
import { useAppStore } from '../stores/appStore'
import {
  apiSubOpen,
  apiSubTranslate,
  apiSubPauseQueue,
  apiSubResumeQueue,
  apiSubCancelQueue,
  apiSubRetryFailed,
  apiSubExport,
  eventsOn,
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

const STATE_TONE: Record<string, 'on' | 'amber' | 'warn' | 'blue' | 'danger' | 'default'> = {
  done: 'on',
  translating: 'amber',
  failed: 'danger',
  pending: 'default',
  skipped: 'default',
}

function tc(ms: number) {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`
}

export function SubtitleWorkbench({ langs }: { langs: any[] }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [targetLang, setTargetLang] = useState('en')
  const [bilingual, setBilingual] = useState('双语双行')
  const [exportFmt, setExportFmt] = useState('SRT')
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [queueMsg, setQueueMsg] = useState<string | null>(null)
  const [selIdx, setSelIdx] = useState<number | null>(null)

  const refreshStatus = useAppStore((s) => s.refreshStatus)

  useEffect(() => {
    const off = eventsOn('subtitle:cue', (p: any) => {
      setProgress({ done: p.done, total: p.total })
      setDoc((d) =>
        d
          ? {
              ...d,
              cues: d.cues.map((c) =>
                c.index === p.cueIndex
                  ? { ...c, state: p.state, offTarget: p.offTarget, needsCheck: p.needsCheck }
                  : c,
              ),
            }
          : d,
      )
    })
    return off
  }, [])

  const doImport = useCallback(async () => {
    try {
      const d = await apiSubOpen()
      if (d) {
        setDoc(d)
        setSelIdx(null)
        setProgress({ done: 0, total: 0 })
        setQueueMsg(null)
      }
    } catch (e) {
      alert(String(e))
    }
  }, [])

  const queueOpt = { targetLang, bilingual: bilingual === '仅译文' ? 'translation-only' : bilingual === '双语双行' ? 'dual-line' : 'keep-original' }

  const doneCount = doc ? doc.cues.filter((c) => c.state === 'done' || c.state === 'skipped').length : 0

  return (
    <div className="flex flex-col gap-3.5 h-full min-h-0 screen-in">
      {/* 工具栏 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Btn onClick={doImport}>
          <Upload size={14} /> 导入字幕
        </Btn>
        {doc && (
          <Chip tone="blue" dot>
            {doc.path.split(/[\\/]/).pop()} · {doc.cues.length} cues · {doc.format.toUpperCase()}
          </Chip>
        )}
        <Btn kind="primary" disabled={!doc} onClick={() => apiSubTranslate(doc!.id, queueOpt).then(refreshStatus).catch((e) => alert(e))}>
          ▶ 全部翻译
        </Btn>
        <Btn disabled={!doc} onClick={() => apiSubPauseQueue(doc!.id).catch((e) => alert(e))}>
          暂停
        </Btn>
        <Btn disabled={!doc} onClick={() => apiSubResumeQueue(doc!.id).catch((e) => alert(e))}>
          继续
        </Btn>
        <Btn disabled={!doc} onClick={() => apiSubCancelQueue(doc!.id)}>
          取消
        </Btn>
        <Btn
          disabled={!doc}
          onClick={() =>
            apiSubRetryFailed(doc!.id, queueOpt)
              .catch((e) => setQueueMsg(String(e)))
          }
        >
          重试失败
        </Btn>
        <Seg options={['仅译文', '双语双行', '原文另存']} value={bilingual} accentSel onChange={setBilingual} />
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="bg-bg-3 border border-hairline rounded-lg text-ink-1 px-2.5 py-1.5 text-xs outline-none focus:border-accent-line"
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
          <Chip tone="on" dot>
            {doneCount} / {doc.cues.length}
          </Chip>
        )}
        {queueMsg && <Chip tone="danger" dot>{queueMsg}</Chip>}
        <div className="ml-auto flex gap-2.5">
          <Seg options={['SRT', 'ASS', 'VTT', 'LRC']} value={exportFmt} onChange={setExportFmt} />
          <Btn
            kind="primary"
            disabled={!doc}
            onClick={() =>
              apiSubExport(doc!.id, {
                format: exportFmt.toLowerCase(),
                encoding: 'utf-8',
                bilingual: bilingual === '仅译文' ? 'translation-only' : bilingual === '双语双行' ? 'dual-line' : 'keep-original',
              }).catch((e) => alert(e))
            }
          >
            导出 / 转换
          </Btn>
        </div>
      </div>

      {/* 主体 */}
      {!doc ? (
        <div className="flex-1 grid place-items-center bg-bg-1 border border-hairline rounded-[14px] empty-dots">
          <div className="text-center">
            <div className="text-4xl mb-3">🎬</div>
            <div className="text-[15px] font-semibold text-ink-2">导入字幕文件开始翻译</div>
            <div className="text-xs text-ink-3 mt-1.5">
              支持 SRT / ASS / VTT / LRC · 自动识别编码（UTF-8 / GBK）· 双语三模式 · 格式转换导出
            </div>
            <div className="mt-4">
              <Btn kind="primary" onClick={doImport}>
                <Upload size={14} /> 导入字幕
              </Btn>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid gap-4 min-h-0" style={{ gridTemplateColumns: '1.55fr 1fr' }}>
          {/* cue 表格 */}
          <div className="bg-bg-1 border border-hairline rounded-[14px] flex flex-col overflow-hidden min-h-0">
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
              <span className="label">
                字幕条目 · <b>CUES</b>
              </span>
              <span className="font-mono text-[11px] text-ink-3">
                {doc.format.toUpperCase()} → {exportFmt} 转换就绪
              </span>
            </div>
            <div className="grid px-3.5 pt-1.5 pb-2 border-b border-hairline font-mono text-[9.5px] tracking-[.12em] text-ink-3 uppercase"
              style={{ gridTemplateColumns: '44px 132px 1fr 1fr 96px', gap: 10 }}>
              <span>♯</span>
              <span>起止时间</span>
              <span>原文</span>
              <span>译文</span>
              <span>状态</span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              {doc.cues.map((c) => (
                <div
                  key={c.index}
                  onClick={() => setSelIdx(c.index)}
                  className={`grid px-3.5 py-2.5 border-b border-hairline cursor-pointer transition-colors items-center ${
                    selIdx === c.index ? 'bg-bg-2 shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-bg-2'
                  }`}
                  style={{ gridTemplateColumns: '44px 132px 1fr 1fr 96px', gap: 10 }}
                >
                  <span className="font-mono text-[10.5px] text-ink-3">{String(c.index).padStart(4, '0')}</span>
                  <span className="font-mono text-[11px] text-ink-2 whitespace-nowrap">
                    <b className="text-ink-1 font-medium">{tc(c.startMs)}</b> → {tc(c.endMs).slice(3)}
                  </span>
                  <span className="text-[12.5px] leading-[1.5] text-ink-2 line-clamp-2">{c.original}</span>
                  <span className="text-[12.5px] leading-[1.5] text-ink-1 line-clamp-2">{c.translated}</span>
                  <span>
                    <Chip tone={STATE_TONE[c.state] ?? 'default'} dot>
                      {c.state}
                      {c.offTarget ? ' · off' : ''}
                      {c.needsCheck ? ' · check' : ''}
                    </Chip>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧：选中 cue 详情 */}
          <div className="bg-bg-1 border border-hairline rounded-[14px] p-4 overflow-auto min-h-0">
            {selIdx == null ? (
              <div className="text-xs text-ink-3 mt-2">点击左侧条目查看详情</div>
            ) : (
              (() => {
                const c = doc.cues.find((x) => x.index === selIdx)!
                return (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-center">
                      <span className="label">CUE #{String(c.index).padStart(4, '0')} · 详情</span>
                      <Chip tone="on">
                        {tc(c.startMs)} → {tc(c.endMs)}
                      </Chip>
                    </div>
                    <div className="bg-bg-2 rounded-lg p-3 text-[13px] text-ink-2 leading-relaxed">{c.original}</div>
                    <div className="bg-bg-2 rounded-lg p-3 text-[13px] text-teal leading-relaxed min-h-[44px]">
                      {c.translated || <span className="text-ink-3">（未翻译）</span>}
                    </div>
                    {c.needsCheck && (
                      <Chip tone="warn" dot>
                        覆写标签回填失败，需人工检查
                      </Chip>
                    )}
                    {c.styleName && (
                      <div className="text-xs text-ink-3">
                        样式: <span className="font-mono text-ink-2">{c.styleName}</span>（样式编辑为 M4 范围）
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
