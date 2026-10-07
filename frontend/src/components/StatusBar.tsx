// 底部状态栏（40px，等宽 11px；四组信息：模型 chip / VRAM / 空闲倒计时 / 隐私徽章）。
// 单行不换行：整条 whitespace-nowrap，挤压只由 VRAM 进度条与「全本地推理」吸收。
// 左内缩 = rail + pad-shell-x，首项与页面内容左缘对齐（DESIGN.md §5.13）。
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

/** 三枚 chip / 读数共用的胶囊样式；h-6 固定高度，避免文案长短改变行高 */
const CHIP = 'inline-flex items-center gap-1.5 px-2.5 h-6 shrink-0 rounded-full border'

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
    <footer
      className="h-full bg-surface border-t border-line flex items-center gap-4 text-micro text-ink2 tracking-wide whitespace-nowrap overflow-hidden"
      style={{
        paddingLeft: 'calc(var(--suj-h-rail) + var(--suj-pad-shell-x))',
        paddingRight: 'var(--suj-pad-shell-x)',
      }}
    >
      <span
        className={`${CHIP} ${
          running
            ? 'text-ok border-ok/40 bg-okSoft'
            : orchState === 'crashed'
              ? 'text-danger border-danger/40 bg-dangerSoft'
              : 'border-lineStrong bg-sunken'
        }`}
      >
        <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${running ? 'bg-ok' : orchState === 'crashed' ? 'bg-danger' : 'bg-ink3'}`} />
        {MODEL_NAMES[modelId] ?? modelId} · {stateText}
        {running && status?.port ? ` :${status.port}` : ''}
      </span>
      {gpuTotal > 0 ? (
        <span className="flex items-center gap-2 min-w-0 shrink">
          <span className="shrink-0">VRAM</span>
          <span
            className="w-24 min-w-4 shrink h-1 bg-sunken overflow-hidden inline-block"
            title={`显存占用 ${vramPct}%`}
          >
            <i className="block h-full bg-ok" style={{ width: `${vramPct}%` }} />
          </span>
          <span className="num shrink-0">
            {(gpuUsed / 1024).toFixed(1)} / {(gpuTotal / 1024).toFixed(1)} GB
          </span>
        </span>
      ) : (
        <span className="shrink-0">CPU 推理模式</span>
      )}
      {running && idleMin > 0 ? (
        <button
          type="button"
          className="shrink-0 text-accent cursor-pointer bg-transparent border-0 p-0 text-micro tracking-wide"
          title="点击保持加载（重置空闲计时）"
          onClick={() => apiKeepAlive().catch(() => {})}
        >
          空闲 <span className="num">{mm}:{String(ss).padStart(2, '0')}</span> 后自动释放
        </button>
      ) : running ? (
        <span className="shrink-0 text-accent">常驻加载</span>
      ) : (
        <span className="shrink-0 text-ink3">模型未加载（任务自动唤醒）</span>
      )}
      <span className="flex-1 min-w-0" />
      <span className={`${CHIP} border-lineStrong bg-sunken text-ok`}>
        <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-ok" />
        离线可用
      </span>
      <span className="min-w-0 shrink truncate">全本地推理 · 零遥测</span>
      <span className="num shrink-0">{status?.version ?? 'v1.0.0'}</span>
    </footer>
  )
}
