// toastStore —— 计划 Task 2.8：右下角通知的单一数据源。
// 列表上限 3，超出替换最旧；push 返回 id 供 action/dismiss 使用。
// error 类不自动消失（由 Toast 组件的定时器逻辑决定，store 不管计时）。
import { create } from 'zustand'

export type ToastTone = 'info' | 'ok' | 'warn' | 'error'

export interface ToastAction {
  label: string
  run: () => void
}

export interface ToastItem {
  id: string
  tone: ToastTone
  message: string
  action?: ToastAction
}

interface ToastState {
  toasts: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => string
  dismiss: (id: string) => void
}

const MAX_TOASTS = 3

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    seq += 1
    const id = `toast-${seq.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    set((s) => {
      const next = [...s.toasts, { ...t, id }]
      // 超出上限：替换最旧（保序）
      return { toasts: next.slice(-MAX_TOASTS) }
    })
    return id
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

/** 命令式入口：非组件代码（事件层、探针）也能弹通知 */
export const toast = {
  push: (t: Omit<ToastItem, 'id'>): string => useToastStore.getState().push(t),
  dismiss: (id: string): void => useToastStore.getState().dismiss(id),
}
