// Kbd —— 快捷键提示徽标。mono + text-micro + 1px --line + --sunken 底。
// 键序渲染为多个 <kbd>（辅助技术逐键可读）。
export interface KbdProps {
  keys: string[]
}

export function Kbd({ keys }: KbdProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="num inline-flex h-5 items-center rounded-xs border border-line bg-sunken px-1.5 text-micro text-ink2"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
