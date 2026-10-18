// 左导航 Rail：80px 图标与短标签；工作入口置顶，模型与设置置底。
import { Languages, Subtitles, FileText, Boxes, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import { Page, useAppStore } from '../stores/appStore'

const items: { id: Page; title: string; label: string; icon: LucideIcon }[] = [
  { id: 'translate', title: '主翻译台', label: '翻译', icon: Languages },
  { id: 'subtitle', title: '字幕工作台', label: '字幕', icon: Subtitles },
  { id: 'doc', title: '文档翻译', label: '文档', icon: FileText },
  { id: 'model', title: '模型中心', label: '模型', icon: Boxes },
  { id: 'settings', title: '设置', label: '设置', icon: SettingsIcon },
]

export function Rail() {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const tasks = useAppStore((s) => s.pageTasks)
  const downloading = useAppStore((s) => s.status?.models?.some((m: { state: string }) => m.state === 'downloading'))
  const renderItem = ({ id, title, label, icon: Icon }: (typeof items)[number]) => {
    const active = page === id
    return (
      <button
        key={id}
        type="button"
        title={title}
        aria-label={title}
        aria-current={active ? 'page' : undefined}
        onClick={() => setPage(id)}
        className={`relative w-full h-16 shrink-0 flex flex-col items-center justify-center gap-1.5 transition-colors duration-150 border-0 p-0 cursor-pointer ${
          active ? 'text-ink1 bg-sunken font-medium' : 'bg-transparent text-ink3 hover:text-ink1 hover:bg-sunken'
        }`}
      >
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
        <span className="text-micro leading-none">{label}</span>
        {active && (
          <span className="absolute left-0 top-3 bottom-3 w-0.5 bg-accent" aria-hidden="true" />
        )}
        {/* 活动指示点：任务进行中的页面 */}
        {!active && (tasks[id] || (id === 'model' && downloading)) && (
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-ok" aria-hidden="true" />
        )}
      </button>
    )
  }
  return (
    <aside className="w-full h-full min-h-0 bg-surface border-r border-line flex flex-col items-center pt-4 pb-3" aria-label="应用导航">
      <div className="w-7 h-7 shrink-0 bg-accent grid place-items-center mb-5 font-semibold text-body text-inkInverse" title="Index-VT">
        iV
      </div>
      <nav className="w-full flex-1 min-h-0 flex flex-col gap-4 px-2 overflow-y-auto" aria-label="页面导航">
        <div className="flex flex-col gap-1.5 shrink-0">
          {items.slice(0, 3).map(renderItem)}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0 mt-auto border-t border-line pt-3">
          {items.slice(3).map(renderItem)}
        </div>
      </nav>
    </aside>
  )
}
