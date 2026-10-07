// zustand 全局状态：页面路由 / 系统状态 / 语言清单 / 配置。
// 2026-10-06 Track C 接线：事件订阅走新事件层 lib/wails（单点订阅多路分发 +
// 早到缓冲），替代旧 wailsapi.eventsOn 的"退订即 EventsOff 全局摘除"缺陷路径。
import { create } from 'zustand'
import { apiGetSystemStatus, apiGetConfig } from '../wailsapi'
import { on, EV } from '../lib/wails'

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
  on(EV.ORCH, (ev) => {
    const e = ev as { kind?: string; state?: string; text?: string }
    if (e?.kind === 'state') {
      useAppStore.setState({ orchState: e.state ?? 'idle' })
    }
    if (e?.kind === 'notice') {
      useAppStore.setState({ notice: e.text ?? null })
      const text = e.text
      setTimeout(() => {
        if (useAppStore.getState().notice === text) useAppStore.setState({ notice: null })
      }, 3000)
    }
  })
  // 模型进度 / 列表变化 → 触发状态刷新（页面自行监听明细事件）
  on(EV.MODEL_PROGRESS, () => useAppStore.getState().refreshStatus())
  on(EV.MODELS_UPDATED, () => useAppStore.getState().refreshStatus())
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
