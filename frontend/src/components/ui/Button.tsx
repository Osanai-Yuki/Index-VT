// Button —— DESIGN.md §5.1
// 尺寸 28/32/36 引用 §4.3 高度 token（h-(--suj-h-control-sm|control|control-lg)）；
// padding sm 0 10px（px-2.5）、md/lg 0 14px（px-3.5）；radius --radius-sm；
// 字体 --text-body / 500。active scale(.98) 120ms 为 §5.1 的显式字面值，
// 不属 §8 三档 duration（组件规格优先）。
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

const SIZE_CLS: Record<ButtonSize, string> = {
  sm: 'h-(--suj-h-control-sm) px-2.5',
  md: 'h-(--suj-h-control) px-3.5',
  lg: 'h-(--suj-h-control-lg) px-3.5',
}

const KIND_CLS: Record<ButtonKind, string> = {
  primary: 'bg-primary text-inkInverse',
  secondary: 'bg-surface border border-line text-ink1 hover:bg-sunken hover:border-lineStrong',
  ghost: 'bg-transparent text-ink2 hover:bg-sunken hover:text-ink1',
  danger:
    'bg-transparent border border-danger/40 text-danger hover:bg-dangerSoft',
}

export function Button({
  kind = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps) {
  const cls = [
    'inline-flex items-center justify-center gap-2 rounded-sm text-body font-medium',
    'transition-[background-color,border-color,color,transform] duration-120 ease-(--suj-ease-signature)',
    'active:scale-98',
    'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
    SIZE_CLS[size],
    KIND_CLS[kind],
    className ?? '',
  ].join(' ')

  return (
    <button
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}
