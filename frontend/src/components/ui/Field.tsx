// Field / Input —— DESIGN.md §5.5
// 高 32（sm 28）、padding 0 10、radius-sm、--sunken 底；默认无边框（用 transparent
// border 占位避免 error/focus 态切换时布局跳动）；focus → 1px --accent；
// 焦点环由 base.css 的 :focus-visible 统一提供（组件内不得移除/覆盖焦点环）。
// label 必填（12px/500 --ink-2 置于控件上方，杜绝 placeholder-only）；
// 错误态：1px --danger + 下方 12px --danger 文案（带图标）+ aria-invalid/describedby。
import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string
  error?: string
  hint?: ReactNode
  /** sm → 28 高，默认 32 */
  size?: 'sm' | 'md'
}

export function Field({ label, error, hint, size = 'md', className, id, ...rest }: FieldProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errId = error ? `${inputId}-err` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-caption font-medium text-ink2">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errId ?? hintId}
        className={`rounded-sm border bg-sunken px-2.5 text-body text-ink1 placeholder:text-ink3 focus-visible:border-accent ${
          size === 'sm' ? 'h-(--suj-h-control-sm)' : 'h-(--suj-h-control)'
        } ${error ? 'border-danger' : 'border-transparent'} ${className ?? ''}`}
        {...rest}
      />
      {hint && !error && (
        <span id={hintId} className="text-caption text-ink3">
          {hint}
        </span>
      )}
      {error && (
        <span id={errId} className="inline-flex items-center gap-1 text-caption text-danger" role="alert">
          <CircleAlert size={12} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  )
}
