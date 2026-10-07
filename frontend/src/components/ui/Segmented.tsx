// Segmented —— DESIGN.md §5.3
// role="radiogroup" + 每项 role="radio" aria-checked；roving tabindex（选中项可 Tab，
// 其余 -1）；← → / ↑ ↓ 移动，Home/End 跳首尾；onChange 必填（类型层面杜绝死控件）。
// optionMeta（F-08b）：per-option 徽标 / 禁用 / 原因提示；键盘导航跳过禁用项，
// 选中项即使被标记禁用也保持可达（设置值落库后 GPU 条件变化时不锁死用户）。
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'

export type ButtonSize = 'sm' | 'md' | 'lg'

export interface SegmentedOptionMeta {
  disabled?: boolean
  badge?: string
  title?: string
}

export interface SegmentedProps<T extends string> {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  size?: ButtonSize
  optionMeta?: Readonly<Partial<Record<T, SegmentedOptionMeta>>>
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
  optionMeta,
  'aria-label': ariaLabel,
}: SegmentedProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const metaOf = (opt: T): SegmentedOptionMeta | undefined => optionMeta?.[opt]
  const isEnabled = (opt: T) => !(metaOf(opt)?.disabled && opt !== value)

  const moveTo = (target: T | undefined) => {
    if (target === undefined) return
    onChange(target)
    refs.current.get(target)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = options.length
    const idx = options.indexOf(value)
    const stepFrom = (start: number, dir: 1 | -1) => {
      for (let i = 1; i <= n; i++) {
        const opt = options[(start + dir * i + n) % n]
        if (isEnabled(opt)) return opt
      }
      return undefined
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveTo(stepFrom(idx, -1))
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      moveTo(stepFrom(idx, 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      moveTo(stepFrom(n - 1, 1))
    } else if (e.key === 'End') {
      e.preventDefault()
      moveTo(stepFrom(0, -1))
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
        const meta = metaOf(opt)
        const disabled = Boolean(meta?.disabled) && !selected
        return (
          <button
            key={opt}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={meta?.title}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(opt, el)
              else refs.current.delete(opt)
            }}
            onClick={() => onChange(opt)}
            className={`h-full rounded-sm px-3 text-body font-medium transition-colors duration-(--suj-dur-quick) ease-(--suj-ease-signature) ${
              disabled ? 'text-ink3' : selected ? 'bg-surface text-ink1 e-1' : 'text-ink2 hover:text-ink1'
            }`}
          >
            {opt}
            {meta?.badge && !disabled && (
              // 徽标用实底反色字（同 Badge accent 档）：红系字直接落在深浅底上都拉不开 4.5:1
              <span className="ml-1.5 inline-flex h-3.5 items-center rounded-full bg-accent px-1 text-micro font-medium leading-none text-inkInverse">
                {meta.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
