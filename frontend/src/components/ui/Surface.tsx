// Surface —— DESIGN.md §5.8 面板
// --surface 底 + radius-md + **无边框无阴影**（层级靠 surface 浮在 canvas + 间距表达）；
// padding：操作态（dense）16 / 阅读态 24。标题行由调用方组合（§5.8 的标签 + 操作区）。
import type { ReactNode } from 'react'

export interface SurfaceProps {
  children: ReactNode
  /** dense → padding 16（操作态），否则 24（阅读态） */
  dense?: boolean
  className?: string
}

export function Surface({ children, dense = false, className }: SurfaceProps) {
  return (
    <div className={`rounded-md bg-surface ${dense ? 'p-4' : 'p-6'} ${className ?? ''}`}>{children}</div>
  )
}
