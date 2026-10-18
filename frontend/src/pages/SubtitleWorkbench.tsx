// 字幕工作台 P0（01 文档 §6.3）· Track C 迁移版（2026-10-06）· M4 编辑版（2026-10-08）
// 导入 / 翻译队列（开始/暂停/取消/重试失败）/ 双语三模式 / 导出（格式+编码）。
// M4 新增：虚拟化 cue 表（F-22）+ 行内编辑 + 右键菜单 + 平移/校准 + 样式库面板。
// Track C 接线：EV.CUE 实时刷新译文列 + 终态后 SubGetDoc 拉权威快照；
// alert 全部下线（toast）。事件订阅走 lib/wails 新事件层。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Clapperboard, Play, RotateCcw, Upload, Move, Ruler, Palette } from 'lucide-react'
import { Badge, Button, DataTable, Modal, Segmented } from '../components/ui/index'
import type { Column } from '../components/ui/index'
import { toast } from '../stores/toastStore'
import { useAppStore } from '../stores/appStore'
import { on, EV } from '../lib/wails'
import {
  apiSubOpen,
  apiNoteWorkspace,
  apiSubUndo,
  apiSubShiftCue,
  apiRevealFile,
  apiListGlossaries,
  apiSubTranslate,
  apiSubPauseQueue,
  apiSubResumeQueue,
  apiSubCancelQueue,
  apiSubRetryFailed,
  apiSubRetryCues,
  apiSubGetDoc,
  apiSubExport,
  apiSubUpdateCue,
  apiSubSplitCue,
  apiSubMergeCues,
  apiSubShiftAll,
  apiSubCalibrate,
  apiSubDeleteCues,
  apiSubInsertCue,
  apiSubStyles,
  apiSubSetStyle,
  apiSubAssignStyle,
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
  revision?: number
  id: string
  path: string
  format: string
  encoding: string
  cues: Cue[]
  /** 是否有进行中的翻译队列（SubGetDoc 权威快照，GetDoc 时按 queueCancel 计算） */
  canUndo?: boolean
  canRedo?: boolean
  queuePaused?: boolean
  queueActive?: boolean
}

interface StyleDef {
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

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const STATE_TONE: Record<string, BadgeTone> = {
  done: 'ok',
  translating: 'warn',
  failed: 'danger',
  pending: 'neutral',
  skipped: 'neutral',
}

function tc(ms: number) {
  // 负值钳到 0（与 lib/format.tcSrt 同规则）：负毫秒会让 % 取模出负数、
  // Math.floor 出 -1，渲染出 "00:-1:-1,-50" 这类垃圾时间码。
  const t = Math.max(0, Math.floor(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor((t % 3600000) / 60000)
  const s = Math.floor((t % 60000) / 1000)
  const milli = t % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`
}

const errToast = (e: unknown) =>
  toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })

// ASS 样式默认色（数据域默认值，ASS 规范：白字黑描边；非 UI 主题色）
const ASS_DEFAULT_PRIMARY_RGB = '#' + 'FFFFFF'
const ASS_DEFAULT_OUTLINE_RGB = '#' + '000000'

// M4 编辑状态
interface EditState {
  editingCell: { index: number; field: 'original' | 'translated' | 'startMs' | 'endMs' } | null
  editValue: string
  contextMenu: { x: number; y: number; cueIndex: number } | null
  shiftModal: boolean
  calibrateMode: 0 | 1 | 2 // 0=未进入, 1=选第一锚点, 2=选第二锚点
  calibrateAnchor1: { index: number; ms: number } | null
  calibrateModal: { index: number } | null // 第二锚点：输入正确时间（毫秒）
  stylePanelTab: 'detail' | 'style'
  styleModal: { mode: 'new' | 'edit'; style: StyleDef } | null
}

// A new scope is allocated on every successful import (even if an ID is reused).
// Request versions reject older snapshots of the same document as well.
interface DocScope {
  revision: number
  id: string
  snapshotVersion: number
  stylesVersion: number
  mutations?: Promise<void>
}

interface CueProgress {
  revision?: number
  docId: string
  cueIndex: number
  state?: string
  offTarget?: boolean
  needsCheck?: boolean
  translated?: string
}

const initialEditState = (): EditState => ({
  editingCell: null,
  editValue: '',
  contextMenu: null,
  shiftModal: false,
  calibrateMode: 0,
  calibrateAnchor1: null,
  calibrateModal: null,
  stylePanelTab: 'detail',
  styleModal: null,
})

export function SubtitleWorkbench({ langs, active = true }: { langs: any[]; active?: boolean }) {
  const [doc, setDoc] = useState<Doc | null>(null)
  const [targetLang, setTargetLang] = useState('en')
  const [bilingual, setBilingual] = useState('双语双行')
  const [exportFmt, setExportFmt] = useState('SRT')
  const [glossaries, setGlossaries] = useState<{ id: number; name: string; items?: unknown[] }[]>([])
  const [glossaryId, setGlossaryId] = useState(0)
  const [confirmFull, setConfirmFull] = useState(false)
  const [confirmExport, setConfirmExport] = useState(false)
  const [exportEncoding, setExportEncoding] = useState('utf-8')
  const [canceling, setCanceling] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuReturnRef = useRef<HTMLElement | null>(null)
  const [tableRowHeight, setTableRowHeight] = useState(64)
  const [queueMsg, setQueueMsg] = useState<string | null>(null)
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [styles, setStyles] = useState<StyleDef[]>([])
  const [edit, setEdit] = useState<EditState>(initialEditState)
  useEffect(() => { apiNoteWorkspace('subtitle', !!doc && (!!edit.editingCell || !!doc.canUndo || doc.cues.some(c => !!c.translated))).catch(() => {}) }, [!!doc && (!!edit.editingCell || !!doc.canUndo || doc.cues.some(c => !!c.translated))])
  const scopeRef = useRef<DocScope | null>(null)
  useEffect(() => { useAppStore.setState(s => ({ pageTasks: { ...s.pageTasks, subtitle: !!doc?.queueActive } })) }, [doc?.queueActive])
  const importVersion = useRef(0)
  const mounted = useRef(false)
  const reconcileTimer = useRef<number | null>(null)
  const cancelTimer = useRef<number | null>(null)
  const shiftInputRef = useRef<HTMLInputElement>(null)
  const calibrateInputRef = useRef<HTMLInputElement>(null)

  const refreshStatus = useAppStore((s) => s.refreshStatus)

  const clearTimers = useCallback(() => {
    if (reconcileTimer.current !== null) window.clearTimeout(reconcileTimer.current)
    if (cancelTimer.current !== null) window.clearTimeout(cancelTimer.current)
    reconcileTimer.current = null
    cancelTimer.current = null
  }, [])

  const requestDoc = useCallback(async (
    scope: DocScope,
    request: (id: string) => Promise<Doc | null>,
    reportError = false,
  ): Promise<'applied' | 'stale' | 'failed'> => {
    if (scopeRef.current !== scope) return 'stale'
    const version = ++scope.snapshotVersion
    try {
      const fresh = await request(scope.id)
      if (scopeRef.current !== scope || version !== scope.snapshotVersion || fresh?.id !== scope.id) return 'stale'
      if (fresh.revision !== undefined && fresh.revision < scope.revision) return 'stale'
      scope.revision = fresh.revision ?? scope.revision
      setDoc(fresh)
      return 'applied'
    } catch (e) {
      if (reportError && scopeRef.current === scope && version === scope.snapshotVersion) errToast(e)
      return 'failed'
    }
  }, [])

  const refreshDoc = useCallback(async (scope: DocScope) => {
    await requestDoc(scope, apiSubGetDoc)
  }, [requestDoc])

  const refreshStyles = useCallback(async (scope: DocScope) => {
    if (scopeRef.current !== scope) return
    const version = ++scope.stylesVersion
    try {
      const fresh: StyleDef[] = await apiSubStyles(scope.id)
      if (scopeRef.current === scope && version === scope.stylesVersion) setStyles(fresh ?? [])
    } catch { /* keep the current styles if refreshing fails */ }
  }, [])

  useEffect(() => {
    mounted.current = true
    const off = on(EV.CUE, (p) => {
      const cue = p as CueProgress | null
      const scope = scopeRef.current
      if (!scope || cue?.docId !== scope.id || !Number.isInteger(cue.cueIndex)) return
      if (cue.revision !== undefined) {
        if (!Number.isSafeInteger(cue.revision) || cue.revision <= scope.revision) return
        scope.revision = cue.revision
      }
      // A snapshot taken before this event must not undo its newer cue data.
      ++scope.snapshotVersion
      setDoc((d) => {
        if (!d || scopeRef.current !== scope || d.id !== cue.docId) return d
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
        return { ...d, revision: cue.revision ?? d.revision, cues }
      })
      if (cue.state === 'done' || cue.state === 'failed' || cue.state === 'skipped') {
        if (reconcileTimer.current !== null) window.clearTimeout(reconcileTimer.current)
        reconcileTimer.current = window.setTimeout(() => {
          reconcileTimer.current = null
          void refreshDoc(scope)
        }, 1000)
      }
    })
    return () => {
      off()
      mounted.current = false
      ++importVersion.current
      scopeRef.current = null
      clearTimers()
    }
  }, [clearTimers, refreshDoc])

  // M4：Esc 关闭右键菜单
  useEffect(() => {
    if (!active || !edit.contextMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEdit((ed) => ({ ...ed, contextMenu: null }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, edit.contextMenu])

  const doImport = useCallback(async () => {
    const version = ++importVersion.current
    try {
      const d: Doc | null = await apiSubOpen()
      if (mounted.current && version === importVersion.current && d?.id) {
        clearTimers()
        const scope = { id: d.id, revision: d.revision ?? 0, snapshotVersion: 0, stylesVersion: 0 }
        scopeRef.current = scope
        setDoc(d)
        setConfirmFull(false)
        setConfirmExport(false)
        setSelIdx(null)
        setQueueMsg(null)
        setEdit(initialEditState())
        setStyles([])
        void refreshStyles(scope)
      }
    } catch (e) {
      if (mounted.current && version === importVersion.current) errToast(e)
    }
  }, [clearTimers, refreshStyles])

  useEffect(() => { if (active) apiListGlossaries().then(gs => setGlossaries(gs ?? [])).catch(errToast) }, [active])
  const queueOpt = { targetLang, glossaryId, bilingual: bilingual === '仅译文' ? 'translation-only' : bilingual === '双语双行' ? 'dual-line' : 'keep-original' }

  const runQueueAction = async (request: (id: string) => Promise<unknown>, queueError = false, cancel = false) => {
    const scope = scopeRef.current
    if (!scope) return
    ++scope.snapshotVersion
    try {
      await request(scope.id)
      if (scopeRef.current !== scope) return
      await refreshDoc(scope)
      if (scopeRef.current !== scope) return
      if (cancel) {
        if (cancelTimer.current !== null) window.clearTimeout(cancelTimer.current)
        cancelTimer.current = window.setTimeout(() => {
          cancelTimer.current = null
          void refreshDoc(scope)
        }, 500)
      }
      await refreshStatus()
    } catch (e) {
      if (scopeRef.current !== scope) return
      if (cancel) setCanceling(false)
      if (queueError) setQueueMsg(String((e as { message?: string })?.message ?? e))
      else errToast(e)
    }
  }

  useEffect(() => { if (!doc?.queueActive) setCanceling(false) }, [doc?.queueActive])

  const startFull = () => runQueueAction(id => apiSubTranslate(id, { ...queueOpt, full: true }))

  // 同一文档的编辑按发出顺序提交，旧文档的排队编辑不会写入新文档。
  const mutateDoc = async (request: (id: string) => Promise<Doc | null>, after?: (scope: DocScope) => void) => {
    const scope = scopeRef.current
    if (!scope) return false
    const work = (scope.mutations ?? Promise.resolve()).then(async () => {
      if (scopeRef.current !== scope) return false
      const result = await requestDoc(scope, request, true)
      if (scopeRef.current !== scope) return
      if (result === 'applied') after?.(scope)
      else if (result === 'stale') await refreshDoc(scope)
      return result === 'applied'
    })
    scope.mutations = work.then(() => {}, error => { errToast(error) })
    return await work
  }

  const doExport = async () => {
    if (!doc) return
    setConfirmExport(false)
    try {
      const saved = await apiSubExport(doc.id, { format: exportFmt.toLowerCase(), encoding: exportEncoding, bilingual: queueOpt.bilingual })
      if (saved) toast.push({ tone: 'ok', message: `已导出：${saved}`, action: { label: '打开所在文件夹', run: () => { apiRevealFile(saved).catch(errToast) } } })
    } catch (e) { errToast(e) }
  }

  useEffect(() => {
    const update = () => {
      const size = parseFloat(getComputedStyle(document.body).fontSize)
      setTableRowHeight(Math.max(64, Math.ceil(size * 4.75)))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-font-size'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!active || !doc?.queueActive) return
    const scope = scopeRef.current
    const timer = setInterval(() => { if (scope) void refreshDoc(scope) }, 1000)
    return () => clearInterval(timer)
  }, [active, doc?.queueActive, refreshDoc])

  useEffect(() => {
    if (!active || !edit.contextMenu || !menuRef.current) return
    const grid = document.querySelector<HTMLElement>('[aria-label="字幕条目列表"]')
    menuReturnRef.current = grid?.contains(document.activeElement) ? document.activeElement as HTMLElement : grid
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(edit.contextMenu.x, window.innerWidth - rect.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(edit.contextMenu.y, window.innerHeight - rect.height - 8))}px`
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => { menuReturnRef.current?.focus() }
  }, [active, edit.contextMenu])

  const doUpdateCue = (index: number, patch: Partial<Cue>) =>
    mutateDoc(id => apiSubUpdateCue(id, index, patch))

  const doSplitCue = (index: number, atMs: number) =>
    mutateDoc(id => apiSubSplitCue(id, index, atMs))

  const doMergeCues = (fromIndex: number, toIndex: number) =>
    mutateDoc(id => apiSubMergeCues(id, fromIndex, toIndex))

  const doShiftAll = (deltaMs: number) => mutateDoc(id => apiSubShiftAll(id, deltaMs))

  const doCalibrate = (anchor1Idx: number, anchor1Ms: number, anchor2Idx: number, anchor2Ms: number) =>
    mutateDoc(id => apiSubCalibrate(id, anchor1Idx, anchor2Idx, anchor1Ms, anchor2Ms))

  const doDeleteCues = (indices: number[]) =>
    mutateDoc(id => apiSubDeleteCues(id, indices), () => setSelIdx(null))

  const doInsertCue = (afterIndex: number) => mutateDoc(id => apiSubInsertCue(id, afterIndex))

  const doSetStyle = (style: StyleDef) =>
    mutateDoc(id => apiSubSetStyle(id, style), scope => { void refreshStyles(scope) })

  const doAssignStyle = (indices: number[], styleName: string) =>
    mutateDoc(id => apiSubAssignStyle(id, indices, styleName))

  useEffect(() => {
    if (!active || !doc || doc.queueActive) return
    const handle = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.isComposing || (e.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]')) return
      const redo = e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z')
      if (!redo && e.key.toLowerCase() !== 'z') return
      if (redo ? !doc.canRedo : !doc.canUndo) return
      e.preventDefault()
      void mutateDoc(id => apiSubUndo(id, redo), scope => { setSelIdx(null); setEdit(initialEditState()); void refreshStyles(scope) })
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [active, doc?.canUndo, doc?.canRedo, doc?.queueActive])

  const doneCount = doc ? doc.cues.filter((c) => c.state === 'done' || c.state === 'skipped').length : 0
  const failedCount = doc ? doc.cues.filter((c) => c.state === 'failed').length : 0

  // M4 列配置
  const columns: Column<Cue>[] = [
    {
      key: 'index',
      header: '#',
      width: '44px',
      numeric: true,
      render: (c) => <span className="num text-micro text-ink3">{String(c.index).padStart(4, '0')}</span>,
    },
    {
      key: 'time',
      header: '起止时间',
      width: '168px',
      render: (c) => (
        <span className="num text-micro text-ink2 whitespace-nowrap">
          <b className="text-ink1 font-medium">{tc(c.startMs)}</b> → {tc(c.endMs).slice(3)}
        </span>
      ),
    },
    {
      key: 'original',
      header: '原文',
      render: (c) => <span className="select-text cursor-text text-body text-ink2 line-clamp-2">{c.original}</span>,
    },
    {
      key: 'translated',
      header: '译文',
      render: (c) => <span className="select-text cursor-text text-body text-ink1 line-clamp-2">{c.translated}</span>,
    },
    {
      key: 'state',
      header: '状态',
      width: '96px',
      render: (c) => (
        <Badge tone={STATE_TONE[c.state] ?? 'neutral'} dot>
          {c.state}
          {c.offTarget ? ' · off' : ''}
          {c.needsCheck ? ' · check' : ''}
        </Badge>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-3.5 h-full min-h-0 screen-in">
      {/* 工具栏 */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <Button onClick={doImport}>
          <Upload size={14} /> 导入字幕
        </Button>
        {doc && (
          <Badge tone="accent" dot>
            {doc.path.split(/[\\/]/).pop()} · <span className="num">{doc.cues.length}</span> cues · {doc.format.toUpperCase()} · {doc.encoding}
          </Badge>
        )}
        <Button kind="primary" disabled={!doc || doc.queueActive} onClick={() => setConfirmFull(true)} title="用当前目标语言与双语模式重翻全部条目（含已翻过的）">
          <Play size={14} /> 全部翻译
        </Button>
        <Button disabled={!doc?.queueActive || !!doc.queuePaused || canceling} title="当前条完成后暂停；编辑前请取消队列" onClick={() => runQueueAction(apiSubPauseQueue)}>
          暂停
        </Button>
        <Button disabled={!doc?.queueActive || !doc.queuePaused || canceling} onClick={() => runQueueAction(apiSubResumeQueue)}>
          继续
        </Button>
        <Button
          disabled={!doc?.queueActive || canceling}
          onClick={() => { setCanceling(true); void runQueueAction(apiSubCancelQueue, false, true) }}
        >
          {canceling ? '正在停止…' : '取消'}
        </Button>
        <Button
          disabled={!doc || failedCount === 0 || doc.queueActive}
          onClick={() => runQueueAction(id => apiSubRetryFailed(id, queueOpt), true)}
        >
          重试失败{failedCount > 0 ? `（${failedCount}）` : ''}
        </Button>
        <Segmented<string>
          options={['仅译文', '双语双行', '原文另存']}
          value={bilingual}
          aria-label="双语模式"
          onChange={setBilingual}
          disabled={!!doc?.queueActive}
        />
        <select
          value={targetLang}
          disabled={!!doc?.queueActive}
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
        <select aria-label="字幕术语本" title="提示约束，不能保证每次出现都一致" className="bg-sunken border border-line p-2 text-caption" disabled={!!doc?.queueActive} value={glossaryId} onChange={e => setGlossaryId(Number(e.target.value))}>
          <option value={0}>不用术语本</option>
          {glossaries.map(g => <option key={g.id} value={g.id}>{g.name}（{g.items?.length ?? 0}条）</option>)}
        </select>
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
            disabled={!doc || doc.queueActive || doc.cues.length === 0}
            onClick={() => setConfirmExport(true)}
          >
            导出 / 转换
          </Button>
        </div>
      </div>

      {doc && <p className="text-caption text-ink2">暂停在当前条结束后生效；编辑前请取消队列。撤销最多20步，开始翻译将清空历史。重试使用当前语言与术语，已完成行保持不变。会话在切页后保留，关闭前请导出。</p>}
      {/* M4 编辑工具栏 */}
      {doc && (
        <div className="flex items-center gap-2.5 flex-wrap bg-surface border border-line px-3 py-2">
          <span className="text-micro uppercase tracking-caps text-ink3">编辑工具</span>
          <Button disabled={!doc.canUndo || doc.queueActive} onClick={() => mutateDoc(id => apiSubUndo(id), scope => { setSelIdx(null); setEdit(initialEditState()); void refreshStyles(scope) })}>撤销</Button>
          <Button disabled={!doc.canRedo || doc.queueActive} onClick={() => mutateDoc(id => apiSubUndo(id, true), scope => { setSelIdx(null); setEdit(initialEditState()); void refreshStyles(scope) })}>重做</Button>
          <Button
            disabled={!doc || doc.queueActive}
            onClick={() => setEdit((e) => ({ ...e, shiftModal: true }))}
            title="整体平移所有字幕时间"
          >
            <Move size={14} /> 平移
          </Button>
          <Button
            disabled={!doc || doc.queueActive}
            onClick={() => setEdit((e) => ({ ...e, calibrateMode: 1, calibrateAnchor1: null }))}
            title="两点校准时间轴"
          >
            <Ruler size={14} /> 校准
          </Button>
          {edit.calibrateMode > 0 && (
            <Badge tone="accent" dot>
              {edit.calibrateMode === 1 ? '选择第 1 条参照' : '选择第 2 条参照'}
            </Badge>
          )}
          <Button
            disabled={!doc || doc.queueActive}
            onClick={() => setEdit((e) => ({ ...e, stylePanelTab: e.stylePanelTab === 'style' ? 'detail' : 'style' }))}
            title="样式库面板"
          >
            <Palette size={14} /> 样式
          </Button>
        </div>
      )}

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
          {/* M4: 虚拟化 cue 表 */}
          <div className="bg-surface border border-line flex flex-col overflow-hidden min-h-0">
            <div className="px-4 pt-3.5 pb-2 flex items-center gap-2.5">
              <span className="text-micro uppercase tracking-caps text-ink3">
                字幕条目 · <b className="text-ink2 font-medium">CUES</b>
              </span>
              <span className="num text-micro text-ink3">
                {doc.format.toUpperCase()} → {exportFmt} 转换就绪
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <DataTable<Cue>
                columns={columns}
                rows={doc.cues}
                rowKey={(c) => c.index}
                rowHeight={tableRowHeight}
                virtual
                selectedRowKey={selIdx ?? undefined}
                onRowClick={(c) => {
                  if (edit.calibrateMode === 1) {
                    setEdit((e) => ({ ...e, calibrateMode: 2, calibrateAnchor1: { index: c.index, ms: c.startMs } }))
                  } else if (edit.calibrateMode === 2 && edit.calibrateAnchor1) {
                    // 第二锚点：弹窗输入正确时间（Modal）
                    setEdit((e) => ({ ...e, calibrateModal: { index: c.index } }))
                  } else {
                    setSelIdx(c.index)
                  }
                }}
                onRowContextMenu={(e, c) => {
                  e.preventDefault()
                  setSelIdx(c.index)
                  setEdit((ed) => ({
                    ...ed,
                    contextMenu: { x: e.clientX, y: e.clientY, cueIndex: c.index },
                  }))
                }}
                aria-label="字幕条目列表"
              />
            </div>
          </div>

          {/* 右侧：详情 / 样式面板 */}
          <fieldset disabled={!!doc.queueActive} className="bg-surface border border-line p-4 overflow-auto min-h-0 min-w-0">
            <legend className="sr-only">字幕详情与样式编辑</legend>
            {edit.stylePanelTab === 'style' ? (
              /* M4: 样式库面板 */
              <div className="flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-micro uppercase tracking-caps text-ink3">样式库</span>
                  <Button
                    kind="primary"
                    onClick={() =>
                      setEdit((e) => ({
                        ...e,
                        styleModal: {
                          mode: 'new',
                          style: { name: '', fontName: 'Arial', fontSize: 40, primaryRGB: ASS_DEFAULT_PRIMARY_RGB, outlineRGB: ASS_DEFAULT_OUTLINE_RGB, outline: 2, bold: false, alignment: 2, marginV: 20 },
                        },
                      }))
                    }
                  >
                    新建样式
                  </Button>
                </div>
                {styles.map((s) => (
                  <div key={s.name} className="bg-sunken p-3 flex flex-col gap-2">
                    <div className="flex justify-between items-center">
                      <span className="text-body text-ink1 font-medium">{s.name}</span>
                      <Button
                        onClick={() =>
                          setEdit((e) => ({
                            ...e,
                            styleModal: { mode: 'edit', style: { ...s } },
                          }))
                        }
                      >
                        编辑
                      </Button>
                    </div>
                    <div className="text-caption text-ink3">
                      {s.fontName} · {s.fontSize}px · {s.bold ? '粗体' : '常规'} · 对齐 {s.alignment}
                    </div>
                    {selIdx && (
                      <Button
                        onClick={() => doAssignStyle([selIdx], s.name)}
                        title="将选中 cue 指派为此样式"
                      >
                        指派到选中 cue
                      </Button>
                    )}
                  </div>
                ))}
                {/* 预览画布（16:9 模拟，M4 §3） */}
                <div className="mt-2">
                  <div className="text-micro uppercase tracking-caps text-ink3 mb-1.5">预览画布</div>
                  <div className="relative w-full bg-black aspect-video overflow-hidden">
                    {(() => {
                      const c = doc?.cues.find((x) => x.index === selIdx)
                      const text = c?.original || ''
                      const editingStyle = edit.styleModal?.style
                      const cueStyle = c?.styleName ? styles.find((s) => s.name === c.styleName) : undefined
                      const style = editingStyle || cueStyle || { name: 'Default', fontName: 'Arial', fontSize: 40, primaryRGB: ASS_DEFAULT_PRIMARY_RGB, outlineRGB: ASS_DEFAULT_OUTLINE_RGB, outline: 2, bold: false, alignment: 2, marginV: 20 }
                      const scale = 384 / 1080
                      const fontSize = Math.max(8, Math.round(style.fontSize * scale))
                      const outlineWidth = Math.max(1, Math.round(style.outline * scale))
                      const margin = Math.round(style.marginV * scale)
                      // ASS numpad：1=左下 2=中下 3=右下 / 4=左中 5=中中 6=右中 / 7=左上 8=中上 9=右上
                      const pos: Record<number, CSSProperties> = {
                        1: { bottom: margin, left: margin },
                        2: { bottom: margin, left: '50%', transform: 'translateX(-50%)' },
                        3: { bottom: margin, right: margin },
                        4: { top: '50%', left: margin, transform: 'translateY(-50%)' },
                        5: { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' },
                        6: { top: '50%', right: margin, transform: 'translateY(-50%)' },
                        7: { top: margin, left: margin },
                        8: { top: margin, left: '50%', transform: 'translateX(-50%)' },
                        9: { top: margin, right: margin },
                      }
                      const p = pos[style.alignment] || pos[2]
                      return (
                        <div
                          className="absolute px-2"
                          style={{
                            ...p,
                            fontSize,
                            fontFamily: style.fontName,
                            fontWeight: style.bold ? 700 : 400,
                            color: style.primaryRGB,
                            WebkitTextStroke: `${outlineWidth}px ${style.outlineRGB}`,
                            whiteSpace: 'pre-wrap',
                            textAlign: 'center',
                            maxWidth: '90%',
                            lineHeight: 1.3,
                          }}
                        >
                          {text || '（选中条目预览）'}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : selIdx == null ? (
              <div className="text-caption text-ink3 mt-2">点击左侧条目查看详情</div>
            ) : (
              /* 详情面板（M4 行内编辑 + 编辑操作） */
              (() => {
                const c = doc.cues.find((x) => x.index === selIdx)
                if (!c) return <div className="text-caption text-ink3 mt-2">选中条目已不存在（可能刚被删除或重排）</div>
                const editing = edit.editingCell?.index === c.index ? edit.editingCell.field : null
                const startEdit = (field: 'original' | 'translated') => {
                  setEdit((e) => ({
                    ...e,
                    editingCell: { index: c.index, field },
                    editValue: field === 'original' ? c.original : c.translated,
                  }))
                }
                const commitEdit = async () => {
                  if (!edit.editingCell) return
                  const value = edit.editValue
                  const field = edit.editingCell.field
                  const success = await doUpdateCue(c.index, field === 'original' ? { original: value } : { translated: value })
                  if (success) setEdit(e => e.editValue === value && e.editingCell?.index === c.index ? { ...e, editingCell: null, editValue: '' } : e)
                }
                const shiftTime = (field: 'startMs' | 'endMs', delta: number) => {
                  void mutateDoc(id => apiSubShiftCue(id, c.index, field, delta))
                }
                const isLast = c.index >= doc.cues.length
                const editingArea = (
                  <textarea
                    autoFocus
                    value={edit.editValue}
                    onChange={(e) => setEdit((ed) => ({ ...ed, editValue: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                        e.preventDefault()
                        commitEdit()
                      }
                      if (e.key === 'Escape') setEdit((ed) => ({ ...ed, editingCell: null, editValue: '' }))
                    }}
                    className="w-full bg-surface border border-line text-ink1 p-2 text-body"
                    rows={3}
                  />
                )
                return (
                  <div className="flex flex-col gap-2.5">
                    <div className="flex justify-between items-center">
                      <span className="text-micro uppercase tracking-caps text-ink3">
                        CUE #<span className="num">{String(c.index).padStart(4, '0')}</span> · 详情
                      </span>
                    </div>
                    {/* 时间（±100ms 步进） */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-micro text-ink3">起</span>
                      <Button size="sm" onClick={() => shiftTime('startMs', -100)} title="-100ms">-100</Button>
                      <span className="num text-caption text-ink1">{tc(c.startMs)}</span>
                      <Button size="sm" onClick={() => shiftTime('startMs', 100)} title="+100ms">+100</Button>
                      <span className="text-micro text-ink3 ml-2">止</span>
                      <Button size="sm" onClick={() => shiftTime('endMs', -100)} title="-100ms">-100</Button>
                      <span className="num text-caption text-ink1">{tc(c.endMs)}</span>
                      <Button size="sm" onClick={() => shiftTime('endMs', 100)} title="+100ms">+100</Button>
                    </div>
                    {/* 原文（行内编辑） */}
                    <div className="select-text cursor-text bg-sunken p-3 text-body text-ink2 leading-relaxed">
                      {editing === 'original' ? editingArea : c.original}
                      <div className="mt-1.5">
                        <Button size="sm" onClick={() => startEdit('original')}>编辑原文</Button>
                      </div>
                    </div>
                    {/* 译文（行内编辑） */}
                    <div className="select-text cursor-text bg-sunken p-3 text-body text-ok leading-relaxed min-h-11">
                      {editing === 'translated'
                        ? editingArea
                        : (c.translated || <span className="text-ink3">（未翻译）</span>)}
                      <div className="mt-1.5">
                        <Button size="sm" onClick={() => startEdit('translated')}>编辑译文</Button>
                      </div>
                    </div>
                    {c.needsCheck && (
                      <Badge tone="warn" dot>覆写标签回填失败，需人工检查</Badge>
                    )}
                    {/* 编辑操作（M4） */}
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => doSplitCue(c.index, Math.floor((c.startMs + c.endMs) / 2))} title="在中点时间拆分">
                        拆分
                      </Button>
                      <Button size="sm" disabled={isLast} onClick={() => doMergeCues(c.index, c.index + 1)} title="与下一条合并">
                        合并
                      </Button>
                      <Button size="sm" onClick={() => doInsertCue(c.index)} title="在本条后插入 2s 空白">
                        插入
                      </Button>
                      <Button size="sm" onClick={() => doDeleteCues([c.index])} title="删除本条">
                        删除
                      </Button>
                      {c.state === 'failed' && (
                        <Button
                          kind="primary"
                          size="sm"
                          onClick={() => runQueueAction(id => apiSubRetryCues(id, [c.index], queueOpt))}
                        >
                          <RotateCcw size={14} /> 重试本条
                        </Button>
                      )}
                    </div>
                    {c.styleName && (
                      <div className="text-caption text-ink3">
                        样式: <span className="text-ink2">{c.styleName}</span>
                      </div>
                    )}
                  </div>
                )
              })()
            )}
          </fieldset>
        </div>
      )}

      {/* M4: 平移 Modal */}
      <Modal
        open={active && edit.shiftModal}
        onClose={() => setEdit((ed) => ({ ...ed, shiftModal: false }))}
        title="整体平移"
        initialFocus="first"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setEdit((ed) => ({ ...ed, shiftModal: false }))}>
              取消
            </Button>
            <Button
              kind="primary"
              data-modal-initial="confirm"
              onClick={() => {
                const sec = parseFloat(shiftInputRef.current?.value ?? '')
                if (!isNaN(sec)) {
                  doShiftAll(Math.round(sec * 1000))
                  setEdit((ed) => ({ ...ed, shiftModal: false }))
                }
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="text-caption text-ink3 mb-3">输入秒数（正数延后，负数提前）</div>
        <input
          ref={shiftInputRef}
          type="number"
          step="0.1"
          aria-label="平移秒数（正数延后，负数提前）"
          className="bg-sunken border border-line text-ink1 px-3 py-2 text-body w-full"
          placeholder="例如：1.5 或 -0.5"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              const sec = parseFloat((e.target as HTMLInputElement).value)
              if (!isNaN(sec)) {
                doShiftAll(Math.round(sec * 1000))
                setEdit((ed) => ({ ...ed, shiftModal: false }))
              }
            }
          }}
        />
      </Modal>

      {/* M4: 样式编辑 Modal */}
      <Modal
        open={active && !!edit.styleModal}
        onClose={() => setEdit((ed) => ({ ...ed, styleModal: null }))}
        title={edit.styleModal?.mode === 'new' ? '新建样式' : '编辑样式'}
        initialFocus="first"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setEdit((ed) => ({ ...ed, styleModal: null }))}>
              取消
            </Button>
            <Button
              kind="primary"
              data-modal-initial="confirm"
              onClick={() => {
                if (edit.styleModal) {
                  doSetStyle(edit.styleModal.style)
                  setEdit((ed) => ({ ...ed, styleModal: null }))
                }
              }}
            >
              保存
            </Button>
          </>
        }
      >
        {edit.styleModal && (
        <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">名称</span>
                <input
                  type="text"
                  value={edit.styleModal.style.name}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, name: e.target.value } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">字体</span>
                <input
                  type="text"
                  value={edit.styleModal.style.fontName}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, fontName: e.target.value } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">字号</span>
                <input
                  type="number"
                  value={edit.styleModal.style.fontSize}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, fontSize: Number(e.target.value) } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">主色（#RRGGBB）</span>
                <input
                  type="text"
                  value={edit.styleModal.style.primaryRGB}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, primaryRGB: e.target.value } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">描边色（#RRGGBB）</span>
                <input
                  type="text"
                  value={edit.styleModal.style.outlineRGB}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, outlineRGB: e.target.value } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">描边宽度</span>
                <input
                  type="number"
                  step="0.5"
                  value={edit.styleModal.style.outline}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, outline: Number(e.target.value) } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edit.styleModal.style.bold}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, bold: e.target.checked } },
                    }))
                  }
                  className="size-4 accent-(--suj-accent)"
                />
                <span className="text-caption text-ink2">粗体</span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">对齐（1-9，九宫格）</span>
                <input
                  type="number"
                  min="1"
                  max="9"
                  value={edit.styleModal.style.alignment}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, alignment: Number(e.target.value) } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink3">垂直边距</span>
                <input
                  type="number"
                  value={edit.styleModal.style.marginV}
                  onChange={(e) =>
                    setEdit((ed) => ({
                      ...ed,
                      styleModal: { ...ed.styleModal!, style: { ...ed.styleModal!.style, marginV: Number(e.target.value) } },
                    }))
                  }
                  className="bg-sunken border border-line text-ink1 px-3 py-2 text-body"
                />
              </label>
        </div>
        )}
      </Modal>

      {/* M4: 校准第二锚点输入 Modal */}
      <Modal
        open={active && !!edit.calibrateModal}
        onClose={() => setEdit((ed) => ({ ...ed, calibrateModal: null }))}
        title="校准 · 输入正确时间"
        initialFocus="first"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setEdit((ed) => ({ ...ed, calibrateModal: null }))}>
              取消
            </Button>
            <Button
              kind="primary"
              data-modal-initial="confirm"
              onClick={() => {
                // 空输入必须当非法：Number('') === 0 会绕过 isNaN 守卫，
                // 把两点校准的第二锚点当 0ms 执行——整条时间轴被压坏（真机回归抓到）。
                const raw = calibrateInputRef.current?.value.trim() ?? ''
                const ms = Number(raw)
                if (edit.calibrateModal && edit.calibrateAnchor1 && raw !== '' && Number.isFinite(ms) && ms >= 0) {
                  doCalibrate(edit.calibrateAnchor1.index, edit.calibrateAnchor1.ms, edit.calibrateModal.index, ms)
                  setEdit((ed) => ({ ...ed, calibrateMode: 0, calibrateAnchor1: null, calibrateModal: null }))
                }
              }}
            >
              确定
            </Button>
          </>
        }
      >
        <div className="text-caption text-ink3 mb-3">
          输入第 2 条（#{edit.calibrateModal?.index ?? 0}）的正确时间（毫秒）
        </div>
        <input
          ref={calibrateInputRef}
          type="number"
          aria-label="第 2 条参照的正确时间（毫秒）"
          className="bg-sunken border border-line text-ink1 px-3 py-2 text-body w-full"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              const raw = (e.target as HTMLInputElement).value.trim()
              const ms = Number(raw)
              if (edit.calibrateModal && edit.calibrateAnchor1 && raw !== '' && Number.isFinite(ms) && ms >= 0) {
                doCalibrate(edit.calibrateAnchor1.index, edit.calibrateAnchor1.ms, edit.calibrateModal.index, ms)
                setEdit((ed) => ({ ...ed, calibrateMode: 0, calibrateAnchor1: null, calibrateModal: null }))
              }
            }
          }}
        />
      </Modal>

      {/* M4: 右键菜单（拆分/合并/插入/删除/重译） */}
      {active && edit.contextMenu && (
        <>
          {/* 事件捕获层：点击外部关闭 */}
          <div
            className="fixed inset-0 z-40"
            onPointerDown={() => setEdit((ed) => ({ ...ed, contextMenu: null }))}
            onContextMenu={(e) => {
              e.preventDefault()
              setEdit((ed) => ({ ...ed, contextMenu: null }))
            }}
            aria-hidden="true"
          />
          {/* 菜单 */}
          <div
            className="fixed z-50 bg-surface border border-line rounded-sm shadow-lg py-1 min-w-32"
            style={{ left: edit.contextMenu.x, top: edit.contextMenu.y }}
            ref={menuRef}
            onKeyDown={e => {
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
              const at = items.indexOf(document.activeElement as HTMLButtonElement)
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault()
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                items[next]?.focus()
              }
              if (e.key === 'Escape' || e.key === 'Tab') setEdit(ed => ({ ...ed, contextMenu: null }))
            }}
            role="menu"
            aria-label="字幕条目操作"
          >
            {(() => {
              const c = doc?.cues.find((x) => x.index === edit.contextMenu!.cueIndex)
              if (!c) return null
              const isLast = c.index >= (doc?.cues.length ?? 0)
              const close = () => setEdit((ed) => ({ ...ed, contextMenu: null }))
              const item = (label: string, action: () => void, disabled = false) => (
                <button
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={() => {
                    action()
                    close()
                  }}
                  className="block w-full text-left px-3 py-1.5 text-caption text-ink1 hover:bg-sunken disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  {label}
                </button>
              )
              return (
                <>
                  {item('拆分（中点）', () => doSplitCue(c.index, Math.floor((c.startMs + c.endMs) / 2)), !!doc?.queueActive)}
                  {item('合并（与下一条）', () => doMergeCues(c.index, c.index + 1), isLast || !!doc?.queueActive)}
                  {item('插入（本条后）', () => doInsertCue(c.index), !!doc?.queueActive)}
                  {item('删除', () => doDeleteCues([c.index]), !!doc?.queueActive)}
                  {c.state === 'failed' &&
                    item('重译本条', () => {
                      void runQueueAction(id => apiSubRetryCues(id, [c.index], queueOpt))
                    })}
                </>
              )
            })()}
          </div>
        </>
      )}
      <Modal open={active && confirmFull} onClose={() => setConfirmFull(false)} title="重新翻译全部字幕？" footer={<><Button data-modal-initial="cancel" onClick={() => setConfirmFull(false)}>取消</Button><Button kind="primary" onClick={() => { setConfirmFull(false); void startFull() }}>确认全部翻译</Button></>}>
        将覆盖现有译文和人工修改，并清空撤销历史。请先导出需要保留的内容。新任务使用当前目标语言和术语本。
      </Modal>
      <Modal open={active && confirmExport} onClose={() => setConfirmExport(false)} title="确认导出字幕" footer={<><Button data-modal-initial="cancel" onClick={() => setConfirmExport(false)}>取消</Button><Button kind="primary" onClick={doExport}>保存字幕</Button></>}>
        <p>{exportFmt} · {bilingual} · 共 {doc?.cues.length ?? 0} 条。未翻译行保留原文；失败行可能保留旧译文，请人工核对。</p>
        <label className="mt-3 flex items-center gap-2">编码<select aria-label="导出编码" className="bg-sunken border border-line p-2" value={exportEncoding} onChange={e => setExportEncoding(e.target.value)}><option value="utf-8">UTF-8</option><option value="gbk">GBK</option></select></label>
        {doc?.format === 'ass' && exportFmt !== 'ASS' && <p className="text-warn mt-2">此格式不会保留 ASS 字体、样式与特效。</p>}
        {exportFmt === 'LRC' && <p className="text-warn mt-2">LRC 仅保留起始时间，结束时间和重叠显示方式由播放器决定。</p>}
        {bilingual === '原文另存' && <p className="mt-2">另存的 .orig 文件也可能替换同名文件；两个文件会先完成写入再替换。</p>}
      </Modal>
    </div>
  )
}
