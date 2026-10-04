// Checkbox —— 16px（DESIGN.md §5.7 首列），真实 <input type="checkbox">（原生 role=checkbox，
// indeterminate 状态经 input.indeterminate 传达给辅助技术）。外层 <label> 保证点击区与标签关联。
// checked = --primary 实底 + 反色勾；off = --sunken 底 + 1px --line。
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface CheckboxProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  indeterminate?: boolean
  disabled?: boolean
}

export function Checkbox({ checked, onChange, label, indeterminate = false, disabled = false }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-45' : ''}`}>
      <input
        ref={inputRef}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {/* 盒子：peer-checked / peer-indeterminate 跟随原生状态（appearance-none 方案在
          WebView2 下勾形渲染不一致，故用 sr-only input + 兄弟节点绘制） */}
      <span
        aria-hidden="true"
        className="flex size-4 items-center justify-center rounded-xs border border-line bg-sunken transition-colors duration-(--suj-dur-quick) ease-(--suj-ease-signature) peer-checked:border-primary peer-checked:bg-primary peer-indeterminate:border-primary peer-indeterminate:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed"
      >
        {indeterminate ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1" y="4" width="8" height="2" rx="1" className="fill-inkInverse" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={checked ? '' : 'hidden'}>
            <path d="M1.5 5.5 4 8l4.5-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-inkInverse" />
          </svg>
        )}
      </span>
      <span className="text-body text-ink1">{label}</span>
    </label>
  )
}
