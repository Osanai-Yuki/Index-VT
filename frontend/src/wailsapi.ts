// Wails bindings 薄封装：window.go / window.runtime 注入（Wails v2 运行时）。
// 纯浏览器 dev 模式下调用会 reject —— UI 需容忍。
import type { config, docpipeline, main, modelmanager, store, subtitle, translator } from '../wailsjs/go/models'

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
export const apiListGlossaries = () => call<store.Glossary[]>('ListGlossaries')
export const apiSaveGlossary = (g: Pick<store.Glossary, 'id' | 'name' | 'items'>) => call<number>('SaveGlossary', g)
export const apiDeleteGlossary = (id: number) => call<void>('DeleteGlossary', id)
export const apiSaveGlossaryCSV = (id: number) => call<string>('SaveGlossaryCSV', id)

// ---------- 模型 ----------
export const apiListModels = () => call<modelmanager.ModelInfo[]>('ListModels')
export const apiGetDownloadLocation = () => call<{ path: string; freeBytes: number; known: boolean }>('GetDownloadLocation')
export const apiListUnknownModels = () => call<any[]>('ListUnknownModels')
export const apiDownloadModel = (id: string, quant: string) => call<void>('DownloadModel', id, quant)
export const apiCancelDownload = (id: string) => call<void>('CancelDownload', id)
export const apiDeleteModel = (id: string, quant: string) => call<void>('DeleteModel', id, quant)
export const apiSetActiveModel = (id: string) => call<void>('SetActiveModel', id)
export const apiKeepAlive = () => call<void>('KeepAlive')
export const apiWarmDefaultModel = () => call<void>('WarmDefaultModel')
export const apiAssignUnknown = (path: string, id: string, quant: string) => call<any>('AssignUnknown', path, id, quant)

// ---------- 状态 / 配置 ----------
export const apiGetSystemStatus = () => call<main.SystemStatus>('GetSystemStatus')
export const apiNoteWorkspace = (page: string, dirty: boolean) => call<void>('NoteWorkspace', page, dirty)
export const apiConfirmExit = () => call<boolean>('ConfirmExit')
export const apiProbeEnv = () => call<any>('ProbeEnv')
export const apiGetConfig = () => call<config.Config>('GetConfig')
export const apiSetConfig = (cfg: unknown) => call<void>('SetConfig', cfg)
export const apiGetLanguages = () => call<translator.Lang[]>('GetLanguages')
export const apiEstimateCtxVRAM = (tokens: number) => call<any>('EstimateCtxVRAM', tokens)

// ---------- 字幕 ----------
export const apiSubOpen = () => call<subtitle.SubtitleDoc | null>('SubOpen')
export const apiSubTranslate = (docId: string, opt: unknown) => call<void>('SubTranslate', docId, opt)
export const apiSubPauseQueue = (docId: string) => call<void>('SubPauseQueue', docId)
export const apiSubResumeQueue = (docId: string) => call<void>('SubResumeQueue', docId)
export const apiSubCancelQueue = (docId: string) => call<void>('SubCancelQueue', docId)
export const apiSubRetryFailed = (docId: string, opt: unknown) => call<void>('SubRetryFailed', docId, opt)
export const apiSubRetryCues = (docId: string, ids: number[], opt: unknown) => call<void>('SubRetryCues', docId, ids, opt)
export const apiSubGetDoc = (docId: string) => call<subtitle.SubtitleDoc>('SubGetDoc', docId)
export const apiSubExport = (docId: string, opt: unknown) => call<string>('SubExport', docId, opt)
export const apiSubUndo = (docId: string, redo = false) => call<subtitle.SubtitleDoc>('SubUndo', docId, redo)
export const apiSubShiftCue = (docId: string, index: number, field: string, delta: number) => call<subtitle.SubtitleDoc>('SubShiftCue', docId, index, field, delta)
export const apiRevealFile = (path: string) => call<void>('RevealFile', path)

// ---------- 字幕编辑（M4） ----------
export const apiSubUpdateCue = (docId: string, index: number, patch: unknown) => call<subtitle.SubtitleDoc>('SubUpdateCue', docId, index, patch)
export const apiSubSplitCue = (docId: string, index: number, atMs: number) => call<subtitle.SubtitleDoc>('SubSplitCue', docId, index, atMs)
export const apiSubMergeCues = (docId: string, fromIndex: number, toIndex: number) => call<subtitle.SubtitleDoc>('SubMergeCues', docId, fromIndex, toIndex)
export const apiSubShiftAll = (docId: string, deltaMs: number) => call<subtitle.SubtitleDoc>('SubShiftAll', docId, deltaMs)
export const apiSubCalibrate = (docId: string, anchor1Idx: number, anchor2Idx: number, anchor1Ms: number, anchor2Ms: number) => call<subtitle.SubtitleDoc>('SubCalibrate', docId, anchor1Idx, anchor2Idx, anchor1Ms, anchor2Ms)
export const apiSubDeleteCues = (docId: string, indices: number[]) => call<subtitle.SubtitleDoc>('SubDeleteCues', docId, indices)
export const apiSubInsertCue = (docId: string, afterIndex: number) => call<subtitle.SubtitleDoc>('SubInsertCue', docId, afterIndex)
export const apiSubStyles = (docId: string) => call<any[]>('SubStyles', docId)
export const apiSubSetStyle = (docId: string, style: unknown) => call<subtitle.SubtitleDoc>('SubSetStyle', docId, style)
export const apiSubAssignStyle = (docId: string, indices: number[], styleName: string) => call<subtitle.SubtitleDoc>('SubAssignStyle', docId, indices, styleName)

// ---------- 文档翻译（M5） ----------
export const apiDocPick = () => call<{ path: string; chars: number; tooLong: boolean; unsupported: boolean } | null>('DocPick')
export const apiDocTranslate = (req: { path: string; direction: string; glossaryId?: number }) => call<string>('DocTranslate', req)
export const apiDocResume = (docId: string) => call<void>('DocResume', docId)
export const apiDocRestart = (docId: string) => call<void>('DocRestart', docId)
export const apiDocCancel = (docId: string) => call<void>('DocCancel', docId)
export const apiDocGetDoc = (docId: string) => call<docpipeline.Doc>('DocGetDoc', docId)
export const apiDocExport = (docId: string, kind: 'translation' | 'bilingual' | 'translation-partial' | 'bilingual-partial') => call<string>('DocExport', docId, kind)

// ---------- 文档 ----------
export const apiCollectLogs = () => call<string>('CollectLogs')
export const apiClearLogs = () => call<{ removed: number; skipped: string[] }>('ClearLogs')
export const apiOpenModelsFolder = () => call<void>('OpenModelsFolder')
export const apiOpenLogsFolder = () => call<void>('OpenLogsFolder')
export const apiPrepareExit = () => call<void>('PrepareExit')
export const apiQuit = () => call<void>('Quit')
