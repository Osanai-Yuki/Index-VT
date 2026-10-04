// Tooltip —— DESIGN.md §5.9
// --ink-1 底 + --ink-inverse 字 + radius-xs + text-micro；延迟 400ms 出现、120ms 淡出；
// 键盘聚焦同样触发（不能只 hover）；role="tooltip" + aria-describedby。
// 定位：触发元素下方居中，底部空间不足翻转到上方。Esc 参与全局栈（只关最上层）。
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useId } from 'react'
import { useDismissable } from '../../lib/useDismissable'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
}

const SHOW_DELAY_MS = 400
const FADE_MS = 120

/* 子元素上我们注入/合并的 props（其余 props 原样保留） */
interface TooltipChildProps {
  onMouseEnter?: (e: React.MouseEvent) => void
  onMouseLeave?: (e: React.MouseEvent) => void
  onFocus?: (e: React.FocusEvent) => void
  onBlur?: (e: React.FocusEvent) => void
  'aria-describedby'?: string
  [key: string]: unknown
}

export function Tooltip({ content, children }: TooltipProps) {
  const id = useId()
  const [mounted, setMounted] = useState(false)
  const [shown, setShown] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const fadeRef = useRef<number | undefined>(undefined)
  const triggerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const show = useCallback(() => {
    window.clearTimeout(fadeRef.current)
    if (timerRef.current !== undefined) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      setMounted(true)
      setShown(true)
    }, SHOW_DELAY_MS)
  }, [])

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    setShown(false)
  }, [])

  useDismissable({
    open: mounted,
    onClose: hide,
    layerRef: panelRef,
    dismissOnOutsideClick: false,
    restoreFocus: false,
  })

  /* 淡出后再卸载（120ms） */
  useEffect(() => {
    if (mounted && !shown) {
      fadeRef.current = window.setTimeout(() => setMounted(false), FADE_MS)
    }
    return () => window.clearTimeout(fadeRef.current)
  }, [mounted, shown])

  /* 挂载后测量定位（触发元素下方居中，越界翻转） */
  useEffect(() => {
    if (!mounted) return
    const t = triggerRef.current
    const panel = panelRef.current
    if (!t || !panel) return
    const r = t.getBoundingClientRect()
    const ph = panel.offsetHeight
    const pw = panel.offsetWidth
    const left = Math.min(Math.max(4, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 4)
    const above = r.bottom + ph + 6 > window.innerHeight && r.top > ph + 6
    const top = above ? r.top - ph - 6 : r.bottom + 6
    setPos({ left, top })
  }, [mounted])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  if (!isValidElement(children)) return children

  const child = children as ReactElement<TooltipChildProps>
  const describedBy = shown ? id : undefined

  const trigger = cloneElement(child, {
    ref: triggerRef,
    onMouseEnter: (e: React.MouseEvent) => {
      child.props.onMouseEnter?.(e)
      show()
    },
    onMouseLeave: (e: React.MouseEvent) => {
      child.props.onMouseLeave?.(e)
      hide()
    },
    onFocus: (e: React.FocusEvent) => {
      child.props.onFocus?.(e)
      show()
    },
    onBlur: (e: React.FocusEvent) => {
      child.props.onBlur?.(e)
      hide()
    },
    'aria-describedby': describedBy ?? child.props['aria-describedby'],
  })

  return (
    <>
      {trigger}
      {mounted && (
        <div
          ref={panelRef}
          id={id}
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            opacity: shown ? 1 : 0,
            transition: `opacity ${FADE_MS}ms var(--suj-ease-signature)`,
            zIndex: 'var(--suj-z-popover)',
          }}
          className="rounded-xs bg-ink1 px-2 py-1 text-micro text-inkInverse"
        >
          {content}
        </div>
      )}
    </>
  )
}
