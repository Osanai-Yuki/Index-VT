// Popover —— DESIGN.md §5.9 浮层家族
// --raised 底 + --e-2（瑞士下为 1px 描边环） + radius-md；入场 .enter-pop = opacity 150ms（v2.1 已去掉 translateY）；
// 定位：锚元素下方，空间不足翻转到上方；portal 到 body（躲开页面入场动画的
// transform 祖先，fixed 才相对视口）。z 序 --suj-z-popover(10)。
// 无浮动定位库（运行时依赖不变）：打开时按锚 rect + 面板实测高计算一次，
// open 期间的 scroll/resize 触发重算。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable } from '../../lib/useDismissable'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement>
  width?: number
  children: ReactNode
  labelledBy?: string
  /** 内容变化后需要重新测量定位（如列表过滤）时递增 */
  measureKey?: number
}

interface Pos {
  left: number
  top: number
}

const MARGIN = 8

export function Popover({ open, onClose, anchorRef, width = 280, children, labelledBy, measureKey = 0 }: PopoverProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)

  useDismissable({ open, onClose, layerRef, triggerRef: anchorRef })

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    const panel = layerRef.current
    if (!anchor || !panel) return
    const r = anchor.getBoundingClientRect()
    const ph = panel.offsetHeight
    const spaceBelow = window.innerHeight - r.bottom
    const above = spaceBelow < ph + MARGIN && r.top > ph + MARGIN
    const left = Math.min(Math.max(MARGIN, r.left), Math.max(MARGIN, window.innerWidth - width - MARGIN))
    const top = above ? Math.max(MARGIN, r.top - ph - MARGIN) : Math.min(r.bottom + MARGIN, window.innerHeight - MARGIN)
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [anchorRef, width])

  /* 挂载后按实测高度定位（先渲染在视口外，测完再就位，避免闪跳） */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    measure()
  }, [open, measure, measureKey])

  useEffect(() => {
    if (!open) return
    const onReposition = () => measure()
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open, measure])

  if (!open) return null

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.left ?? -9999,
    top: pos?.top ?? -9999,
    width,
    zIndex: 'var(--suj-z-popover)',
  }

  return createPortal(
    <div
      ref={layerRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      style={style}
      className="enter-pop rounded-md bg-raised p-2 e-2"
    >
      {children}
    </div>,
    document.body,
  )
}
