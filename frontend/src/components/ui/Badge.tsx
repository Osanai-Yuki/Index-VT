// Badge —— DESIGN.md §5.2
// 高 20（h-5）、padding 0 8（px-2）、radius-full、text-micro。
// 结构：可选 6px 状态点 + 必有文字标签（禁止仅用颜色传达状态）。
// 底色 = 对应 *-soft（neutral 用 --sunken），文字 = 对应语义色。
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  title?: string
  children: ReactNode
}

const TONE_CLS: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink2',
  accent: 'bg-accentSoft text-accent',
  ok: 'bg-okSoft text-ok',
  warn: 'bg-warnSoft text-warn',
  danger: 'bg-dangerSoft text-danger',
}

export function Badge({ tone = 'neutral', dot = false, title, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-micro ${TONE_CLS[tone]}`}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
