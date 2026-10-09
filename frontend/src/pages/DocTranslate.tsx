// 文档翻译工作台（01 文档 §5.5 · M5 步 4）。
// 导入（txt/md，后端弹对话框）→ 方向/术语本确认 → 整卷翻译（块级进度 + ETA）
// → 覆盖率结果 → 译文/双语对照导出。对照预览按块对齐双栏，同一滚动容器天然同步。
// 生命周期与字幕队列同构：取消保留已产出，续跑只补 pending/failed。
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Play, Upload } from 'lucide-react'
import { Badge, Button, EmptyState, Progress, Segmented } from '../components/ui/index'
import { toast } from '../stores/toastStore'
import { useAppStore } from '../stores/appStore'
import { on, EV } from '../lib/wails'
import {
  apiDocPick,
  apiDocTranslate,
  apiDocResume,
  apiDocCancel,
  apiDocGetDoc,
  apiDocExport,
  apiListGlossaries,
} from '../wailsapi'

interface Chunk {
  index: number
  text: string
  translated?: string
  state: string
}

interface DocSnap {
  id: string
  path: string
  direction: string
  chunks: Chunk[]
  charsTotal: number
  coverage?: { term: string; translation: string; sourceChunks: number; hitChunks: number }[]
  queueActive?: boolean
}

interface Glossary {
  id: number
  name: string
  items: { term: string; translation: string }[]
}

interface Progress {
  docId?: string
  charsDone: number
  charsTotal: number
  etaSeconds: number
  state?: string
}

const DIRECTIONS: Record<string, string> = {
  '中→英': 'zh-en',
  '英→中': 'en-zh',
  '中→日': 'zh-ja',
  '日→中': 'ja-zh',
}

const STATE_TONE: Record<string, 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'> = {
  done: 'ok',
  translating: 'accent',
  failed: 'danger',
  pending: 'neutral',
}

const errToast = (e: unknown) =>
  toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })

export function DocTranslatePage() {
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const [pending, setPending] = useState<{ path: string; chars: number } | null>(null)
  const [dirLabel, setDirLabel] = useState('中→英')
  const [glossaries, setGlossaries] = useState<Glossary[]>([])
  const [glossaryId, setGlossaryId] = useState(0)
  const [doc, setDoc] = useState<DocSnap | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [done, setDone] = useState<{ canceled?: boolean; error?: string } | null>(null)
  // 当前文档 id：事件按 id 过滤。旧文档队列仍在跑时（未取消就导入新文档），
  // 它的 doc:progress / doc:done 不能覆盖当前文档的进度、更不能把显示中的
  // 文档快照换成旧文档的（refreshDoc(r.docId) 曾有此问题）。
  const docIdRef = useRef<string | null>(null)
  useEffect(() => {
    docIdRef.current = doc?.id ?? null
  }, [doc?.id])

  useEffect(() => {
    apiListGlossaries().then((gs) => setGlossaries(gs ?? [])).catch(() => {})
  }, [])

  const refreshDoc = useCallback((id: string) => {
    apiDocGetDoc(id).then((d) => d && setDoc(d)).catch(() => {})
  }, [])

  useEffect(() => {
    // 后端 DocProgress / DocDone 载荷恒带 docId（pipeline.go / docpipeline.go），
    // 严格匹配当前文档：不匹配（或尚无当前文档）一律忽略。
    const offProgress = on(EV.DOC_PROGRESS, (p) => {
      const prog = p as Progress
      if (prog.docId !== docIdRef.current) return // 旧文档的事件
      setProgress(prog)
    })
    const offDone = on(EV.DOC_DONE, (d) => {
      const r = d as { docId: string; error?: string; canceled?: boolean }
      if (r.docId !== docIdRef.current) return // 旧文档的终态
      setProgress(null)
      setDone({ canceled: r.canceled, error: r.error })
      refreshDoc(r.docId)
      refreshStatus()
      if (r.canceled) toast.push({ tone: 'info', message: '长文档翻译已取消，已产出内容保留' })
    })
    return () => {
      offProgress()
      offDone()
    }
  }, [refreshDoc, refreshStatus])

  const doPick = async () => {
    try {
      const res = await apiDocPick()
      if (!res) return
      if (res.unsupported) {
        toast.push({ tone: 'error', message: '文件内容为空或无法解码' })
        return
      }
      if (res.tooLong) {
        toast.push({ tone: 'error', message: `文档 ${res.chars} 字超出当前上限 50000 字` })
        return
      }
      setPending({ path: res.path, chars: res.chars })
      docIdRef.current = null // 旧文档的事件从此刻起一律忽略
      setDoc(null)
      setDone(null)
      setProgress(null)
    } catch (e) {
      errToast(e)
    }
  }

  const doStart = async () => {
    if (!pending) return
    try {
      const id = await apiDocTranslate({
        path: pending.path,
        direction: DIRECTIONS[dirLabel],
        glossaryId: glossaryId || undefined,
      })
      docIdRef.current = id // 拿到 id 立即登记：早到的进度/终态事件不被误丢
      setDoc(await apiDocGetDoc(id))
      refreshStatus()
    } catch (e) {
      errToast(e)
    }
  }

  const doResume = async () => {
    if (!doc) return
    try {
      await apiDocResume(doc.id)
      refreshDoc(doc.id)
      refreshStatus()
    } catch (e) {
      errToast(e)
    }
  }

  const doCancel = () => {
    if (!doc) return
    apiDocCancel(doc.id).catch(errToast)
  }

  const doExport = async (kind: 'translation' | 'bilingual') => {
    if (!doc) return
    try {
      const saved = await apiDocExport(doc.id, kind)
      // 空串 = 用户取消了保存对话框，不算导出成功（后端 DocExport 契约）
      if (saved) toast.push({ tone: 'ok', message: kind === 'bilingual' ? '双语对照已导出' : '译文已导出' })
    } catch (e) {
      errToast(e)
    }
  }

  const charsDone = progress?.charsDone ?? (doc?.chunks ?? []).filter((c) => c.state === 'done')
    .reduce((n, c) => n + c.text.length, 0)
  const charsTotal = progress?.charsTotal ?? doc?.charsTotal ?? 0
  const pct = charsTotal > 0 ? Math.round((charsDone / charsTotal) * 100) : 0
  const queueActive = doc?.queueActive ?? false
  const unfinished = (doc?.chunks ?? []).some((c) => c.state !== 'done')
  const allDone = doc && doc.chunks.length > 0 && !unfinished

  return (
    <div className="flex flex-col gap-3.5 h-full min-h-0 screen-in">
      {/* 工具栏 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button onClick={doPick}>
          <Upload size={14} /> 导入文档
        </Button>
        {(pending || doc) && (
          <Badge tone="accent" dot>
            <FileText size={10} className="mr-1" aria-hidden="true" />
            {(pending?.path ?? doc?.path ?? '').split(/[\\/]/).pop()} ·{' '}
            <span className="num">{(pending?.chars ?? doc?.charsTotal ?? 0).toLocaleString()}</span> 字
          </Badge>
        )}
        <Segmented<string>
          options={Object.keys(DIRECTIONS)}
          value={dirLabel}
          aria-label="翻译方向"
          onChange={setDirLabel}
        />
        <select
          value={glossaryId}
          onChange={(e) => setGlossaryId(Number(e.target.value))}
          aria-label="术语本"
          title="固定译名表：入表词条全片逐字一致（M5 §7.11 实证机制）"
          className="bg-sunken border border-line text-ink1 px-2.5 py-1.5 text-caption"
        >
          <option value={0}>不用术语本</option>
          {glossaries.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}（{g.items?.length ?? 0} 条）
            </option>
          ))}
        </select>
        {pending && (
          <Button kind="primary" onClick={doStart}>
            <Play size={14} /> 开始翻译
          </Button>
        )}
        {doc && !pending && (
          <Button kind="primary" disabled={queueActive} onClick={doResume}>
            <Play size={14} /> {unfinished ? '继续翻译' : '重新翻译'}
          </Button>
        )}
        {doc && (
          <Button disabled={!queueActive} onClick={doCancel}>
            取消
          </Button>
        )}
        {allDone && (
          <>
            <Button onClick={() => doExport('translation')}>导出译文</Button>
            <Button onClick={() => doExport('bilingual')}>导出双语对照</Button>
          </>
        )}
      </div>

      {/* 进度条 */}
      {doc && (
        <div className="bg-surface border border-line px-5 py-3">
          <div className="flex items-center gap-3">
            <Progress pct={pct} label={`整卷进度 ${pct}%`} />
            <span className="num text-micro text-ink3 whitespace-nowrap">
              {charsDone.toLocaleString()} / {charsTotal.toLocaleString()} 字
              {progress && progress.etaSeconds > 0 ? ` · 剩余约 ${Math.ceil(progress.etaSeconds / 60)} 分钟` : ''}
            </span>
          </div>
        </div>
      )}

      {/* 主体 */}
      {!doc ? (
        <div className="flex-1 grid place-items-center bg-surface border border-line">
          <EmptyState
            icon={<FileText size={48} strokeWidth={1.5} />}
            title="导入长文档开始翻译"
            body="txt / md · 编码自动识别 · 整卷分块翻译 · 术语全片一致 · 导出译文与双语对照"
            action={
              <Button kind="primary" onClick={doPick}>
                <Upload size={14} /> 导入文档
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          {/* 覆盖率（完成后） */}
          {allDone && doc.coverage && doc.coverage.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-micro uppercase tracking-caps text-ink3">术语一致性</span>
              {doc.coverage.map((c) => (
                <Badge
                  key={c.term}
                  tone={c.hitChunks === c.sourceChunks ? 'ok' : 'warn'}
                  dot
                  title={c.hitChunks === c.sourceChunks ? '全片一致' : '存在未按固定译名命中的块，人工检查'}
                >
                  {c.term}→{c.translation}：<span className="num">{c.hitChunks}/{c.sourceChunks}</span>
                </Badge>
              ))}
            </div>
          )}
          {done?.error && <div className="text-caption text-danger">{`部分块失败：${done.error}（可「继续翻译」只补失败块）`}</div>}
          {/* 对照预览：按块对齐双栏，单滚动容器天然同步（F-08「对照预览同步滚动」） */}
          <div className="flex-1 overflow-auto min-h-0 bg-surface border border-line">
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="px-4 py-2 border-b border-line text-micro tracking-caps text-ink3 uppercase sticky top-0 bg-surface">
                原文 · <b className="text-ink2 font-medium">SOURCE</b>
              </div>
              <div className="px-4 py-2 border-b border-l border-line text-micro tracking-caps text-ink3 uppercase sticky top-0 bg-surface">
                译文 · <b className="text-ink2 font-medium">TRANSLATION</b>
              </div>
              {doc.chunks.map((c) => (
                <div key={c.index} className="contents">
                  <div className="px-4 py-3 border-b border-line text-caption text-ink2 leading-relaxed whitespace-pre-wrap break-words">
                    {c.text}
                  </div>
                  <div className="px-4 py-3 border-b border-l border-line text-caption text-ink1 leading-relaxed whitespace-pre-wrap break-words">
                    {c.state === 'done' ? (
                      c.translated
                    ) : (
                      <Badge tone={STATE_TONE[c.state] ?? 'neutral'} dot>
                        {c.state}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
