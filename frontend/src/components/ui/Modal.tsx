// Modal —— DESIGN.md §5.9
// role="dialog" aria-modal="true" aria-labelledby；scrim 点击关闭（dismissible=false 关掉，
// 供破坏性确认强制走按钮）；入场 translateY(8px)+opacity 320ms（不用 scale）。
// max-w 480（--suj-modal-max）、radius-lg、--e-3、padding 24。
// 焦点：打开时移到 initialFocus（'cancel' → [data-modal-initial="cancel"]，
// 依次回退 confirm → 第一个可聚焦元素）——破坏性确认默认落在取消上防回车误删（PRD S4）；
// Tab 被困在面板内（useFocusTrap）；关闭后焦点回到触发元素（useDismissable）。
// footer 里的按钮请用 data-modal-initial="cancel" / "confirm" 标记。
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useDismissable, useFocusTrap, FOCUSABLE_SELECTOR } from '../../lib/useDismissable'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  initialFocus?: 'cancel' | 'confirm' | 'first'
  /** false → scrim 点击与 Esc 不关闭（强制走 footer 按钮）；默认 true */
  dismissible?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  initialFocus = 'cancel',
  dismissible = true,
}: ModalProps) {
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 8)}`)
  const panelRef = useRef<HTMLDivElement>(null)

  useDismissable({ open, onClose, layerRef: panelRef, dismissOnOutsideClick: dismissible })
  useFocusTrap(panelRef, open)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    let target: HTMLElement | null = null
    if (initialFocus !== 'first') {
      target = panel.querySelector<HTMLElement>(`[data-modal-initial="${initialFocus}"]`)
    }
    target ??= panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(target ?? panel).focus()
  }, [open, initialFocus])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-(--suj-z-modal)">
      {/* scrim：pointerdown 在面板外 → useDismissable 关闭（dismissible=true 时） */}
      <div className="enter-scrim absolute inset-0 bg-scrim" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId.current}
          tabIndex={-1}
          className="enter-modal pointer-events-auto w-full max-w-(--suj-modal-max) rounded-lg bg-surface p-6 e-3"
        >
          <h2 id={titleId.current} className="text-title text-ink1">
            {title}
          </h2>
          <div className="mt-4 text-body text-ink2">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** 便捷：受控 open 的 useState 对（Track C 页面少写样板） */
export function useModalState(initial = false) {
  return useState(initial)
}
