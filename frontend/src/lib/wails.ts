// Wails 事件层：单点订阅多路分发 + 早到事件缓冲（计划 Task 2.3）
// ------------------------------------------------------------
// 修复的现状缺陷：旧 src/wailsapi.ts 的 eventsOn 在退订时直接调
// window.runtime.EventsOff(name)——它会摘掉该事件名的**全部**订阅者。
// 实测受害场景：model:progress 同时被 Onboarding / ModelHub / appStore 订阅，
// 任一组件卸载即静默打断另两处。
//
// 结构：每个事件名只向 Wails 注册一次（wired 去重），本地 registry 按名维护
// handler 集合自行分发；退订只摘自己，集合清空才 EventsOff。
//
// 早到缓冲：EV 表内的名字在**模块加载时**就预挂 Wails 监听（ALWAYS_ON）——
// 否则「后端已开始 emit、前端组件尚未订阅」的窗口内事件在 Wails 层就丢了，
// 缓冲无从谈起。预挂名退订时不摘 Wails 监听：无订阅者期间事件进 pending，
// 下一次订阅立即冲掉（taskId 尚未返回组件时 translate:delta 可能已经来过）。
// pending 上限 256 条 / TTL 5s，防止无人消费的订阅泄漏式堆积。
import { toAppError } from './errors'
export { toAppError, isCancel } from './errors'
export type { AppError, AppErrorKind } from './errors'

export const EV = {
  DELTA: 'translate:delta',
  DONE: 'translate:done',
  ORCH: 'orch:event',
  MODEL_PROGRESS: 'model:progress',
  MODELS_UPDATED: 'models:updated',
  CUE: 'subtitle:cue',
} as const

/* ALWAYS_ON：模块加载即预挂、永不 EventsOff 的名字（后端可能随时 emit）。
   verify-wails 的断言 #3（早到缓冲）依赖这一点。 */
const ALWAYS_ON: ReadonlySet<string> = new Set<string>(Object.values(EV))

type Handler = (payload: unknown) => void

interface RuntimeLike {
  EventsOn?: (name: string, cb: (...args: unknown[]) => void) => void
  EventsOff?: (name: string) => void
  EventsEmit?: (name: string, ...data: unknown[]) => void
}
interface GoBindings {
  main?: { App?: Record<string, (...args: unknown[]) => Promise<unknown>> }
}

function runtime(): RuntimeLike | undefined {
  return (window as unknown as { runtime?: RuntimeLike }).runtime
}
function backend(): Record<string, (...args: unknown[]) => Promise<unknown>> | undefined {
  return (window as unknown as { go?: GoBindings }).go?.main?.App
}

export const wailsAvailable = (): boolean => !!backend()

export function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const b = backend()
  if (!b) {
    return Promise.reject(new Error('Wails runtime 不可用（请通过 Index-VT.exe 或 wails dev 运行）'))
  }
  return b[method](...args) as Promise<T>
}

/* ── 分发器 ───────────────────────────────────────────────── */
const registry = new Map<string, Set<Handler>>()
const wired = new Set<string>()
const pending = new Map<string, { buf: unknown[]; at: number }>()
const PENDING_TTL = 5_000
const PENDING_MAX = 256

function safe(handler: Handler, payload: unknown, name: string): void {
  try {
    handler(payload)
  } catch (err) {
    /* 单个 handler 抛错不得中断其余 handler（verify-wails 断言 #4 的回归点）。
       Track C 接入 toastStore 后可在此挂可选钩子，当前先落 console。 */
    console.error(`[wails] 事件 ${name} 的某个 handler 抛错（已隔离，其余 handler 不受影响）:`, err)
  }
}

function dispatch(name: string, payload: unknown): void {
  const set = registry.get(name)
  if (!set || set.size === 0) {
    /* 无订阅者 → 早到缓冲：超 TTL 清理、超量丢最旧 */
    const now = Date.now()
    for (const [k, v] of pending) {
      if (now - v.at > PENDING_TTL) pending.delete(k)
    }
    const held = pending.get(name) ?? { buf: [] as unknown[], at: now }
    held.buf.push(payload)
    held.at = now
    if (held.buf.length > PENDING_MAX) held.buf.splice(0, held.buf.length - PENDING_MAX)
    pending.set(name, held)
    return
  }
  for (const handler of [...set]) safe(handler, payload, name)
}

function wire(name: string): void {
  if (wired.has(name)) return
  const rt = runtime()
  if (!rt?.EventsOn) return
  wired.add(name)
  rt.EventsOn(name, (...args: unknown[]) => {
    /* Wails v2 回调签名是 (...data)；后端固定单 payload emit，
       归一化为单参，多参情形透传数组（防御性，正常路径不走这）。 */
    dispatch(name, args.length === 1 ? args[0] : args)
  })
}

/* 模块加载即预挂 EV 全表（见文件头「早到缓冲」说明） */
for (const name of ALWAYS_ON) wire(name)

export function on(name: string, handler: Handler): () => void {
  wire(name)
  let set = registry.get(name)
  if (!set) {
    set = new Set()
    registry.set(name, set)
  }
  set.add(handler)
  /* 订阅时冲掉早到缓冲：只发给新 handler（老 handler 实时期间早已收到过） */
  const held = pending.get(name)
  if (held) {
    pending.delete(name)
    for (const payload of held.buf) safe(handler, payload, name)
  }
  return () => {
    const s = registry.get(name)
    if (!s) return
    s.delete(handler)
    if (s.size === 0) {
      registry.delete(name)
      /* ALWAYS_ON 名字保留 Wails 监听（后续事件进缓冲）；动态名才真正摘除 */
      if (!ALWAYS_ON.has(name)) {
        runtime()?.EventsOff?.(name)
        wired.delete(name)
      }
    }
  }
}

/* 便捷封装：带类型化错误的调用（Track C 页面层直接 catch AppError） */
export async function callApp<T>(method: string, ...args: unknown[]): Promise<T> {
  try {
    return await call<T>(method, ...args)
  } catch (e) {
    throw toAppError(e)
  }
}
