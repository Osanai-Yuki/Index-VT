// useDismissable —— 浮层统一的「点外部关闭 + Esc 关闭最上层 + 焦点归还触发元素」
// ------------------------------------------------------------
// 供 Popover / LangPicker / Modal / Drawer / Tooltip 共用（计划 Task 2.7 Step 1）。
// **Esc 必须只关最上层**：模块级栈，全局 keydown 只对栈顶调用 onClose——
// 嵌套浮层（Popover 里再开 Modal 等）一次 Esc 只剥一层，绝不穿透。
// 焦点归还：open 置真瞬间记录 document.activeElement，关闭（effect 清理）时归还；
// 记录元素已脱离文档则退回 triggerRef。
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type EscEntry = { onClose: () => void }

/** 焦点陷入（focus trap）用：层内可聚焦元素选择器（Modal/Drawer 共享） */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([type="hidden"]):not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/* 模块级栈：只有一份；栈顶即当前最上层浮层 */
const escStack: EscEntry[] = []
let escListening = false

function ensureEscapeListener() {
  if (escListening || typeof window === 'undefined') return
  escListening = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return
      const top = escStack[escStack.length - 1]
      if (!top) return
      e.preventDefault()
      top.onClose()
    },
    true,
  )
}

export interface DismissableOptions {
  open: boolean
  onClose: () => void
  /** 浮层根元素：内部 pointerdown 不触发外点关闭 */
  layerRef?: RefObject<HTMLElement | null>
  /** 触发元素：内部 pointerdown 不算"外部"；焦点归还的兜底目标 */
  triggerRef?: RefObject<HTMLElement | null>
  /** 点外部关闭（hover 型 Tooltip 关掉） */
  dismissOnOutsideClick?: boolean
  /** 参与 Esc 栈（默认参与） */
  dismissOnEscape?: boolean
  /** 关闭后归还焦点（默认归还；hover 型 Tooltip 不需要） */
  restoreFocus?: boolean
}

export function useDismissable({
  open,
  onClose,
  layerRef,
  triggerRef,
  dismissOnOutsideClick = true,
  dismissOnEscape = true,
  restoreFocus = true,
}: DismissableOptions): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const prevActiveRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    prevActiveRef.current = document.activeElement as HTMLElement | null
    const entry: EscEntry = { onClose: () => onCloseRef.current() }
    if (dismissOnEscape) {
      ensureEscapeListener()
      escStack.push(entry)
    }

    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (layerRef?.current?.contains(target)) return
      if (triggerRef?.current?.contains(target)) return
      onCloseRef.current()
    }
    if (dismissOnOutsideClick) {
      window.addEventListener('pointerdown', onPointer, true)
    }

    return () => {
      if (dismissOnEscape) {
        const i = escStack.indexOf(entry)
        if (i >= 0) escStack.splice(i, 1)
      }
      if (dismissOnOutsideClick) {
        window.removeEventListener('pointerdown', onPointer, true)
      }
      if (restoreFocus) {
        const el = prevActiveRef.current
        if (el && document.contains(el)) el.focus()
        else triggerRef?.current?.focus()
      }
    }
  }, [open, dismissOnEscape, dismissOnOutsideClick, restoreFocus, layerRef, triggerRef])
}

/** 焦点陷入（计划 Task 2.8 Step 1）：active 期间 Tab/Shift+Tab 在容器内循环。
    捕获阶段监听，先于页内其余 keydown 处理；隐藏元素（无客户区矩形）跳过。 */
export function useFocusTrap(layerRef: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const el = layerRef.current
    if (!el) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const nodes = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (n) => n.getClientRects().length > 0,
      )
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const activeEl = document.activeElement
      if (!e.shiftKey && (activeEl === last || !el.contains(activeEl))) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (activeEl === first || !el.contains(activeEl))) {
        e.preventDefault()
        last.focus()
      }
    }
    el.addEventListener('keydown', onKey, true)
    return () => el.removeEventListener('keydown', onKey, true)
  }, [layerRef, active])
}
