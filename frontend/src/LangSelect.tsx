// 语言选择器：150 语言 + auto，搜索过滤 + 最近使用置顶（01 文档 §6.2）。
// Track C 迁移版（2026-10-06）：新 token + 真语义按钮（触发器/列表项均可键盘达）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe, ChevronDown, Check } from 'lucide-react'

export interface Lang {
  code: string
  zhName: string
  enName: string
  script: string
  core?: boolean
}

export function LangSelect({
  langs,
  value,
  onChange,
  isSource,
  detected,
  recent,
  disabled = false,
}: {
  langs: Lang[]
  value: string
  onChange: (code: string) => void
  isSource: boolean
  detected?: string
  recent: string[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const cur = useMemo(() => {
    if (isSource && value === 'auto') return { code: 'auto', zhName: '自动检测', enName: 'AUTO' }
    return langs.find((l) => l.code === value) ?? { code: value, zhName: value, enName: value }
  }, [value, langs, isSource])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    let list = langs
    if (kw) {
      list = langs.filter(
        (l) =>
          l.zhName.toLowerCase().includes(kw) ||
          l.enName.toLowerCase().includes(kw) ||
          l.code.toLowerCase().includes(kw),
      )
    }
    // 最近使用置顶
    const recentSet = new Set(recent)
    const head = list.filter((l) => recentSet.has(l.code))
    const tail = list.filter((l) => !recentSet.has(l.code))
    return [...head, ...tail]
  }, [langs, q, recent])

  const detectedName = detected ? langs.find((l) => l.code === detected)?.zhName : undefined

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2.5 bg-sunken border border-line px-3.5 py-2 min-w-40 cursor-pointer hover:border-lineStrong transition-colors duration-150"
      >
        <Globe size={15} className="text-ink3" />
        <span className="leading-tight text-left">
          <b className="block text-body font-semibold text-ink1">{cur.zhName}</b>
          <small className="block text-micro text-ink3 tracking-caps uppercase">
            {isSource ? (value === 'auto' ? (detectedName ? `DETECTED · ${detectedName}` : 'AUTO') : cur.enName) : 'TARGET'}
          </small>
        </span>
        <ChevronDown size={13} className="ml-1 text-ink3" />
      </button>
      {open && (
        <div className="absolute top-full mt-1.5 left-0 w-65 max-h-85 bg-raised border border-lineStrong z-(--suj-z-popover) flex flex-col overflow-hidden enter-pop">
          <div className="p-2 border-b border-line">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索语言…"
              className="w-full bg-sunken border border-line px-2.5 py-1.5 text-caption text-ink1"
            />
          </div>
          <div className="overflow-auto">
            {isSource && (
              <Row
                label="自动检测"
                sub="AUTO"
                selected={value === 'auto'}
                onClick={() => {
                  onChange('auto')
                  setOpen(false)
                }}
              />
            )}
            {filtered.map((l) => (
              <Row
                key={l.code}
                label={l.zhName}
                sub={l.enName}
                selected={value === l.code}
                onClick={() => {
                  onChange(l.code)
                  setOpen(false)
                }}
              />
            ))}
            {filtered.length === 0 && !isSource && (
              <div className="px-3 py-4 text-caption text-ink3">无匹配语言</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 cursor-pointer text-body text-left bg-transparent border-0 ${
        selected ? 'bg-sunken text-accent' : 'text-ink1 hover:bg-sunken'
      }`}
    >
      <span className="flex-1">{label}</span>
      <span className="text-micro text-ink3 tracking-caps uppercase">{sub}</span>
      {selected && <Check size={13} className="text-accent" />}
    </button>
  )
}
