// Slider —— 原生 <input type="range"> + accent-color（品牌 accent 着色，
// 保持原生键盘语义：←→/↑↓ 步进、Home/End）。label 必填；formatValue 定制数值展示。
import { useId } from 'react'

export interface SliderProps {
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  label: string
  formatValue?: (n: number) => string
  step?: number
}

export function Slider({ value, onChange, min, max, label, formatValue, step }: SliderProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-caption font-medium text-ink2">
          {label}
        </label>
        <span className="num text-caption text-ink1">{formatValue ? formatValue(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-(--suj-h-control) w-full accent-(--suj-accent)"
      />
    </div>
  )
}
