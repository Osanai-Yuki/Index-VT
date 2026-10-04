// 首次引导（01 文档 §6.4 / mockups 屏 6）：4 步向导
// ① 环境检测（GPU/llama-server/残留清扫）→ ② 本地扫描 → ③ 模型下载 → ④ 就绪试译。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Btn, Chip, Progress } from '../components/ui'
import {
  apiProbeEnv,
  apiListModels,
  apiDownloadModel,
  apiCancelDownload,
  apiTranslate,
  eventsOn,
} from '../wailsapi'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(1)
  const [env, setEnv] = useState<any>(null)
  const [models, setModels] = useState<any[]>([])
  const [dl, setDl] = useState<any>(null)
  const [trial, setTrial] = useState<{ state: 'idle' | 'running' | 'ok' | 'err'; output?: string; err?: string; ttft?: number }>({ state: 'idle' })
  const startedRef = useRef(false)

  const refreshModels = useCallback(() => {
    apiListModels().then(setModels).catch(() => {})
  }, [])

  useEffect(() => {
    apiProbeEnv().then((info) => {
      setEnv(info)
      setStep(2)
      // 扫描结果 → 若已有模型直接进入试译步
      return apiListModels()
    }).then((ms) => {
      setModels(ms ?? [])
      const hasModel = (ms ?? []).some((m: any) => m.quants?.some((q: any) => q.present))
      setStep(hasModel ? 4 : 3)
    }).catch(() => setStep(3))
  }, [])

  // 下载进度事件
  useEffect(() => {
    const off = eventsOn('model:progress', (p: any) => {
      setDl(p)
      if (p?.phase === 'done') {
        refreshModels()
      }
    })
    const off2 = eventsOn('models:updated', refreshModels)
    return () => {
      off()
      off2()
    }
  }, [refreshModels])

  const startDownload = () => {
    if (startedRef.current) return
    startedRef.current = true
    apiDownloadModel('translate', 'Q4_K_M').catch(() => {})
  }

  // 第 3 步自动开始下载 Translate Q4_K_M
  useEffect(() => {
    if (step === 3) startDownload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // 第 4 步自动试译
  useEffect(() => {
    if (step !== 4 || trial.state !== 'idle') return
    const hasTranslate = models.find((m) => m.id === 'translate')?.quants?.some((q: any) => q.present)
    if (!hasTranslate) return
    setTrial({ state: 'running' })
    apiTranslate({ sourceLang: 'zh', targetLang: 'en', text: '你好，世界。欢迎使用 Index-VT。' })
      .then((h) => {
        const off = eventsOn('translate:done', (d: any) => {
          if (d.taskId !== h.taskId) return
          if (d.error) setTrial({ state: 'err', err: d.error })
          else setTrial({ state: 'ok', output: d.output, ttft: d.firstTokenMs })
        })
        window.setTimeout(off, 60000)
      })
      .catch((e) => setTrial({ state: 'err', err: String(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, models, trial.state])

  const dlPct = dl?.bytesTotal > 0 ? Math.round((dl.bytesDone / dl.bytesTotal) * 100) : 0

  return (
    <div className="h-full grid place-items-center overflow-auto">
      <div className="w-[640px] bg-bg-1 border border-hairline rounded-[14px] shadow-[var(--shadow-1)] overflow-hidden">
        {/* 步骤条 */}
        <div className="flex items-center px-7 pt-5 pb-4 border-b border-hairline">
          <Step n={1} label="环境检测" state={step > 1 ? 'done' : step === 1 ? 'cur' : 'todo'} />
          <Ln />
          <Step n={2} label="本地扫描" state={step > 2 ? 'done' : step === 2 ? 'cur' : 'todo'} />
          <Ln />
          <Step n={3} label="模型下载" state={step > 3 ? 'done' : step === 3 ? 'cur' : 'todo'} />
          <Ln />
          <Step n={4} label="就绪验证" state={step === 4 ? 'cur' : 'todo'} />
        </div>

        <div className="px-7 py-6 flex flex-col gap-4">
          <div>
            <div className="text-[17px] font-bold">
              {step === 1 && '正在检测运行环境'}
              {step === 2 && '扫描本地模型'}
              {step === 3 && '下载核心翻译模型'}
              {step === 4 && '就绪试译'}
            </div>
            <div className="text-[12.5px] text-ink-3 mt-1">
              {step === 3 && (
                <>
                  模型将保存到项目文件夹 <span className="font-mono text-ink-2">.\models\</span>，
                  便携可迁移；也可跳过下载，稍后从本地导入 .gguf
                </>
              )}
              {step === 4 && '预置一句话翻译，验证全链路（模型加载 → 推理 → 流式输出）'}
              {(step === 1 || step === 2) && '全部检测在本机完成，无网络请求'}
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {env && (
              <>
                <Ck
                  ok={env.gpu.present}
                  text={
                    env.gpu.present
                      ? <>检测到 NVIDIA GPU <b>{env.gpu.name} · {(env.gpu.totalMB / 1024).toFixed(0)}GB</b></>
                      : <>未检测到 NVIDIA GPU，将以 <b>CPU 模式</b>运行（速度约为 GPU 的 1/10）</>
                  }
                  mono="nvidia-smi"
                />
                <Ck
                  ok={env.llamaServerOK}
                  okText="llama-server 就绪"
                  failText="缺少 llama-server.exe（安装包损坏）"
                  mono={env.llamaServerPath}
                />
                <Ck ok text={`已清理残留进程`} mono={`llama-server × ${env.sweep?.count ?? 0}`} />
              </>
            )}
            {env && (
              <Ck
                ok
                text="已扫描 .\models\ 目录"
                mono={`发现 ${models.filter((m) => m.quants?.some((q: any) => q.present)).length} 个本地模型`}
              />
            )}
          </div>

          {step === 3 && (
            <div className="border border-hairline rounded-[10px] p-4 flex flex-col gap-2.5 bg-bg-2">
              <div className="flex items-center gap-2.5">
                <span className="text-[13.5px] font-semibold">Index-Translate-2B.Q4_K_M.gguf</span>
                {dl?.source && (
                  <Chip tone="on" dot>
                    {dl.source === 'hf' ? 'HF' : 'ModelScope'}{dl.speedBPS > 0 ? ` · ${(dl.speedBPS / (1 << 20)).toFixed(1)} MB/s` : ''}
                  </Chip>
                )}
                <span className="flex-1" />
                <Chip>断点续传已就绪</Chip>
              </div>
              <Progress pct={dlPct} />
              <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
                <span>
                  {((dl?.bytesDone ?? 0) / (1 << 20)).toFixed(0)} / {((dl?.bytesTotal ?? 0) / (1 << 20)).toFixed(0)} MB
                </span>
                <span>{dl?.phase === 'verifying' ? 'SHA256 校验中…' : dl?.phase === 'probing' ? '双源探测中…' : ''}</span>
              </div>
              <div className="flex gap-2">
                <Btn onClick={() => apiCancelDownload('translate').catch(() => {})}>取消下载</Btn>
                <Btn kind="ghost" onClick={() => setStep(4)}>
                  跳过，稍后配置
                </Btn>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="border border-hairline rounded-[10px] p-4 flex flex-col gap-2 bg-bg-2">
              <div className="flex items-center gap-2.5 text-[13px]">
                {trial.state === 'running' && <Loader2 size={14} className="animate-spin text-accent" />}
                {trial.state === 'ok' && <span className="text-teal font-mono">✓</span>}
                {trial.state === 'err' && <span className="text-danger font-mono">✗</span>}
                <span className="text-ink-2">
                  "你好，世界。欢迎使用 Index-VT。" → {trial.output ?? (trial.err ?? '翻译中…')}
                </span>
                {trial.ttft != null && <Chip tone="on">TTFT {(trial.ttft / 1000).toFixed(2)}s</Chip>}
              </div>
            </div>
          )}
        </div>

        <div className="px-7 py-4 border-t border-hairline flex items-center gap-2.5">
          <span className="text-[11px] text-ink-3 font-mono tracking-wide">
            TIP: 手动将 .gguf 放入 models\ 可跳过下载
          </span>
          <div className="ml-auto flex gap-2.5">
            {step === 4 && (
              <Btn kind="primary" disabled={trial.state !== 'ok'} onClick={onDone}>
                开始使用
              </Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'cur' | 'todo' }) {
  return (
    <span
      className={`flex items-center gap-2 text-xs ${
        state === 'done' ? 'text-teal' : state === 'cur' ? 'text-accent' : 'text-ink-3'
      }`}
    >
      <span
        className={`w-[22px] h-[22px] rounded-full border grid place-items-center font-mono text-[10.5px] ${
          state === 'done'
            ? 'bg-teal-soft border-teal text-teal'
            : state === 'cur'
              ? 'bg-accent border-accent text-bg-0 font-bold'
              : 'border-hairline-2'
        }`}
      >
        {state === 'done' ? <Check size={11} /> : n}
      </span>
      {label}
    </span>
  )
}

function Ln() {
  return <span className="flex-1 h-px bg-hairline-2 mx-3" />
}

function Ck({ ok, text, okText, failText, mono }: { ok: boolean; text?: any; okText?: string; failText?: string; mono?: string }) {
  return (
    <div className="flex items-center gap-3 text-[13px] text-ink-2">
      <span className={ok ? 'text-teal font-mono' : 'text-accent font-mono'}>{ok ? '✓' : '●'}</span>
      <span className="flex-1">{ok ? (okText ?? text) : (failText ?? text)}</span>
      {mono && <span className="font-mono text-[11px] text-ink-3">{mono}</span>}
    </div>
  )
}
