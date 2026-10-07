// Toast 单条 + ToastHost —— DESIGN.md §5.9
// 右下堆叠最多 3 条（store 裁剪）；error 不自动消失且带关闭按钮；其余 4s 自动消失、
// hover 暂停（记录剩余时间，离开后续跑，不是重置为 4s）；
// 新条目 enter-toast 入场；旧条目由 ToastHost 用 FLIP 以 transform 让位（不动 height）。
import { useEffect, useLayoutEffect, useRef } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useToastStore } from '../../stores/toastStore'
import type { ToastItem, ToastTone } from '../../stores/toastStore'

const AUTO_DISMISS_MS = 4_000

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: <Info size={16} aria-hidden="true" />,
  ok: <CircleCheck size={16} aria-hidden="true" />,
  warn: <TriangleAlert size={16} aria-hidden="true" />,
  error: <CircleAlert size={16} aria-hidden="true" />,
}

const TONE_CLS: Record<ToastTone, string> = {
  info: 'text-ink2',
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-danger',
}

function ToastEntry({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss)
  const timerRef = useRef<number | undefined>(undefined)
  const startedAtRef = useRef(0)
  const remainingRef = useRef(AUTO_DISMISS_MS)

  const arm = () => {
    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(() => dismiss(toast.id), remainingRef.current)
  }

  useEffect(() => {
    if (toast.tone === 'error') return // error 不自动消失
    arm()
    return () => window.clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id, toast.tone])

  const pause = () => {
    if (toast.tone === 'error') return
    window.clearTimeout(timerRef.current)
    remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current))
  }
  const resume = () => {
    if (toast.tone === 'error') return
    arm()
  }

  return (
    <div
      data-toast-id={toast.id}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={resume}
      className="enter-toast pointer-events-auto flex w-80 items-start gap-2 rounded-md bg-raised p-3 e-2"
    >
      <span className={`mt-0.5 shrink-0 ${TONE_CLS[toast.tone]}`}>{TONE_ICON[toast.tone]}</span>
      <p className="min-w-0 flex-1 text-body text-ink1">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run()
            dismiss(toast.id)
          }}
          className="shrink-0 rounded-sm px-1 text-body font-medium text-accent hover:bg-sunken"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="关闭通知"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded-sm p-0.5 text-ink3 hover:bg-sunken hover:text-ink1"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts)
  const listRef = useRef<HTMLDivElement>(null)
  const prevTopsRef = useRef<Map<string, number>>(new Map())

  /* FLIP：toast 列表变化后，已有条目从旧位置用 transform 平滑上移让位（不动 height）。
     reduced-motion 时全局降级块把 transition 压到瞬时，行为安全。 */
  useLayoutEffect(() => {
    const container = listRef.current
    if (!container) return
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-toast-id]'))
    const newTops = new Map<string, number>()
    for (const el of items) {
      const id = el.dataset.toastId ?? ''
      const top = el.getBoundingClientRect().top
      newTops.set(id, top)
      const old = prevTopsRef.current.get(id)
      if (old !== undefined && Math.abs(old - top) > 0.5) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${old - top}px)`
        void el.offsetHeight // 强制 reflow，让起始位移生效
        el.style.transition = 'transform var(--suj-dur-quick) var(--suj-ease-signature)'
        el.style.transform = ''
      }
    }
    prevTopsRef.current = newTops
  }, [toasts])

  if (toasts.length === 0) return null

  return (
    <div
      ref={listRef}
      aria-live="polite"
      className="pointer-events-none fixed right-4 z-(--suj-z-toast) flex flex-col items-end gap-2"
      /* 浮在状态栏之上：bottom = 状态栏高 + 16 间距，否则压住版本与隐私徽章 */
      style={{ bottom: 'calc(var(--suj-h-status) + 16px)' }}
    >
      {toasts.map((t) => (
        <ToastEntry key={t.id} toast={t} />
      ))}
    </div>
  )
}
