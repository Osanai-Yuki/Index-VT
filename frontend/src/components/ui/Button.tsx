// Button —— DESIGN.md §5.1 · 2026-10-06 瑞士化
// 尺寸 28/32/36 引用 §4.3 高度 token；padding sm 0 10px、md/lg 0 14px；
// radius --radius-sm（现已 0 = 直角）。Swiss Rational Restraint：
// 交互只允许颜色/边框色变化（150ms ease-out），移除 active:scale。
// arrow：瑞士按钮必须带方向性（→ 是排版的一部分）——主 CTA 传 arrow，
// 箭头是唯一允许的交互位移（group-hover 右移一格）。
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Spinner } from './Spinner'

export type ButtonKind = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: ButtonKind
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  arrow?: boolean
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

/** forwardRef：Tooltip 定位与 Modal 初始焦点需要真实 button 引用 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = 'secondary', size = 'md', loading = false, icon, arrow = false, className, children, disabled, type, ...rest },
  ref,
) {
  const cls = [
    'group inline-flex items-center justify-center gap-2 rounded-sm text-body font-medium',
    'transition-[background-color,border-color,color] duration-150 ease-(--suj-ease-signature)',
    'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
    SIZE_CLS[size],
    KIND_CLS[kind],
    className ?? '',
  ].join(' ')

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {arrow && !loading && (
        <ArrowRight
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="transition-transform duration-150 ease-(--suj-ease-signature) group-hover:translate-x-1"
        />
      )}
    </button>
  )
})
