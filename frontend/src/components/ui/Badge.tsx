// Badge —— DESIGN.md §5.2 · 2026-10-06 瑞士化
// 高 20（h-5）、padding 0 8、radius-full（圆点字形保留）、text-micro。
// 结构：可选 6px 状态点 + 必有文字标签（禁止仅用颜色传达状态）。
// neutral 用 --sunken 底；accent/danger 用**实底反色字**（红系字落在红 soft 底上
// 拉不开 4.5:1，实底 + 反色是瑞士式解法且实测 AA 通过）；ok/warn 沿用 soft 底。
import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  title?: string
  className?: string
  children: ReactNode
}

const TONE_CLS: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink2',
  accent: 'bg-accent text-inkInverse',
  ok: 'bg-okSoft text-ok',
  warn: 'bg-warnSoft text-warn',
  danger: 'bg-danger text-inkInverse',
}

export function Badge({ tone = 'neutral', dot = false, title, className, children }: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-micro ${TONE_CLS[tone]} ${className ?? ''}`}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
