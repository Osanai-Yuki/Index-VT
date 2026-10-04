// EmptyState —— DESIGN.md §5.10
// 居中；48px 线性图标（--ink-3，stroke 1.5，lucide——由调用方传入并定尺寸）；
// 标题 --text-title --ink-2；正文 --text-caption --ink-3 限宽 40ch（--suj-measure-body）；
// **一个**主操作（lg）。留白即装饰——不使用点阵网格背景（v1.0 签名细节已废弃）。
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon: ReactNode
  title: string
  body?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex size-12 items-center justify-center text-ink3">{icon}</div>
      <h3 className="text-title text-ink2">{title}</h3>
      {body && <p className="max-w-(--suj-measure-body) text-caption text-ink3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
