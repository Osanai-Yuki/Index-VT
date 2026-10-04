// Spinner —— 唯一允许 linear 动效的元素（DESIGN.md §5.1 / §8）
// 尺寸默认 14px（Button loading 档）；.spinner 类名是 base.css reduced-motion
// 降级块的锚点（降速到 1600ms 而非移除——完全静止会被当成卡死）。
export interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 14, className }: SpinnerProps) {
  return (
    <svg
      className={`spinner animate-spin ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
