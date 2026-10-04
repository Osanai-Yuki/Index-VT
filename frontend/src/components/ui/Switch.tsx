// Switch —— DESIGN.md §5.4
// 36×20 轨道（w-9 h-5）、knob 16px（size-4）、行程 16px（translate-x-4）。
// on = --primary 实底 + --ink-inverse knob；off = --sunken 底 + 1px --line + --ink-3 knob。
// 真实 <button role="switch" aria-checked>；Space/Enter 由原生 button 激活语义承担。
// label 必填：默认渲染可见文本；srOnly=true 时仅保留可访问名。
export interface SwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  /** true → 不渲染可见文本，label 仅作可访问名（外部已有可见标签时用） */
  srOnly?: boolean
}

export function Switch({ checked, onChange, label, disabled = false, srOnly = false }: SwitchProps) {
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-45' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={srOnly ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-(--suj-dur-quick) ease-(--suj-ease-signature) disabled:cursor-not-allowed ${
          checked ? 'bg-primary' : 'border border-line bg-sunken'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-0.5 top-1/2 size-4 -translate-y-1/2 rounded-full transition-transform duration-(--suj-dur-quick) ease-(--suj-ease-signature) ${
            checked ? 'translate-x-4 bg-inkInverse' : 'translate-x-0 bg-ink3'
          }`}
        />
      </button>
      {!srOnly && <span className="text-body text-ink1">{label}</span>}
    </label>
  )
}
