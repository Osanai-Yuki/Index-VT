// App 外壳：Rail + 页面 + StatusBar；首次引导覆盖层；退出释放编排。
import { useEffect, useRef, useState } from 'react'
import { IdleReleaseNotice } from './components/IdleReleaseNotice'
import { toast } from './stores/toastStore'
import { Rail } from './components/Rail'
import { StatusBar } from './components/StatusBar'
import { ToastHost } from './components/ui/index'
import { MainTranslate } from './pages/MainTranslate'
import { SubtitleWorkbench } from './pages/SubtitleWorkbench'
import { DocTranslatePage } from './pages/DocTranslate'
import { ModelHub } from './pages/ModelHub'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { useAppStore, wireEvents, loadInitialConfig } from './stores/appStore'
import { apiGetLanguages, apiPrepareExit, apiQuit, apiSetConfig, apiWarmDefaultModel, apiConfirmExit } from './wailsapi'

export default function App() {
  const page = useAppStore((s) => s.page)
  const onboarded = useAppStore((s) => s.onboarded)
  const orchState = useAppStore((s) => s.orchState)
  const [langs, setLangs] = useState<any[]>([])
  const [exiting, setExiting] = useState(false)
  const warmed = useRef(false)
  const exitPending = useRef(false)

  useEffect(() => {
    const unwire = wireEvents()
    loadInitialConfig()
    apiGetLanguages()
      .then((ls) => setLangs(ls ?? []))
      .catch(() => {
        // 浏览器 dev：内置核心语言兜底
        setLangs([
          { code: 'en', zhName: '英语', enName: 'English' },
          { code: 'zh', zhName: '中文', enName: 'Chinese' },
          { code: 'ja', zhName: '日语', enName: 'Japanese' },
        ])
      })
    return unwire
  }, [])

  useEffect(() => {
    if (onboarded !== true || warmed.current) return
    warmed.current = true
    apiWarmDefaultModel()
      .catch(error => toast.push({ tone: 'error', message: `默认模型加载失败：${String(error)}。请到模型中心检查模型与引擎。` }))
      .finally(() => useAppStore.getState().refreshStatus())
  }, [onboarded])

  // 退出编排：Ctrl+Q 或窗口关闭前走 PrepareExit（02 文档 §6.3）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault()
        doExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doExit = async () => {
    if (exitPending.current) return
    exitPending.current = true
    try {
      if (!await apiConfirmExit()) { exitPending.current = false; return }
    } catch (error) {
      exitPending.current = false
      toast.push({ tone: 'error', message: `无法确认退出：${String(error)}` })
      return
    }
    setExiting(true)
    try { await apiPrepareExit() } catch { /* 仍尝试关闭，后端 OnBeforeClose 与 Job Object 兜底释放。 */ }
    try { await apiQuit() }
    catch (error) {
      exitPending.current = false
      setExiting(false)
      toast.push({ tone: 'error', message: `退出失败，请重试关闭窗口：${String(error)}` })
    }
  }

  // 完成引导必须把 Onboarded 落库：旧版只写 zustand 内存态，Go 侧 config.onboarded
  // 恒为 false，每次启动都重走引导，第 3 步会再次自动发起模型下载。
  const completeOnboarding = () => {
    useAppStore.setState({ onboarded: true })
    const cfg = useAppStore.getState().cfg
    if (cfg) {
      apiSetConfig({ ...cfg, onboarded: true }).catch(() => {})
    }
  }

  if (exiting) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <div className="text-title font-semibold text-accent">正在释放模型资源…</div>
          <div className="text-caption text-ink3 mt-2">CTRL_BREAK → 进程退出 → 显存归零</div>
        </div>
      </div>
    )
  }

  if (onboarded === false) {
    return <Onboarding onDone={completeOnboarding} />
  }

  return (
    <div
      className="h-full grid app-glow"
      style={{
        gridTemplateColumns: 'var(--suj-h-rail) 1fr',
        gridTemplateRows: '1fr var(--suj-h-status)',
        gridTemplateAreas: '"rail main" "statusbar statusbar"',
      }}
    >
      <div className="min-h-0" style={{ gridArea: 'rail' }}>
        <Rail />
      </div>
      <main className="overflow-hidden pt-6 pb-8" style={{ gridArea: 'main', paddingInline: 'var(--suj-pad-shell-x)' }}>
        <h1 className="sr-only">{{ translate: '主翻译台', subtitle: '字幕工作台', doc: '文档翻译', model: '模型中心', settings: '设置' }[page]}</h1>
        {/* Keep the subtitle session mounted: tasks, draft, selection and scroll survive navigation. */}
        <div hidden={page !== 'subtitle'} className="h-full">
          <SubtitleWorkbench langs={langs} active={page === 'subtitle'} />
        </div>
        <div hidden={page !== 'translate'} className="h-full">
          <MainTranslate langs={langs} active={page === 'translate'} />
        </div>
        <div hidden={page !== 'doc'} className="h-full">
          <DocTranslatePage active={page === 'doc'} />
        </div>
        <div key={page} hidden={page !== 'model' && page !== 'settings'} className="h-full screen-in">
          {page === 'model' && <ModelHub />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
      <div className="min-w-0" style={{ gridArea: 'statusbar' }}>
        <StatusBar />
      </div>
      {/* 全局 toast 通知（右下角，error 不自动消失） */}
      <ToastHost />
      <IdleReleaseNotice />
      {/* 全局状态提示（模型唤醒/崩溃等） */}
      {(orchState === 'starting' || orchState === 'crashed') && (
        <div className="fixed top-0 right-0 h-8 flex items-center justify-center text-micro tracking-wider pointer-events-none"
          style={{ left: 'var(--suj-h-rail)', background: orchState === 'crashed' ? 'var(--suj-danger-soft)' : 'var(--suj-accent-soft)', color: orchState === 'crashed' ? 'var(--suj-danger)' : 'var(--suj-accent)' }}>
          {orchState === 'starting' ? '● 模型唤醒中 — llama-server 启动并探活' : '● 推理进程崩溃 — 自动重启失败，请查看日志或重新提交任务'}
        </div>
      )}
    </div>
  )
}
