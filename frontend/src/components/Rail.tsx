// 左导航 Rail（64px，规范 §4：激活项琥珀 + soft 底 + 左缘 2px 竖条）。
import { Languages, Subtitles, FileText, Boxes, Settings as SettingsIcon } from 'lucide-react'
import { Page, useAppStore } from '../stores/appStore'

const items: { id: Page; title: string; icon: any; disabled?: boolean }[] = [
  { id: 'translate', title: '主翻译台', icon: Languages },
  { id: 'subtitle', title: '字幕工作台', icon: Subtitles },
  { id: 'doc', title: '文档翻译（M5 提供）', icon: FileText, disabled: true },
  { id: 'model', title: '模型中心', icon: Boxes },
  { id: 'settings', title: '设置', icon: SettingsIcon },
]

export function Rail() {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const orchState = useAppStore((s) => s.orchState)
  return (
    <aside className="w-16 bg-bg-1 border-r border-hairline flex flex-col items-center py-3.5 gap-1.5">
      <div className="w-[38px] h-[38px] rounded-[10px] bg-accent grid place-items-center mb-4 font-mono font-semibold text-[15px] text-bg-0 shadow-[0_0_0_1px_rgba(232,163,61,.5),0_0_24px_rgba(232,163,61,.18)]">
        iV
      </div>
      {items.map(({ id, title, icon: Icon, disabled }) => {
        const active = page === id
        return (
          <div
            key={id}
            title={title}
            onClick={() => !disabled && setPage(id)}
            className={`relative w-11 h-11 rounded-[10px] grid place-items-center transition-all ${
              disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
            } ${active ? 'text-accent bg-accent-soft' : 'text-ink-3 hover:text-ink-1 hover:bg-bg-2'}`}
          >
            <Icon size={19} strokeWidth={1.8} />
            {active && (
              <span className="absolute -left-[10px] top-3 bottom-3 w-0.5 bg-accent rounded-sm" />
            )}
            {/* 活动指示点：任务进行中的页面 */}
            {!disabled && !active && (id === 'model' || (id === 'subtitle' && orchState === 'running')) && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-teal" />
            )}
          </div>
        )
      })}
    </aside>
  )
}
