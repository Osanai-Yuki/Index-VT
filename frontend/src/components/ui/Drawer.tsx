// Drawer —— DESIGN.md §5.9（右侧滑出）
// 宽 360（--suj-drawer-w）/ 420（--suj-drawer-w-lg，术语本）；左侧 radius-lg；--e-3；
// 入场 translateX(16px)+opacity 320ms。scrim 点击 / Esc 关闭；焦点困在抽屉内；
// 关闭后焦点回到触发元素。
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useDismissable, useFocusTrap, FOCUSABLE_SELECTOR } from '../../lib/useDismissable'
import { IconButton } from './IconButton'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  width?: 360 | 420
  children: ReactNode
}

export function Drawer({ open, onClose, title, width = 360, children }: DrawerProps) {
  const titleId = useRef(`drawer-title-${Math.random().toString(36).slice(2, 8)}`)
  const panelRef = useRef<HTMLDivElement>(null)

  useDismissable({ open, onClose, layerRef: panelRef })
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    ;(panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel).focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-(--suj-z-drawer)">
      <div className="enter-scrim absolute inset-0 bg-scrim" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
        className={`enter-drawer absolute bottom-0 right-0 top-0 ${
          width === 420 ? 'w-(--suj-drawer-w-lg)' : 'w-(--suj-drawer-w)'
        } rounded-l-lg bg-surface p-6 e-3`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id={titleId.current} className="text-title text-ink1">
            {title}
          </h2>
          <IconButton label="关闭" icon={<X size={16} />} size="sm" onClick={onClose} />
        </div>
        <div className="mt-4 text-body text-ink2">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
