// UI 原语组件 —— 与 mockups.html 一致（Chip / Switch / Seg / Progress / 按钮）。
import { ReactNode } from 'react'

export function Chip({
  tone = 'default',
  dot = false,
  children,
  title,
}: {
  tone?: 'default' | 'on' | 'amber' | 'warn' | 'blue' | 'danger'
  dot?: boolean
  children: ReactNode
  title?: string
}) {
  const tones: Record<string, string> = {
    default: '',
    on: 'text-teal border-[rgba(79,214,190,.35)] bg-teal-soft',
    amber: 'text-accent border-accent-line bg-accent-soft',
    warn: 'text-warn border-[rgba(242,184,75,.35)] bg-warn-soft',
    blue: 'text-info border-[rgba(108,160,255,.35)] bg-info-soft',
    danger: 'text-danger border-[rgba(229,72,77,.35)] bg-danger-soft',
  }
  const dotColor: Record<string, string> = {
    default: 'bg-ink-3',
    on: 'bg-teal',
    amber: 'bg-accent',
    warn: 'bg-warn',
    blue: 'bg-info',
    danger: 'bg-danger',
  }
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] px-2.5 py-[3px] rounded-full border border-hairline-2 bg-bg-2 whitespace-nowrap ${tones[tone]}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[tone]}`} />}
      {children}
    </span>
  )
}

export function Switch({ on, onChange, title }: { on: boolean; onChange?: (v: boolean) => void; title?: string }) {
  return (
    <div
      title={title}
      onClick={() => onChange?.(!on)}
      className={`w-9 h-5 rounded-full relative cursor-pointer transition-colors flex-none ${
        on ? 'bg-accent' : 'bg-bg-4'
      }`}
    >
      <div
        className={`absolute top-[3px] w-3.5 h-3.5 rounded-full transition-all ${
          on ? 'left-[19px] bg-bg-0' : 'left-[3px] bg-ink-2'
        }`}
      />
    </div>
  )
}

export function Seg({
  options,
  value,
  onChange,
  accentSel = false,
}: {
  options: string[]
  value: string
  onChange?: (v: string) => void
  accentSel?: boolean
}) {
  return (
    <div className="inline-flex bg-bg-2 border border-hairline rounded-lg p-0.5 gap-0.5">
      {options.map((o) => (
        <span
          key={o}
          onClick={() => onChange?.(o)}
          className={`text-xs px-3 py-[5px] rounded-md cursor-pointer transition-all whitespace-nowrap ${
            value === o
              ? accentSel
                ? 'bg-accent-soft text-accent'
                : 'bg-bg-4 text-ink-1 shadow-[0_1px_0_rgba(255,255,255,.06)_inset]'
              : 'text-ink-2 hover:text-ink-1'
          }`}
        >
          {o}
        </span>
      ))}
    </div>
  )
}

export function Progress({ pct, teal = false }: { pct: number; teal?: boolean }) {
  return (
    <div className="h-1.5 rounded-full bg-bg-3 overflow-hidden">
      <i
        className={`block h-full rounded-full transition-[width] duration-300 ${
          teal ? 'bg-[linear-gradient(90deg,#35BFA6,var(--teal))]' : 'bg-[linear-gradient(90deg,var(--accent),#F2C258)]'
        }`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  )
}

export function Btn({
  children,
  onClick,
  kind = 'secondary',
  disabled,
  title,
}: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  title?: string
}) {
  const kinds: Record<string, string> = {
    primary: 'bg-accent border-accent text-bg-0 font-semibold hover:brightness-110',
    secondary: 'bg-bg-3 border-hairline-2 text-ink-1 hover:border-accent-line hover:text-accent',
    ghost: 'bg-transparent border-transparent text-ink-2 hover:text-ink-1 hover:bg-bg-2',
    danger: 'text-danger border-[rgba(229,72,77,.3)] hover:bg-danger-soft hover:border-danger',
  }
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-lg border cursor-pointer transition-all whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${kinds[kind]}`}
    >
      {children}
    </button>
  )
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return (
    <input
      {...rest}
      className={`bg-bg-3 border border-hairline rounded-lg text-ink-1 px-3 py-2 text-[13px] font-cjk outline-none transition-colors focus:border-accent-line ${className}`}
    />
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-bg-1 border border-hairline rounded-[14px] shadow-[var(--shadow-1)] ${className}`}>
      {children}
    </div>
  )
}
