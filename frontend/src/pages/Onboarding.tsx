// 首次引导（01 文档 §6.4）· Track C 迁移版（2026-10-06）
// ① 环境检测（GPU/llama-server/残留清扫）→ ② 本地扫描 → ③ 模型下载 → ④ 就绪试译。
// 新设计系统组合 + 瑞士 token + 新事件层（lib/wails）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle, Loader2, X } from 'lucide-react'
import { Badge, Button } from '../components/ui/index'
import { on, EV } from '../lib/wails'
import {
  apiProbeEnv,
  apiListModels,
  apiDownloadModel,
  apiCancelDownload,
  apiTranslate,
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

  // 下载进度事件（新事件层：退订不再摘除他人订阅）
  useEffect(() => {
    const off = on(EV.MODEL_PROGRESS, (p) => {
      const progress = p as { phase?: string }
      setDl(progress)
      if (progress?.phase === 'done') {
        refreshModels()
      }
    })
    const off2 = on(EV.MODELS_UPDATED, refreshModels)
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

  const hasTranslate = models.find((m) => m.id === 'translate')?.quants?.some((q: any) => q.present)

  // 第 4 步自动试译
  useEffect(() => {
    if (step !== 4 || trial.state !== 'idle') return
    if (!hasTranslate) return
    setTrial({ state: 'running' })
    apiTranslate({ sourceLang: 'zh', targetLang: 'en', text: '你好，世界。欢迎使用 Index-VT。' })
      .then((h) => {
        const off = on(EV.DONE, (d) => {
          const done = d as { taskId?: string; error?: string; output?: string; firstTokenMs?: number }
          if (done.taskId !== h.taskId) return
          if (done.error) setTrial({ state: 'err', err: done.error })
          else setTrial({ state: 'ok', output: done.output, ttft: done.firstTokenMs })
        })
        // 超时不仅退订，还必须把 running 收口成 err：否则试译永远停在"翻译中…"，
        // 而开始按钮又要求 ok —— 用户会被锁死在引导页（B33）。
        window.setTimeout(() => {
          off()
          setTrial((prev) => (prev.state === 'running' ? { state: 'err', err: '试译超时（60s 无响应），可重试或先进入主界面' } : prev))
        }, 60000)
      })
      .catch((e) => setTrial({ state: 'err', err: String(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, models, trial.state])

  const dlPct = dl?.bytesTotal > 0 ? Math.round((dl.bytesDone / dl.bytesTotal) * 100) : 0

  return (
    <div role="main" className="h-full grid place-items-center overflow-auto">
      <h1 className="sr-only">Index-VT 首次设置</h1>
      <div className="w-160 bg-surface border border-line shadow-(--suj-e-3) overflow-hidden">
        {/* 步骤条 */}
        <div className="flex items-center px-7 pt-5 pb-4 border-b border-line">
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
            <div className="text-display font-bold">
              {step === 1 && '正在检测运行环境'}
              {step === 2 && '扫描本地模型'}
              {step === 3 && '下载核心翻译模型'}
              {step === 4 && '就绪试译'}
            </div>
            <div className="text-caption text-ink3 mt-1">
              {step === 3 && (
                <>
                  模型将保存到项目文件夹 <span className="num text-ink2">.\models\</span>，
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
                <Ck ok text="已清理残留进程" mono={`llama-server × ${env.sweep?.count ?? 0}`} />
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
            <div className="border border-line p-4 flex flex-col gap-2.5 bg-sunken">
              <div className="flex items-center gap-2.5">
                <span className="text-body font-semibold">Index-Translate-2B.Q4_K_M.gguf</span>
                {dl?.source && (
                  <Badge tone="ok" dot>
                    {dl.source === 'hf' ? 'HF' : 'ModelScope'}
                    {dl.speedBPS > 0 ? ` · ${(dl.speedBPS / (1 << 20)).toFixed(1)} MB/s` : ''}
                  </Badge>
                )}
                <span className="flex-1" />
                <Badge>断点续传已就绪</Badge>
              </div>
              <div className="h-1 bg-line overflow-hidden">
                <div className="h-full bg-accent transition-transform duration-150 ease-out" style={{ width: `${dlPct}%`, transformOrigin: 'left' }} />
              </div>
              <div className="flex justify-between num text-micro text-ink3">
                <span>
                  {((dl?.bytesDone ?? 0) / (1 << 20)).toFixed(0)} / {((dl?.bytesTotal ?? 0) / (1 << 20)).toFixed(0)} MB
                </span>
                <span className={dl?.phase === 'failed' ? 'text-danger' : ''}>
                  {dl?.phase === 'verifying' ? 'SHA256 校验中…'
                    : dl?.phase === 'probing' ? '双源探测中…'
                    : (dl?.phase === 'failed' || dl?.phase === 'canceled') ? (dl?.message ?? dl?.phase) : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => apiCancelDownload('translate').catch(() => {})}>取消下载</Button>
                <Button kind="ghost" onClick={() => setStep(4)}>
                  跳过，稍后配置
                </Button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="border border-line p-4 flex flex-col gap-2 bg-sunken">
              {!hasTranslate ? (
                <div className="text-body text-ink2">
                  未检测到可用的本地模型。可稍后在「模型中心」下载，或把官方命名的 .gguf 放入
                  <span className="num text-ink2"> models\ </span>后重启应用。
                </div>
              ) : (
                <div className="flex items-center gap-2.5 text-body">
                  {trial.state === 'running' && <Loader2 size={14} className="animate-spin text-accent" />}
                  {trial.state === 'ok' && <Check size={14} strokeWidth={2.5} className="text-ok" aria-label="通过" />}
                  {trial.state === 'err' && <X size={14} strokeWidth={2.5} className="text-danger" aria-label="失败" />}
                  <span className="text-ink2">
                    "你好，世界。欢迎使用 Index-VT。" → {trial.output ?? (trial.err ?? '翻译中…')}
                  </span>
                  {trial.ttft != null && <Badge tone="ok">TTFT {(trial.ttft / 1000).toFixed(2)}s</Badge>}
                </div>
              )}
              {hasTranslate && trial.state === 'err' && (
                <div className="flex gap-2">
                  <Button onClick={() => setTrial({ state: 'idle' })}>重试</Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-7 py-4 border-t border-line flex items-center gap-2.5">
          <span className="text-micro text-ink3 tracking-wide">
            TIP: 手动将 .gguf 放入 models\ 可跳过下载
          </span>
          <div className="ml-auto flex gap-2.5">
            {step === 4 && (
              <>
                {/* 兜底出口：试译失败/未运行时主按钮禁用，没有它引导页就是死胡同（B33） */}
                {trial.state !== 'ok' && (
                  <Button kind="ghost" onClick={onDone}>
                    跳过，先进入主界面
                  </Button>
                )}
                <Button kind="primary" disabled={trial.state !== 'ok'} onClick={onDone}>
                  开始使用
                </Button>
              </>
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
      className={`flex items-center gap-2 text-caption ${
        state === 'done' ? 'text-ok' : state === 'cur' ? 'text-accent' : 'text-ink3'
      }`}
    >
      <span
        className={`w-5 h-5 rounded-full border grid place-items-center num text-micro ${
          state === 'done'
            ? 'bg-okSoft border-ok text-ok'
            : state === 'cur'
              ? 'bg-accent border-accent text-canvas font-bold'
              : 'border-lineStrong'
        }`}
      >
        {state === 'done' ? <Check size={11} /> : n}
      </span>
      {label}
    </span>
  )
}

function Ln() {
  return <span className="flex-1 h-px bg-lineStrong mx-3" />
}

function Ck({ ok, text, okText, failText, mono }: { ok: boolean; text?: any; okText?: string; failText?: string; mono?: string }) {
  return (
    <div className="flex items-center gap-3 text-body text-ink2">
      {ok ? (
        <Check size={13} strokeWidth={2.5} className="text-ok" aria-hidden="true" />
      ) : (
        <Circle size={11} strokeWidth={2.5} className="text-accent" aria-hidden="true" />
      )}
      <span className="flex-1">{ok ? (okText ?? text) : (failText ?? text)}</span>
      {mono && <span className="num text-micro text-ink3">{mono}</span>}
    </div>
  )
}
