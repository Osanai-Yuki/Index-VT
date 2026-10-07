// ModeDetails —— 约束模板只读详情（主翻译台顶栏与设置页共用）。
// 展示一份 ModePreset 的全部约束字段；只读，故 initialFocus="first"。
import { Modal } from './ui/index'
import type { ModePreset } from '../lib/modes'

export function ModeDetails({
  preset,
  open,
  onClose,
}: {
  preset: ModePreset | null
  open: boolean
  onClose: () => void
}) {
  const c = preset?.constraints
  return (
    <Modal open={open} onClose={onClose} title={preset ? `约束详情：${preset.name}` : '约束详情'} initialFocus="first">
      {preset && c ? (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink2">{preset.description}</p>
          <div>
            <div className="text-micro uppercase tracking-caps text-ink3 mb-1.5">
              硬约束 · <b className="text-ink2 font-medium">HARD</b>
            </div>
            {c.hard.length ? (
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-caption text-ink2">
                {c.hard.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ol>
            ) : (
              <p className="text-caption text-ink3">无（不加硬性要求）</p>
            )}
          </div>
          <div>
            <div className="text-micro uppercase tracking-caps text-ink3 mb-1.5">
              软约束 · <b className="text-ink2 font-medium">SOFT</b>
            </div>
            {c.soft.length ? (
              <ol className="list-decimal pl-5 flex flex-col gap-1 text-caption text-ink2">
                {c.soft.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-caption text-ink3">无</p>
            )}
          </div>
          <div className="flex gap-6 text-caption text-ink2">
            <span>
              文体域：<b className="text-ink1 font-medium">{c.genre || '文本'}</b>
            </span>
            <span>
              JSON 结构保持：<b className="text-ink1 font-medium">{c.jsonPreserve ? '开' : '关'}</b>
            </span>
          </div>
          {preset.builtin ? (
            <p className="text-caption text-ink3">内置模板，只读；可在约束抽屉里微调后另存为自定义模式。</p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}
