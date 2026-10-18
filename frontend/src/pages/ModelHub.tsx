// 模型中心（01 文档 §6.4）· Track C 迁移版（2026-10-06）
// 新设计系统组合（Badge/Button/Modal/Progress/Segmented）+ 瑞士 token +
// 未知模型归位（apiListUnknownModels/apiAssignUnknown 接线）+
// alert/confirm 全部下线（toast + 破坏性确认 Modal，初始焦点在取消）+
// 激活条件：模型文件已登记即可启用（此前写死只允许 translate，下载完的模型选不了）；
// 对暂无专属消费界面的模型如实标注后果，不禁止选择。
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, FolderOpen, Pause, Trash2 } from 'lucide-react'
import { Badge, Button, Modal, Progress, Segmented } from '../components/ui/index'
import { toast } from '../stores/toastStore'
import { useAppStore } from '../stores/appStore'
import { on, EV } from '../lib/wails'
import {
  apiListModels,
  apiGetDownloadLocation,
  apiListUnknownModels,
  apiAssignUnknown,
  apiDownloadModel,
  apiCancelDownload,
  apiDeleteModel,
  apiSetActiveModel,
  apiKeepAlive,
  apiOpenModelsFolder,
} from '../wailsapi'

type Quant = 'Q4_K_M' | 'Q8_0'
type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

/** 后端 modelmanager.DownloadProgress 的前端形状（事件 model:progress 与 ListModels.download 共用） */
interface DlProgress {
  modelId?: string
  quant?: string
  phase?: 'probing' | 'downloading' | 'verifying' | 'done' | 'failed' | 'canceled'
  bytesDone?: number
  bytesTotal?: number
  speedBPS?: number
  source?: string
  message?: string
  receivedAt?: number
}

const STATE_META: Record<string, { text: string; tone: BadgeTone }> = {
  'not-downloaded': { text: '未下载', tone: 'neutral' },
  downloading: { text: '下载中', tone: 'warn' },
  ready: { text: '就绪', tone: 'accent' },
  loading: { text: '加载中', tone: 'warn' },
  running: { text: '运行中', tone: 'ok' },
  sleeping: { text: '休眠', tone: 'neutral' },
  crashed: { text: '崩溃', tone: 'danger' },
}

const MODEL_NAMES: Record<string, string> = {
  translate: 'Index-Translate-2B（主翻译）',
  nailong: 'Index-Nailong-2B（长文档）',
  homura: 'Index-Homura-2B（配音）',
}

const errToast = (e: unknown) =>
  toast.push({ tone: 'error', message: String((e as { message?: string })?.message ?? e) })

export function ModelHub() {
  const status = useAppStore((s) => s.status)
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const [location, setLocation] = useState<{ path: string; freeBytes: number; known: boolean } | null>(null)
  const [clock, setClock] = useState(Date.now())
  const tasks = useAppStore(s => s.pageTasks)
  const busy = Object.values(tasks).some(Boolean) || (status?.activeTasks ?? 0) > 0
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { apiGetDownloadLocation().then(setLocation).catch(() => {}) }, [])
  const [models, setModels] = useState<any[]>([])
  /* 后端 ListUnknownModels 返回的是 []ModelInfo（含 path 字段），不是字符串数组 ——
     这里在边界上取 path，页面其余部分只认字符串键。 */
  const [unknowns, setUnknowns] = useState<string[]>([])
  const [quantSel, setQuantSel] = useState<Record<string, Quant>>({})
  // 未知文件归位：每行的 (model, quant) 选择
  const [assignSel, setAssignSel] = useState<Record<string, { id: string; quant: Quant }>>({})
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  // 下载进度的实时缓存（按模型 id）。事件驱动 → 卡片立刻有反馈；
  // 终态清掉，避免下载完成后残留一条 100% 的死进度条。
  const [live, setLive] = useState<Record<string, DlProgress>>({})
  // 破坏性删除确认（Modal，初始焦点在取消）
  const [pendingDelete, setPendingDelete] = useState<{ id: string; quant: Quant; name: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      setModels((await apiListModels()) ?? [])
      const unknownInfo = (await apiListUnknownModels()) ?? []
      setUnknowns(unknownInfo.map((m: { path?: string }) => m?.path ?? '').filter(Boolean))
    } catch {
      /* runtime */
    }
  }, [])

  const dropLive = useCallback((id: string) => {
    setLive((s) => {
      if (!(id in s)) return s
      const next = { ...s }
      delete next[id]
      return next
    })
  }, [])

  useEffect(() => {
    refresh()
    const off = on(EV.MODEL_PROGRESS, (e) => {
      const p = { ...(e ?? {}), receivedAt: Date.now() } as DlProgress
      const id = p.modelId
      if (!id) return
      switch (p.phase) {
        case 'probing':
          setProbeMsg(p.message ?? '探测 HF / ModelScope 双源…')
          break
        case 'downloading':
          setProbeMsg(null)
          setLive((s) => ({ ...s, [id]: p }))
          break
        case 'verifying':
          // 1.3GB 的 SHA256 要几秒，是真死时间：把最后一段显示成"校验中"而不是停在 99%
          setLive((s) => ({ ...s, [id]: { ...p, bytesDone: p.bytesTotal } }))
          break
        case 'done':
          dropLive(id)
          setProbeMsg(null)
          refresh()
          refreshStatus()
          toast.push({ tone: 'ok', message: `${MODEL_NAMES[id] ?? id} 下载完成 · SHA256 校验通过` })
          break
        case 'canceled':
          dropLive(id)
          refresh()
          toast.push({ tone: 'warn', message: '已停止下载，进度保留；再次点下载可续传' })
          break
        case 'failed':
          dropLive(id)
          refresh()
          toast.push({ tone: 'error', message: `下载失败：${p.message ?? '未知原因'}` })
          break
      }
    })
    const off2 = on(EV.MODELS_UPDATED, refresh)
    return () => {
      off()
      off2()
    }
  }, [refresh, refreshStatus, dropLive])

  const gpuTotal = status?.gpu?.totalMB ?? 0
  const gpuUsed = status?.gpu?.usedMB ?? 0

  const doAssign = (path: string) => {
    const sel = assignSel[path] ?? { id: 'translate', quant: 'Q4_K_M' as Quant }
    apiAssignUnknown(path, sel.id, sel.quant)
      .then(() => {
        toast.push({ tone: 'ok', message: '已归位并重新登记' })
        refresh()
      })
      .catch(errToast)
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-auto screen-in">
      <p className="text-caption text-ink2">模型目录：{location?.path ?? '正在读取…'} · 剩余空间：{location?.known ? `${(location.freeBytes / (1 << 30)).toFixed(1)} GB` : '暂不可用'}。同源且文件未变更时续传；切源或内容更新会重新下载。下载或校验失败可重试，校验通过后才能使用。</p>
      {/* 顶部：VRAM 仪表（窄窗加固：flex-wrap 整块换行，VRAM 条可收缩，按钮不折字） */}
      <div className="bg-surface border border-line flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
        <span className="text-micro uppercase tracking-caps text-ink3">
          模型中心 · <b className="text-ink2 font-medium">MODEL HUB</b>
        </span>
        <span className="w-px h-5 bg-lineStrong" />
        {gpuTotal > 0 ? (
          <div className="flex min-w-0 flex-1 basis-64 max-w-80 items-center gap-3">
            <span className="text-micro uppercase tracking-caps text-ink3">GPU 总占用</span>
            <Progress pct={(gpuUsed / gpuTotal) * 100} tone="ok" label="显卡全部进程的显存总占用" />
            <Badge>
              <span className="num">{(gpuUsed / 1024).toFixed(1)} / {(gpuTotal / 1024).toFixed(1)} GB</span>
            </Badge>
          </div>
        ) : (
          <Badge tone="warn" dot>
            未检测到 NVIDIA GPU · CPU 推理模式
          </Badge>
        )}
        {status?.gpu?.present && (
          <Badge tone="ok" dot className="max-w-72 truncate" title={status.gpu.name}>
            GPU: {status.gpu.name}
          </Badge>
        )}
        <Badge tone="neutral" dot title="存储位置：models/（随 exe 所在目录，便携布局）">
          存储：models/
        </Badge>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button className="whitespace-nowrap" onClick={() => apiOpenModelsFolder().catch(errToast)}>
            <FolderOpen size={14} /> 打开模型文件夹
          </Button>
        </div>
      </div>

      {/* 三模型卡片 */}
      <div className="grid grid-cols-2 wide:grid-cols-3 gap-4">
        {models.map((m, i) => {
          const st = STATE_META[m.state] ?? { text: m.state, tone: 'neutral' as BadgeTone }
          const quant = quantSel[m.id] ?? 'Q4_K_M'
          // 事件实时值优先；回落到 ListModels 的快照，这样切页回来也看得到进度
          const dl: DlProgress | undefined = live[m.id] ?? m.download
          const curQuant = m.quants?.find((q: any) => q.quant === quant)
          const present = curQuant?.present
          const downloading = m.state === 'downloading'
          const verifying = downloading && dl?.phase === 'verifying'
          const pct = dl?.bytesTotal && dl.bytesTotal > 0 ? Math.min(100, ((dl.bytesDone ?? 0) / dl.bytesTotal) * 100) : 0
          // 激活条件：文件已登记进 store 即可。不再要求 sha256 非空——导入件与
          // 未校验档位可能没有哈希，写死会让本来能用的模型选不了；校验状态卡片上已如实显示。
          const activatable = !!present
          const noConsumer = m.id === 'nailong'
          const requiredBytes = (curQuant?.sizeBytes || (quant === 'Q4_K_M' ? 1.31 : 2.08) * (1 << 30)) * 1.2
          const insufficientDisk = !!location?.known && location.freeBytes < requiredBytes
          return (
            <div
              key={m.id}
              className="bg-surface border border-line flex flex-col overflow-hidden screen-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="px-4 pt-4 flex items-start gap-3">
                <div
                  className={`w-10 h-10 grid place-items-center font-semibold text-body ${
                    m.id === 'translate'
                      ? 'bg-accentSoft text-accent'
                      : m.id === 'nailong'
                        ? 'bg-warnSoft text-warn'
                        : 'bg-okSoft text-ok'
                  }`}
                >
                  {m.id === 'translate' ? 'T' : m.id === 'nailong' ? 'N' : 'H'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-title font-bold">{m.name}</div>
                  <div className="text-micro text-ink3 mt-0.5">{m.role} · {m.languages}</div>
                </div>
                <Badge tone={st.tone} dot>
                  {downloading && dl ? (verifying ? '校验中' : `${st.text} ${Math.round(pct)}%`) : st.text}
                </Badge>
              </div>
              <div className="px-4 pt-3 flex gap-2 flex-wrap">
                <Badge>
                  <span className="num">
                    {quant} · {curQuant?.present ? `${(curQuant.sizeBytes / (1 << 30)).toFixed(2)}GB` : `≈${(quant === 'Q4_K_M' ? 1.31 : 2.08).toFixed(2)}GB`}
                  </span>
                </Badge>
                {m.port ? <Badge><span className="num">: {m.port}</span></Badge> : null}
                {m.source ? (
                  <Badge tone="ok" dot>
                    {m.source === 'hf' ? 'HF 源' : m.source === 'modelscope' ? 'ModelScope' : m.source}
                  </Badge>
                ) : null}
              </div>
              <div className="px-4 py-3 flex flex-col gap-3 flex-1">
                {downloading && dl ? (
                  <div className="flex flex-col gap-2">
                    <Progress pct={verifying ? 100 : pct} indeterminate={!verifying && !(dl.bytesTotal && dl.bytesTotal > 0)} tone="warn" label={`${m.name} 下载进度`} />
                    <div className="flex justify-between text-micro text-ink3 tracking-wide">
                      <span className="num">
                        {verifying
                          ? 'SHA256 校验中…'
                          : `${(dl.bytesDone ?? 0) / (1 << 20) | 0} / ${dl.bytesTotal && dl.bytesTotal > 0 ? `${dl.bytesTotal / (1 << 20) | 0} MB` : '总大小未知'}${
                              dl.receivedAt && clock - dl.receivedAt < 5000 && dl.speedBPS ? ` · ${(dl.speedBPS / (1 << 20)).toFixed(1)} MB/s` : ' · 等待数据，速度暂不可用'
                            }`}
                      </span>
                      <span>{dl.source ? `${dl.source === 'hf' ? 'HF' : 'ModelScope'} · ` : ''}{verifying ? '校验后自动登记' : '支持断点续传'}</span>
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-between text-caption text-ink3 items-center">
                  <span>量化档位</span>
                  <Segmented<'Q4_K_M' | 'Q8_0'>
                    options={['Q4_K_M', 'Q8_0'] as const}
                    value={quant}
                    size="sm"
                    aria-label={`${m.name} 量化档位`}
                    onChange={(v) => setQuantSel((s) => ({ ...s, [m.id]: v }))}
                  />
                </div>
                {present ? (
                  <>
                    <div className="flex justify-between text-caption text-ink3">
                      <span>SHA256</span>
                      <b className="text-ink2 font-medium inline-flex items-center gap-1">
                        {curQuant.sha256 ? (
                          <>
                            <Check size={11} strokeWidth={2.5} aria-hidden="true" /> 校验通过
                          </>
                        ) : (
                          '未校验'
                        )}
                      </b>
                    </div>
                    <div className="flex justify-between text-caption text-ink3">
                      <span>路径</span>
                      <b className="text-ink2 font-medium text-micro truncate max-w-56">{curQuant.path}</b>
                    </div>
                  </>
                ) : null}
                <div className="mt-auto flex gap-2 pt-1">
                  {m.state === 'downloading' ? (
                    <>
                      <Button onClick={() => apiCancelDownload(m.id).catch(errToast)}>
                        <Pause size={14} /> 停止下载（保留进度）
                      </Button>

                    </>
                  ) : present ? (
                    <>
                      <Button
                        kind={m.active ? 'primary' : 'secondary'}
                        disabled={busy || (!activatable && !m.active)}
                        title={
                          activatable
                            ? noConsumer
                              ? '主翻译台目前用通用提示词驱动该模型（文档翻译页使用专用模板）'
                              : undefined
                            : '模型文件尚未下载，无法设为当前'
                        }
                        onClick={() =>
                          apiSetActiveModel(m.id)
                            .then(refreshStatus)
                            .catch(errToast)
                        }
                      >
                        {m.active ? '当前模型' : '设为当前'}
                      </Button>
                      <Button kind="danger" onClick={() => setPendingDelete({ id: m.id, quant, name: m.name })}>
                        <Trash2 size={14} /> 删除
                      </Button>
                    </>
                  ) : (
                    <Button
                      kind="primary"
                      disabled={insufficientDisk}
                      title={insufficientDisk ? '磁盘空间不足，请释放空间或迁移项目目录后重试' : undefined}
                      arrow
                      onClick={() =>
                        apiDownloadModel(m.id, quant)
                          .then(() => {
                            // DownloadModel 是异步的（Go 侧起 goroutine 立即返回），
                            // 这里必须给反馈，否则点了就是"什么都没发生"
                            toast.push({ tone: 'info', message: `开始下载 ${m.name} ${quant}（先探测双源）` })
                            refresh()
                          })
                          .catch(errToast)
                      }
                    >
                      下载 {quant}
                    </Button>
                  )}
                </div>
                {insufficientDisk && !present && <p className="text-caption text-danger">空间不足：含余量约需 {(requiredBytes / (1 << 30)).toFixed(1)} GB，请释放空间或迁移项目目录。</p>}
              </div>
              {/* 已激活但没有专属消费界面的模型：如实说明后果，而不是不让选 */}
              {m.active && noConsumer && (
                <div className="border-t border-line bg-warnSoft px-4 py-2 flex items-center gap-2 text-micro text-warn">
                  <AlertTriangle size={12} aria-hidden="true" />
                  主翻译台将用通用提示词驱动此模型（{quant}）
                </div>
              )}
              {m.state === 'running' && (
                <div className="border-t border-line bg-accentSoft px-4 py-2 flex items-center gap-2 text-micro text-accent">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" aria-hidden="true" />
                  {(status?.activeTasks ?? 0) > 0 ? '任务进行中 · 保持加载' : '连续 30 分钟无操作后提示，倒计时 30 秒释放'}
                  <button
                    type="button"
                    className="ml-auto text-accent cursor-pointer bg-transparent border-0 text-micro"
                    onClick={() => apiKeepAlive().catch(errToast)}
                  >
                    保持加载
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 未知文件归位（models/ 内无法自动识别的 .gguf） */}
      {unknowns.length > 0 && (
        <div className="bg-surface border border-line px-5 py-3.5 flex flex-col gap-2.5">
          <span className="text-micro uppercase tracking-caps text-ink3">
            未知文件 · <b className="text-ink2 font-medium">UNASSIGNED</b>
          </span>
          {unknowns.map((path) => {
            const sel = assignSel[path] ?? { id: 'translate', quant: 'Q4_K_M' as Quant }
            const name = path.split('\\').pop() ?? path
            return (
              <div key={path} className="flex items-center gap-3 text-caption text-ink2">
                <span className="truncate flex-1" title={path}>{name}</span>
                <select
                  aria-label={`${name} 归位模型`}
                  value={sel.id}
                  onChange={(e) => setAssignSel((s) => ({ ...s, [path]: { ...sel, id: e.target.value } }))}
                  className="h-(--suj-h-control-sm) bg-sunken border border-line px-2 text-caption text-ink1"
                >
                  <option value="translate">translate</option>
                  <option value="nailong">nailong</option>
                  <option value="homura">homura</option>
                </select>
                <Segmented<'Q4_K_M' | 'Q8_0'>
                  size="sm"
                  options={['Q4_K_M', 'Q8_0'] as const}
                  value={sel.quant}
                  aria-label={`${name} 量化档位`}
                  onChange={(v) => setAssignSel((s) => ({ ...s, [path]: { ...sel, quant: v } }))}
                />
                <Button size="sm" onClick={() => doAssign(path)}>
                  归位
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {/* 下载源面板 */}
      <div className="bg-surface border border-line px-5 py-3.5 flex gap-3 items-center">
        <span className="text-micro uppercase tracking-caps text-ink3">
          下载源 · <b className="text-ink2 font-medium">SOURCE</b>
        </span>
        <Badge tone="ok" dot>
          双源探测：HF / ModelScope 择优
        </Badge>
        <Badge>续传仅限同源 · 切源将重新下载</Badge>
        {probeMsg && <Badge tone="warn" dot>{probeMsg}</Badge>}
      </div>

      {/* 删除确认（破坏性：初始焦点在取消，防回车误删） */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="删除模型文件"
        initialFocus="cancel"
        footer={
          <>
            <Button data-modal-initial="cancel" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              kind="danger"
              data-modal-initial="confirm"
              onClick={() => {
                if (!pendingDelete) return
                apiDeleteModel(pendingDelete.id, pendingDelete.quant)
                  .then(() => {
                    toast.push({ tone: 'ok', message: '已删除' })
                    refresh()
                  })
                  .catch(errToast)
                setPendingDelete(null)
              }}
            >
              <Trash2 size={14} /> 删除
            </Button>
          </>
        }
      >
        <p className="text-body text-ink2">
          将删除 <b className="text-ink1">{pendingDelete?.name}</b> 的{' '}
          <span className="num">{pendingDelete?.quant}</span> 档位文件，此操作不可恢复。
        </p>
      </Modal>
    </div>
  )
}
