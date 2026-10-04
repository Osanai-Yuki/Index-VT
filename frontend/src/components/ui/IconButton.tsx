// IconButton —— DESIGN.md §5.1（图标按钮：正方形 = 高度，必须带 aria-label 与 tooltip）
// Task 2.7 起 tooltip 由 Tooltip 原语承担（hover + 键盘聚焦均可触发），
// 不再依赖原生 title（原生 title 无键盘可达性且延迟不可控）。
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 必填：aria-label + tooltip 文案 */
  label: string
  icon: ReactNode
  size?: ButtonSize
  loading?: boolean
}

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'size-(--suj-h-control-sm)',
  md: 'size-(--suj-h-control)',
  lg: 'size-(--suj-h-control-lg)',
}

export function IconButton({
  label,
  icon,
  size = 'md',
  loading = false,
  className,
  disabled,
  type,
  ...rest
}: IconButtonProps) {
  const cls = [
    'inline-flex items-center justify-center rounded-sm',
    'transition-[background-color,color,transform] duration-120 ease-(--suj-ease-signature)',
    'active:scale-98',
    'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
    SIZE_CLS[size],
    className ?? '',
  ].join(' ')

  return (
    <Tooltip content={label}>
      <button
        type={type ?? 'button'}
        className={cls}
        aria-label={label}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...rest}
      >
        {loading ? <Spinner /> : icon}
      </button>
    </Tooltip>
  )
}
