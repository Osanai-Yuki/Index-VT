// IconButton —— DESIGN.md §5.1（图标按钮：正方形 = 高度，必须带 aria-label 与 tooltip）
// label 同时作为 aria-label 与 title（Tooltip 原语在 Task 2.7 落地后替换 title，
// 交付前在报告中记一条待替换项）。
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

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
    <button
      type={type ?? 'button'}
      className={cls}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
    </button>
  )
}
