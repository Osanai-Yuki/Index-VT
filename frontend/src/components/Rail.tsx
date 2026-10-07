// 左导航 Rail（64px · 瑞士化：红方块标识 + 激活项红字 soft 底 + 左缘 2px 竖条）。
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
    <aside className="w-16 bg-surface border-r border-line flex flex-col items-center py-3.5 gap-1.5">
      {/* 瑞士经典红方块标识：直角、实底、无发光 */}
      <div className="w-9 h-9 bg-accent grid place-items-center mb-4 font-semibold text-title text-canvas">
        iV
      </div>
      {items.map(({ id, title, icon: Icon, disabled }) => {
        const active = page === id
        return (
          <button
            key={id}
            type="button"
            title={title}
            onClick={() => !disabled && setPage(id)}
            disabled={disabled}
            className={`relative w-11 h-11 grid place-items-center transition-colors duration-150 bg-transparent border-0 p-0 ${
              disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'
            } ${active ? 'text-accent bg-accentSoft' : 'text-ink3 hover:text-ink1 hover:bg-sunken'}`}
          >
            <Icon size={19} strokeWidth={1.8} />
            {active && (
              /* 左缘 2px 激活竖条：rail 64 − item 44 = 20，居中 → 每侧 10px，故 -left-2.5 */
              <span className="absolute -left-2.5 top-3 bottom-3 w-0.5 bg-accent" />
            )}
            {/* 活动指示点：任务进行中的页面 */}
            {!disabled && !active && (id === 'model' || (id === 'subtitle' && orchState === 'running')) && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-ok" />
            )}
          </button>
        )
      })}
    </aside>
  )
}
