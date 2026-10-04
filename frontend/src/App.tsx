// App 外壳：Rail + 页面 + StatusBar；首次引导覆盖层；退出释放编排。
import { useEffect, useState } from 'react'
import { Rail } from './components/Rail'
import { StatusBar } from './components/StatusBar'
import { MainTranslate } from './pages/MainTranslate'
import { SubtitleWorkbench } from './pages/SubtitleWorkbench'
import { ModelHub } from './pages/ModelHub'
import { SettingsPage } from './pages/Settings'
import { Onboarding } from './pages/Onboarding'
import { useAppStore, wireEvents, loadInitialConfig } from './stores/appStore'
import { apiGetLanguages, apiPrepareExit, apiQuit } from './wailsapi'

function DocTranslatePlaceholder() {
  return (
    <div className="h-full grid place-items-center bg-bg-1 border border-hairline rounded-[14px] empty-dots">
      <div className="text-center">
        <div className="text-4xl mb-3">📄</div>
        <div className="text-[15px] font-semibold text-ink-2">长文档翻译 · M5 里程碑提供</div>
        <div className="text-xs text-ink-3 mt-1.5">
          Index-Nailong-2B · zh↔en / zh↔ja · ctx 8K/16K/32K · 全文人名一致性
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const page = useAppStore((s) => s.page)
  const onboarded = useAppStore((s) => s.onboarded)
  const orchState = useAppStore((s) => s.orchState)
  const [langs, setLangs] = useState<any[]>([])
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    wireEvents()
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
  }, [])

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

  const doExit = () => {
    setExiting(true)
    apiPrepareExit()
      .catch(() => {})
      .finally(() => apiQuit().catch(() => {}))
  }

  if (exiting) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <div className="text-[15px] font-semibold text-accent">正在释放模型资源…</div>
          <div className="text-xs text-ink-3 mt-2 font-mono">CTRL_BREAK → 进程退出 → 显存归零</div>
        </div>
      </div>
    )
  }

  if (onboarded === false) {
    return <Onboarding onDone={() => useAppStore.setState({ onboarded: true })} />
  }

  return (
    <div className="h-full grid app-glow" style={{ gridTemplateColumns: '64px 1fr', gridTemplateRows: '1fr 40px', gridTemplateAreas: '"rail main" "rail statusbar"' }}>
      <div style={{ gridArea: 'rail' }}>
        <Rail />
      </div>
      <main className="overflow-hidden px-6 pt-5 pb-7" style={{ gridArea: 'main' }}>
        <div key={page} className="h-full screen-in">
          {page === 'translate' && <MainTranslate langs={langs} />}
          {page === 'subtitle' && <SubtitleWorkbench langs={langs} />}
          {page === 'doc' && <DocTranslatePlaceholder />}
          {page === 'model' && <ModelHub />}
          {page === 'settings' && <SettingsPage />}
        </div>
      </main>
      <div style={{ gridArea: 'statusbar' }}>
        <StatusBar />
      </div>
      {/* 全局状态提示（模型唤醒/崩溃等） */}
      {(orchState === 'starting' || orchState === 'crashed') && (
        <div className="fixed top-0 left-16 right-0 h-8 flex items-center justify-center font-mono text-[11px] tracking-wider pointer-events-none"
          style={{ background: orchState === 'crashed' ? 'var(--danger-soft)' : 'var(--accent-soft)', color: orchState === 'crashed' ? 'var(--danger)' : 'var(--accent)' }}>
          {orchState === 'starting' ? '● 模型唤醒中 — llama-server 启动并探活' : '● 推理进程崩溃 — 自动重启失败，请查看日志或重新提交任务'}
        </div>
      )}
    </div>
  )
}
