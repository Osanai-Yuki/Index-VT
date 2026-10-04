// 模型中心（01 文档 §6.4 / mockups 屏 4）：三模型卡片七态、下载/取消/导入/删除、
// 双源择优徽标、VRAM 仪表、空闲释放倒计时、保持加载。
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, Upload, Trash2, Pause, X } from 'lucide-react'
import { Chip, Btn, Seg, Progress } from '../components/ui'
import { useAppStore } from '../stores/appStore'
import {
  apiListModels,
  apiDownloadModel,
  apiCancelDownload,
  apiDeleteModel,
  apiSetActiveModel,
  apiKeepAlive,
  apiOpenModelsFolder,
  eventsOn,
} from '../wailsapi'

const STATE_META: Record<string, { text: string; tone: 'on' | 'amber' | 'warn' | 'blue' | 'danger' | 'default' }> = {
  'not-downloaded': { text: '未下载', tone: 'default' },
  downloading: { text: '下载中', tone: 'warn' },
  ready: { text: '就绪', tone: 'blue' },
  loading: { text: '加载中', tone: 'amber' },
  running: { text: '运行中', tone: 'on' },
  sleeping: { text: '休眠', tone: 'default' },
  crashed: { text: '崩溃', tone: 'danger' },
}

export function ModelHub() {
  const status = useAppStore((s) => s.status)
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const [models, setModels] = useState<any[]>([])
  const [quantSel, setQuantSel] = useState<Record<string, string>>({})
  const [probeMsg, setProbeMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setModels((await apiListModels()) ?? [])
    } catch {
      /* runtime */
    }
  }, [])

  useEffect(() => {
    refresh()
    const off = eventsOn('model:progress', (p: any) => {
      if (p?.phase === 'probing') setProbeMsg(p.message)
      if (p?.phase === 'downloading') setProbeMsg(null)
      refresh()
    })
    const off2 = eventsOn('models:updated', refresh)
    return () => {
      off()
      off2()
    }
  }, [refresh])

  const gpuTotal = status?.gpu?.totalMB ?? 0
  const gpuUsed = status?.gpu?.usedMB ?? 0

  return (
    <div className="flex flex-col gap-4 h-full overflow-auto screen-in">
      {/* 顶部：VRAM 仪表 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] flex items-center gap-4 px-5 py-4">
        <span className="label">
          模型中心 · <b>MODEL HUB</b>
        </span>
        <span className="w-px h-5 bg-hairline-2" />
        {gpuTotal > 0 ? (
          <div className="flex items-center gap-3">
            <span className="label">VRAM</span>
            <div className="w-[200px]">
              <Progress pct={(gpuUsed / gpuTotal) * 100} teal />
            </div>
            <Chip>
              {(gpuUsed / 1024).toFixed(1)} / {(gpuTotal / 1024).toFixed(1)} GB
            </Chip>
          </div>
        ) : (
          <Chip tone="warn" dot>
            未检测到 NVIDIA GPU · CPU 推理模式
          </Chip>
        )}
        {status?.gpu?.present && (
          <Chip tone="on" dot>
            GPU: {status.gpu.name}
          </Chip>
        )}
        <Chip tone="blue" dot>
          存储: .\models\（项目文件夹）
        </Chip>
        <div className="ml-auto flex gap-2">
          <Btn onClick={() => apiOpenModelsFolder().catch(() => {})}>
            <FolderOpen size={14} /> 打开模型文件夹
          </Btn>
        </div>
      </div>

      {/* 三模型卡片 */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {models.map((m, i) => {
          const st = STATE_META[m.state] ?? { text: m.state, tone: 'default' as const }
          const quant = quantSel[m.id] ?? 'Q4_K_M'
          const dl = m.download
          const curQuant = m.quants?.find((q: any) => q.quant === quant)
          const present = curQuant?.present
          return (
            <div
              key={m.id}
              className="bg-bg-1 border border-hairline rounded-[14px] flex flex-col overflow-hidden screen-in"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="px-4.5 pt-4 px-4 flex items-start gap-3">
                <div
                  className={`w-[42px] h-[42px] rounded-[11px] grid place-items-center font-mono font-semibold text-[13px] ${
                    m.id === 'translate'
                      ? 'bg-accent-soft text-accent shadow-[0_0_0_1px_var(--accent-line)]'
                      : m.id === 'nailong'
                        ? 'bg-info-soft text-info'
                        : 'bg-teal-soft text-teal'
                  }`}
                >
                  {m.id === 'translate' ? 'T' : m.id === 'nailong' ? 'N' : 'H'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold">{m.name}</div>
                  <div className="text-[11.5px] text-ink-3 mt-0.5">{m.role} · {m.languages}</div>
                </div>
                <Chip tone={st.tone} dot>
                  {m.state === 'downloading' && dl ? `${st.text} ${Math.round((dl.bytesDone / Math.max(1, dl.bytesTotal)) * 100)}%` : st.text}
                </Chip>
              </div>
              <div className="px-4 pt-3 flex gap-2 flex-wrap">
                <Chip>
                  {quant} · {curQuant?.present ? `${(curQuant.sizeBytes / (1 << 30)).toFixed(2)}GB` : `≈${(quant === 'Q4_K_M' ? 1.31 : 2.08).toFixed(2)}GB`}
                </Chip>
                {m.port ? <Chip>: {m.port}</Chip> : null}
                {m.source ? (
                  <Chip tone="on" dot>
                    {m.source === 'hf' ? 'HF 源' : m.source === 'modelscope' ? 'ModelScope' : m.source}
                  </Chip>
                ) : null}
              </div>
              <div className="px-4 py-3 flex flex-col gap-3 flex-1">
                {m.state === 'downloading' && dl ? (
                  <div className="flex flex-col gap-2">
                    <Progress pct={(dl.bytesDone / Math.max(1, dl.bytesTotal)) * 100} />
                    <div className="flex justify-between font-mono text-[10px] text-ink-3 tracking-wide">
                      <span>
                        {(dl.bytesDone / (1 << 20)).toFixed(0)} / {(dl.bytesTotal / (1 << 20)).toFixed(0)} MB
                        {dl.speedBPS > 0 ? ` · ${(dl.speedBPS / (1 << 20)).toFixed(1)} MB/s` : ''}
                      </span>
                      <span>支持断点续传</span>
                    </div>
                  </div>
                ) : null}
                <div className="flex justify-between text-xs text-ink-3 items-center">
                  <span>量化档位</span>
                  <Seg
                    options={['Q4_K_M', 'Q8_0']}
                    value={quant}
                    accentSel
                    onChange={(v) => setQuantSel((s) => ({ ...s, [m.id]: v }))}
                  />
                </div>
                {present ? (
                  <>
                    <div className="flex justify-between text-xs text-ink-3">
                      <span>SHA256</span>
                      <b className="text-ink-2 font-mono font-medium">
                        {curQuant.sha256 ? '✓ 校验通过' : '未校验'}
                      </b>
                    </div>
                    <div className="flex justify-between text-xs text-ink-3">
                      <span>路径</span>
                      <b className="text-ink-2 font-mono font-medium text-[11px] truncate max-w-[220px]">
                        {curQuant.path}
                      </b>
                    </div>
                  </>
                ) : null}
                <div className="mt-auto flex gap-2 pt-1">
                  {m.state === 'downloading' ? (
                    <>
                      <Btn onClick={() => apiCancelDownload(m.id).catch(() => {})}>
                        <Pause size={14} /> 暂停
                      </Btn>
                      <Btn kind="danger" onClick={() => apiCancelDownload(m.id).catch(() => {})}>
                        <X size={14} /> 取消
                      </Btn>
                    </>
                  ) : present ? (
                    <>
                      <Btn
                        kind={m.active ? 'primary' : 'secondary'}
                        onClick={() => apiSetActiveModel(m.id).then(refreshStatus).catch((e) => alert(e))}
                      >
                        {m.active ? '当前模型' : '设为当前'}
                      </Btn>
                      <Btn kind="danger" onClick={() => {
                        if (confirm(`删除 ${m.name} ${quant}？此操作不可恢复。`)) {
                          apiDeleteModel(m.id, quant).then(refresh).catch((e) => alert(e))
                        }
                      }}>
                        <Trash2 size={14} /> 删除
                      </Btn>
                    </>
                  ) : (
                    <Btn kind="primary" onClick={() => apiDownloadModel(m.id, quant).then(refresh).catch((e) => alert(e))}>
                      下载 {quant}
                    </Btn>
                  )}
                </div>
              </div>
              {m.state === 'running' && (
                <div className="border-t border-hairline bg-accent-soft px-4 py-2 flex items-center gap-2 text-[11.5px] text-accent">
                  <span className="font-mono">●</span> 空闲 {Math.max(0, (status?.idleMinutes ?? 5) * 60 - (status?.idleSeconds ?? 0))}s 后自动释放
                  <button className="ml-auto btn-ghost text-accent cursor-pointer bg-transparent border-0" onClick={() => apiKeepAlive().catch(() => {})}>
                    保持加载
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 下载源面板 */}
      <div className="bg-bg-1 border border-hairline rounded-[14px] px-5 py-3.5 flex gap-3 items-center">
        <span className="label">
          下载源 · <b>SOURCE</b>
        </span>
        <Chip tone="on" dot>
          双源探测：HF / ModelScope 择优
        </Chip>
        <Chip>续传仅限同源 · 切源将重新下载</Chip>
        {probeMsg && <Chip tone="amber" dot>{probeMsg}</Chip>}
      </div>
    </div>
  )
}
