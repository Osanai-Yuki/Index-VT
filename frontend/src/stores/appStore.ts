// zustand 全局状态：页面路由 / 系统状态 / 语言清单 / 配置。
import { create } from 'zustand'
import { apiGetSystemStatus, apiGetConfig, eventsOn } from '../wailsapi'

export type Page = 'translate' | 'subtitle' | 'doc' | 'model' | 'settings'

interface AppState {
  page: Page
  setPage: (p: Page) => void

  onboarded: boolean | null // null = 未加载
  setOnboarded: (v: boolean) => void

  status: any | null
  refreshStatus: () => Promise<void>

  cfg: any | null
  setCfg: (c: any) => void

  orchState: string // idle | starting | running | stopping | crashed
  notice: string | null
}

export const useAppStore = create<AppState>((set, get) => ({
  page: 'translate',
  setPage: (p) => set({ page: p }),

  onboarded: null,
  setOnboarded: (v) => set({ onboarded: v }),

  status: null,
  refreshStatus: async () => {
    try {
      const s = await apiGetSystemStatus()
      set({ status: s, orchState: s.orchestration })
      if (s.offline === false && get().cfg === null) {
        /* noop */
      }
    } catch {
      /* runtime 不可用 */
    }
  },

  cfg: null,
  setCfg: (c) => set({ cfg: c, onboarded: !!c?.onboarded }),

  orchState: 'idle',
  notice: null,
}))

// 订阅后端事件（App.tsx 挂载时调用一次）
export function wireEvents() {
  eventsOn('orch:event', (ev: any) => {
    if (ev?.kind === 'state') {
      useAppStore.setState({ orchState: ev.state ?? 'idle' })
    }
    if (ev?.kind === 'notice') {
      useAppStore.setState({ notice: ev.text })
      setTimeout(() => {
        if (useAppStore.getState().notice === ev.text) useAppStore.setState({ notice: null })
      }, 3000)
    }
  })
  // 模型进度 / 列表变化 → 触发状态刷新（页面自行监听明细事件）
  eventsOn('model:progress', () => useAppStore.getState().refreshStatus())
  eventsOn('models:updated', () => useAppStore.getState().refreshStatus())
  // 5s 轮询兜底（空闲倒计时/VRAM 需要周期刷新）
  setInterval(() => useAppStore.getState().refreshStatus(), 5000)
}

export async function loadInitialConfig() {
  try {
    const cfg = await apiGetConfig()
    useAppStore.getState().setCfg(cfg)
  } catch {
    /* 浏览器 dev */
  }
  useAppStore.getState().refreshStatus()
}
