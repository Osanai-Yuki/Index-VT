// 文档翻译工作台（01 文档 §5.5 · M5 步 4）。
// 导入（txt/md，后端弹对话框）→ 方向/术语本确认 → 整卷翻译（块级进度 + ETA）
// → 覆盖率结果 → 译文/双语对照导出。对照预览按块对齐双栏，同一滚动容器天然同步。
// 生命周期与字幕队列同构：取消保留已产出，续跑只补 pending/failed。
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Play, Upload } from 'lucide-react'
import { Badge, Button, EmptyState, Progress, Segmented, Modal } from '../components/ui/index'
import { toast } from '../stores/toastStore'
import { useAppStore } from '../stores/appStore'
import { on, EV } from '../lib/wails'
import {
  apiDocPick,
  apiNoteWorkspace,
  apiDocTranslate,
  apiDocResume,
  apiDocRestart,
  apiRevealFile,
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
  coverage?: { term: string; translation: string; sourceChunks: number; hitChunks: number; sourceOccurrences?: number; targetOccurrences?: number; missingChunks?: number[] }[]
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

export function DocTranslatePage({ active = true }: { active?: boolean }) {
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const [pending, setPending] = useState<{ path: string; chars: number } | null>(null)
  const [dirLabel, setDirLabel] = useState('中→英')
  const [glossaries, setGlossaries] = useState<Glossary[]>([])
  const [glossaryId, setGlossaryId] = useState(0)
  const [doc, setDoc] = useState<DocSnap | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'running' | 'stopping'>('idle')
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [exportKind, setExportKind] = useState<'translation' | 'bilingual' | null>(null)
  const generation = useRef(0)
  const readVersion = useRef(0)
  const submitting = useRef(false)
  const [done, setDone] = useState<{ canceled?: boolean; error?: string } | null>(null)
  // 当前文档 id：事件按 id 过滤。旧文档队列仍在跑时（未取消就导入新文档），
  // 它的 doc:progress / doc:done 不能覆盖当前文档的进度、更不能把显示中的
  // 文档快照换成旧文档的（refreshDoc(r.docId) 曾有此问题）。
  const docIdRef = useRef<string | null>(null)
  const refreshDoc = useCallback(async (id: string) => {
    const gen = generation.current
    const version = ++readVersion.current
    const fresh = await apiDocGetDoc(id)
    if (gen !== generation.current || version !== readVersion.current || docIdRef.current !== id || fresh?.id !== id) return
    setDoc(fresh)
    if (!fresh.queueActive) setPhase('idle')
  }, [])

  useEffect(() => {
    if (active) apiListGlossaries().then(gs => setGlossaries(gs ?? [])).catch(errToast)
  }, [active])

  useEffect(() => {
    const offProgress = on(EV.DOC_PROGRESS, p => {
      const prog = p as Progress
      if (prog.docId && prog.docId === docIdRef.current) setProgress(prog)
    })
    const offDone = on(EV.DOC_DONE, payload => {
      const result = payload as { docId: string; error?: string; canceled?: boolean }
      if (!result.docId || result.docId !== docIdRef.current) return
      setProgress(null)
      setDone(result)
      setPhase('idle')
      void refreshDoc(result.docId).catch(errToast)
      void refreshStatus()
    })
    return () => { offProgress(); offDone() }
  }, [refreshDoc, refreshStatus])

  useEffect(() => {
    if (!doc || (phase === 'idle' && !doc.queueActive)) return
    const id = doc.id
    const timer = setInterval(() => { void refreshDoc(id).catch(() => {}) }, 1000)
    return () => clearInterval(timer)
  }, [doc?.id, doc?.queueActive, phase, refreshDoc])

  const doPick = async () => {
    if (submitting.current || phase !== 'idle' || doc?.queueActive) return
    const gen = ++generation.current
    try {
      const res = await apiDocPick()
      if (gen !== generation.current || !res) return
      if (res.unsupported || res.tooLong) { errToast(res.tooLong ? '文档超出50000字上限' : '文件为空或无法解码'); return }
      setPending({ path: res.path, chars: res.chars })
      docIdRef.current = null
      ++readVersion.current
      setDoc(null); setDone(null); setProgress(null)
    } catch (e) { if (gen === generation.current) errToast(e) }
  }

  const doStart = async () => {
    if (!pending || submitting.current) return
    submitting.current = true
    const gen = generation.current
    setPhase('starting'); setDone(null); setProgress(null)
    try {
      const id = await apiDocTranslate({ path: pending.path, direction: DIRECTIONS[dirLabel], glossaryId: glossaryId || undefined })
      if (gen !== generation.current) return
      docIdRef.current = id
      setPending(null)
      setPhase('running')
      await refreshDoc(id)
      void refreshStatus()
    } catch (e) { if (gen === generation.current) { setPhase('idle'); errToast(e) } }
    finally { submitting.current = false }
  }

  const run = async (restart = false) => {
    const id = docIdRef.current
    if (!id || submitting.current) return
    submitting.current = true
    setPhase('starting'); setDone(null); setProgress(null)
    try {
      if (restart) await apiDocRestart(id)
      else await apiDocResume(id)
      if (docIdRef.current !== id) return
      setPhase('running')
      await refreshDoc(id)
      void refreshStatus()
    } catch (e) { if (docIdRef.current === id) { setPhase('idle'); errToast(e) } }
    finally { submitting.current = false }
  }

  const doCancel = async () => {
    if (!doc || phase === 'stopping') return
    const id = doc.id
    setPhase('stopping')
    try { await apiDocCancel(id); await refreshDoc(id) }
    catch (e) { if (docIdRef.current === id) { setPhase('idle'); errToast(e) } }
  }

  const doExport = async (kind: 'translation' | 'bilingual') => {
    if (!doc) return
    setExportKind(null)
    try {
      const saved = await apiDocExport(doc.id, doc.chunks.every(c => c.state === 'done') ? kind : `${kind}-partial`)
      if (saved) toast.push({ tone: 'ok', message: `已导出：${saved}`, action: { label: '打开所在文件夹', run: () => { apiRevealFile(saved).catch(errToast) } } })
    } catch (e) { errToast(e) }
  }

  const charsDone = progress?.charsDone ?? (doc?.chunks ?? []).filter((c) => c.state === 'done')
    .reduce((n, c) => n + c.text.length, 0)
  const charsTotal = progress?.charsTotal ?? doc?.charsTotal ?? 0
  const pct = charsTotal > 0 ? Math.round((charsDone / charsTotal) * 100) : 0
  const queueActive = !!doc?.queueActive || phase !== 'idle'
  const unfinished = (doc?.chunks ?? []).some((c) => c.state !== 'done')
  const allDone = doc && doc.chunks.length > 0 && !unfinished
  useEffect(() => { apiNoteWorkspace('doc', !!doc?.chunks.some(c => c.translated)).catch(() => {}) }, [!!doc?.chunks.some(c => c.translated)])
  useEffect(() => { useAppStore.setState(s => ({ pageTasks: { ...s.pageTasks, doc: queueActive } })) }, [queueActive])

  return (
    <div className="flex flex-col gap-3.5 h-full min-h-0 screen-in">
      {/* 工具栏 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button disabled={queueActive} onClick={doPick}>
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
          disabled={queueActive || !!doc}
        />
        <select
          value={glossaryId}
          disabled={queueActive || !!doc}
          onChange={(e) => setGlossaryId(Number(e.target.value))}
          aria-label="术语本"
          title="词条用于模型提示；命中块数不代表全文逐次一致"
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
          <Button kind="primary" disabled={queueActive} onClick={doStart}>
            <Play size={14} /> {phase === 'starting' ? '正在开始…' : '开始翻译'}
          </Button>
        )}
        {doc && !pending && (
          <Button kind="primary" disabled={queueActive} onClick={() => unfinished ? run() : setConfirmRestart(true)}>
            <Play size={14} /> {queueActive ? (phase === 'stopping' ? '正在停止…' : '翻译中…') : unfinished ? '继续翻译' : '重新翻译'}
          </Button>
        )}
        {doc && (
          <Button disabled={!doc.queueActive || phase === 'stopping'} onClick={doCancel}>
            取消
          </Button>
        )}
        {doc && !queueActive && doc.chunks.some(c => c.state === 'done') && (
          <>
            <Button onClick={() => allDone ? doExport('translation') : setExportKind('translation')}>导出译文</Button>
            <Button onClick={() => allDone ? doExport('bilingual') : setExportKind('bilingual')}>导出双语对照</Button>
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
            body="txt / md · 编码自动识别 · 整卷分块翻译 · 术语提示约束 · 导出译文与双语对照"
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
              <span className="text-micro uppercase tracking-caps text-ink3">规定译名命中块</span>
              {doc.coverage.map((c) => (
                <span key={c.term} className="inline-flex gap-2 items-center">
                <Badge
                  key={c.term}
                  tone={c.hitChunks === c.sourceChunks ? 'ok' : 'warn'}
                  dot
                  title={c.hitChunks === c.sourceChunks ? '所有含词条的块都出现了规定译名；仍需检查每次出现' : '存在未按固定译名命中的块，人工检查'}
                >
                  {c.term}→{c.translation}：<span className="num">{c.hitChunks}/{c.sourceChunks}</span>
                </Badge>
                {c.missingChunks?.map(index => <Button key={index} size="sm" onClick={() => document.getElementById(`doc-${doc.id}-${index}`)?.scrollIntoView({ block: 'center' })}>检查块{index}</Button>)}
                <span className="text-caption text-ink2">字面出现：{c.sourceOccurrences ?? '—'} / {c.targetOccurrences ?? '—'}（原/译，仅供检查）</span>
                </span>
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
                  <div id={`doc-${doc.id}-${c.index}`} className="select-text cursor-text px-4 py-3 border-b border-line text-read text-ink2 leading-relaxed whitespace-pre-wrap break-words">
                    {c.text}
                  </div>
                  <div role="region" aria-label="译文段落" className="select-text cursor-text px-4 py-3 border-b border-l border-line text-read text-ink1 leading-relaxed whitespace-pre-wrap break-words">
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
      {doc && <p className="text-caption text-ink2">继续使用本任务原方向与术语；更改参数请导入新任务。会话会在切页后保留，关闭前请导出。</p>}
      <Modal open={active && confirmRestart} onClose={() => setConfirmRestart(false)} title="重新翻译全部内容？" footer={<><Button onClick={() => setConfirmRestart(false)} data-modal-initial="cancel">取消</Button><Button kind="primary" onClick={() => { setConfirmRestart(false); void run(true) }}>确认重新翻译</Button></>}>
        本任务全部译文将重新生成。方向和术语沿用本任务配置；当前译文请先导出。
      </Modal>
      <Modal open={active && exportKind !== null} onClose={() => setExportKind(null)} title="导出部分结果？" footer={<><Button onClick={() => setExportKind(null)} data-modal-initial="cancel">取消</Button><Button onClick={() => exportKind && doExport(exportKind)}>导出部分结果</Button></>}>
        文档尚未全部完成；未完成块将按导出文件中的标记保留，请勿作为完成稿使用。
      </Modal>
    </div>
  )
}
