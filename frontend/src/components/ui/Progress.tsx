// Progress —— motion-plan 的 GPU 友好要求：填充用 transform: scaleX()（不动 width，
// 不触发 layout）。role="progressbar" + aria-valuenow/min/max；label 必填（可访问名）。
export interface ProgressProps {
  pct: number
  tone?: 'accent' | 'ok' | 'warn'
  label: string
  indeterminate?: boolean
}

const TONE_BG: Record<NonNullable<ProgressProps['tone']>, string> = {
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
}

export function Progress({ pct, tone = 'accent', label, indeterminate = false }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-valuetext={indeterminate ? '总大小未知，正在下载' : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full overflow-hidden bg-sunken"
    >
      <div
        className={`h-full transition-transform duration-(--suj-dur-standard) ease-(--suj-ease-signature) ${TONE_BG[tone]}`}
        style={{ transform: `scaleX(${indeterminate ? 0.35 : clamped / 100})`, transformOrigin: 'left' }}
      />
    </div>
  )
}
