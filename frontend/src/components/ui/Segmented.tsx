// Segmented —— DESIGN.md §5.3
// role="radiogroup" + 每项 role="radio" aria-checked；roving tabindex（选中项可 Tab，
// 其余 -1）；← → / ↑ ↓ 移动，Home/End 跳首尾；onChange 必填（类型层面杜绝死控件）。
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface SegmentedProps<T extends string> {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  size?: ButtonSize
  'aria-label': string
}

const CONTAINER_CLS: Record<ButtonSize, string> = {
  sm: 'h-(--suj-h-control-sm)',
  md: 'h-(--suj-h-control)',
  lg: 'h-(--suj-h-control-lg)',
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>())

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = options.indexOf(value)
    let target: T | undefined
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      target = options[(idx - 1 + options.length) % options.length]
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      target = options[(idx + 1) % options.length]
    } else if (e.key === 'Home') {
      target = options[0]
    } else if (e.key === 'End') {
      target = options[options.length - 1]
    }
    if (target !== undefined) {
      e.preventDefault()
      onChange(target)
      refs.current.get(target)?.focus()
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={`inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5 ${CONTAINER_CLS[size]}`}
    >
      {options.map((opt) => {
        const selected = opt === value
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(opt, el)
              else refs.current.delete(opt)
            }}
            onClick={() => onChange(opt)}
            className={`h-full rounded-sm px-3 text-body font-medium transition-colors duration-(--suj-dur-quick) ease-(--suj-ease-signature) ${
              selected ? 'bg-surface text-ink1 e-1' : 'text-ink2 hover:text-ink1'
            }`}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}
