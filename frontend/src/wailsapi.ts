// Wails bindings 薄封装：window.go / window.runtime 注入（Wails v2 运行时）。
// 纯浏览器 dev 模式下调用会 reject —— UI 需容忍。

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    go?: any
    runtime?: any
  }
}

function backend(): any {
  return (window as any).go?.main?.App
}

export const wailsAvailable = () => !!backend()

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const b = backend()
  if (!b) return Promise.reject(new Error('Wails runtime 不可用（请通过 Index-VT.exe 或 wails dev 运行）'))
  return b[method](...args) as Promise<T>
}

// ---------- Events ----------

export function eventsOn(name: string, cb: (...data: any) => void): () => void {
  const rt = (window as any).runtime
  if (!rt?.EventsOn) return () => {}
  rt.EventsOn(name, cb)
  return () => rt.EventsOff(name)
}

// ---------- 翻译 ----------
export interface TaskHandle { taskId: string }
export const apiTranslate = (req: Record<string, unknown>) => call<TaskHandle>('Translate', req)
export const apiCancelTask = (taskId: string) => call<void>('CancelTask', taskId)

// ---------- 历史 ----------
export const apiListHistory = (page: number) => call<any[]>('ListHistory', page)
export const apiSearchHistory = (q: string) => call<any[]>('SearchHistory', q)
export const apiDeleteHistory = (id: number) => call<void>('DeleteHistory', id)
export const apiStarHistory = (id: number, starred: boolean) => call<void>('StarHistory', id, starred)
export const apiClearHistory = () => call<void>('ClearHistory')

// ---------- 术语 ----------
export const apiListGlossaries = () => call<any[]>('ListGlossaries')
export const apiSaveGlossary = (g: unknown) => call<number>('SaveGlossary', g)
export const apiDeleteGlossary = (id: number) => call<void>('DeleteGlossary', id)

// ---------- 模型 ----------
export const apiListModels = () => call<any[]>('ListModels')
export const apiListUnknownModels = () => call<any[]>('ListUnknownModels')
export const apiDownloadModel = (id: string, quant: string) => call<void>('DownloadModel', id, quant)
export const apiCancelDownload = (id: string) => call<void>('CancelDownload', id)
export const apiDeleteModel = (id: string, quant: string) => call<void>('DeleteModel', id, quant)
export const apiSetActiveModel = (id: string) => call<void>('SetActiveModel', id)
export const apiKeepAlive = () => call<void>('KeepAlive')
export const apiAssignUnknown = (path: string, id: string, quant: string) => call<any>('AssignUnknown', path, id, quant)

// ---------- 状态 / 配置 ----------
export const apiGetSystemStatus = () => call<any>('GetSystemStatus')
export const apiProbeEnv = () => call<any>('ProbeEnv')
export const apiGetConfig = () => call<any>('GetConfig')
export const apiSetConfig = (cfg: unknown) => call<void>('SetConfig', cfg)
export const apiGetLanguages = () => call<any[]>('GetLanguages')
export const apiEstimateCtxVRAM = (tokens: number) => call<any>('EstimateCtxVRAM', tokens)

// ---------- 字幕 ----------
export const apiSubOpen = () => call<any>('SubOpen')
export const apiSubTranslate = (docId: string, opt: unknown) => call<void>('SubTranslate', docId, opt)
export const apiSubPauseQueue = (docId: string) => call<void>('SubPauseQueue', docId)
export const apiSubResumeQueue = (docId: string) => call<void>('SubResumeQueue', docId)
export const apiSubCancelQueue = (docId: string) => call<void>('SubCancelQueue', docId)
export const apiSubRetryFailed = (docId: string, opt: unknown) => call<void>('SubRetryFailed', docId, opt)
export const apiSubRetryCues = (docId: string, ids: number[], opt: unknown) => call<void>('SubRetryCues', docId, ids, opt)
export const apiSubGetDoc = (docId: string) => call<any>('SubGetDoc', docId)
export const apiSubExport = (docId: string, opt: unknown) => call<void>('SubExport', docId, opt)

// ---------- 文档翻译（M5） ----------
export const apiDocTranslate = (req: { path: string; direction: string; glossaryId?: number }) => call<string>('DocTranslate', req)
export const apiDocResume = (docId: string) => call<void>('DocResume', docId)
export const apiDocCancel = (docId: string) => call<void>('DocCancel', docId)
export const apiDocGetDoc = (docId: string) => call<any>('DocGetDoc', docId)
export const apiDocExport = (docId: string, kind: 'translation' | 'bilingual') => call<void>('DocExport', docId, kind)

// ---------- 文档 ----------
export const apiCollectLogs = () => call<string>('CollectLogs')
export const apiOpenModelsFolder = () => call<void>('OpenModelsFolder')
export const apiOpenLogsFolder = () => call<void>('OpenLogsFolder')
export const apiPrepareExit = () => call<void>('PrepareExit')
export const apiQuit = () => call<void>('Quit')
