// NumberField —— DESIGN.md §5.5 数字输入：--font-mono + tabular-nums（.num）+ 右对齐。
// 值与回调为 number；空输入（valueAsNumber 为 NaN）不触发 onChange，交由调用方保留旧值。
import { useId } from 'react'
import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'

export interface NumberFieldProps
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'type' | 'onChange' | 'value' | 'size'> {
  value: number
  onChange: (n: number) => void
  min?: number
  max?: number
  step?: number
  label: string
  error?: string
  hint?: ReactNode
}

export function NumberField({ value, onChange, min, max, step, label, error, hint, ...rest }: NumberFieldProps) {
  const autoId = useId()
  const inputId = rest.id ?? autoId
  const errId = error ? `${inputId}-err` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-caption font-medium text-ink2">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.target.valueAsNumber
          if (!Number.isNaN(n)) onChange(n)
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={errId ?? hintId}
        className={`num h-(--suj-h-control) rounded-sm border bg-sunken px-2.5 text-right text-body text-ink1 focus-visible:border-accent ${
          error ? 'border-danger' : 'border-transparent'
        } ${rest.className ?? ''}`}
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
