// 底部状态栏（40px，等宽 11px；四组信息：模型 chip / VRAM / 空闲倒计时 / 隐私徽章）。
import { useAppStore } from '../stores/appStore'
import { apiKeepAlive } from '../wailsapi'

const MODEL_NAMES: Record<string, string> = {
  translate: 'Index-Translate-2B',
  nailong: 'Index-Nailong-2B',
  homura: 'Index-Homura-2B',
}

const STATE_TEXT: Record<string, string> = {
  idle: '休眠 · 空闲释放',
  starting: '唤醒中',
  running: '运行中',
  stopping: '释放中',
  crashed: '崩溃',
}

export function StatusBar() {
  const status = useAppStore((s) => s.status)
  const orchState = useAppStore((s) => s.orchState)
  const modelId: string = status?.activeModel ?? 'translate'
  const gpuTotal = status?.gpu?.totalMB ?? 0
  const gpuUsed = status?.gpu?.usedMB ?? 0
  const vramPct = gpuTotal > 0 ? Math.round((gpuUsed / gpuTotal) * 100) : 0
  const idleMin = status?.idleMinutes ?? 5
  const idleSec = status?.idleSeconds ?? 0
  const remainSec = Math.max(0, idleMin * 60 - idleSec)
  const mm = Math.floor(remainSec / 60)
  const ss = remainSec % 60
  const stateText = STATE_TEXT[orchState] ?? orchState
  const running = orchState === 'running'

  return (
    <footer className="h-10 bg-bg-1 border-t border-hairline flex items-center gap-4 px-4 font-mono text-[11px] text-ink-2 tracking-wide">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full border ${
          running
            ? 'text-teal border-[rgba(79,214,190,.35)] bg-teal-soft'
            : orchState === 'crashed'
              ? 'text-danger border-[rgba(229,72,77,.35)] bg-danger-soft'
              : 'border-hairline-2 bg-bg-2'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-teal' : orchState === 'crashed' ? 'bg-danger' : 'bg-ink-3'}`} />
        {MODEL_NAMES[modelId] ?? modelId} · {stateText}
        {running && status?.port ? ` :${status.port}` : ''}
      </span>
      <span className="w-px h-4 bg-hairline-2" />
      {gpuTotal > 0 ? (
        <span className="flex items-center gap-2">
          <span>VRAM</span>
          <span className="w-[90px] h-[5px] rounded-full bg-bg-3 overflow-hidden inline-block">
            <i className="block h-full bg-teal" style={{ width: `${vramPct}%` }} />
          </span>
          <span>
            {(gpuUsed / 1024).toFixed(1)} / {(gpuTotal / 1024).toFixed(1)} GB
          </span>
        </span>
      ) : (
        <span>CPU 推理模式</span>
      )}
      <span className="w-px h-4 bg-hairline-2" />
      {running && idleMin > 0 ? (
        <span
          className="text-accent cursor-pointer"
          title="点击保持加载（重置空闲计时）"
          onClick={() => apiKeepAlive().catch(() => {})}
        >
          空闲 {mm}:{String(ss).padStart(2, '0')} 后自动释放
        </span>
      ) : running ? (
        <span className="text-accent">常驻加载</span>
      ) : (
        <span className="text-ink-3">模型未加载（任务自动唤醒）</span>
      )}
      <span className="flex-1" />
      <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full border border-hairline-2 bg-bg-2 text-teal">
        <span className="w-1.5 h-1.5 rounded-full bg-teal" />
        离线可用
      </span>
      <span className="w-px h-4 bg-hairline-2" />
      <span>全本地推理 · 零遥测</span>
      <span className="w-px h-4 bg-hairline-2" />
      <span>{status?.version ?? 'v1.0.0'}</span>
    </footer>
  )
}
