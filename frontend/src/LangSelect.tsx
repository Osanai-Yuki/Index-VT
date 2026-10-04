// 语言选择器：150 语言 + auto，搜索过滤 + 最近使用置顶（01 文档 §6.2）。
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
}: {
  langs: Lang[]
  value: string
  onChange: (code: string) => void
  isSource: boolean
  detected?: string
  recent: string[]
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
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
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 bg-bg-2 border border-hairline rounded-[10px] px-3.5 py-2 min-w-[150px] cursor-pointer hover:border-hairline-2"
      >
        <Globe size={15} className="text-ink-3" />
        <div className="leading-tight">
          <b className="text-[13.5px] font-semibold">{cur.zhName}</b>
          <small className="block font-mono text-[9.5px] text-ink-3 tracking-[.1em] uppercase">
            {isSource ? (value === 'auto' ? (detectedName ? `DETECTED · ${detectedName}` : 'AUTO') : cur.enName) : 'TARGET'}
          </small>
        </div>
        <ChevronDown size={13} className="ml-1 text-ink-3" />
      </div>
      {open && (
        <div className="absolute top-full mt-1.5 left-0 w-[260px] max-h-[340px] bg-bg-2 border border-hairline-2 rounded-[10px] shadow-[var(--shadow-1)] z-20 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-hairline">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索语言…"
              className="w-full bg-bg-3 border border-hairline rounded-lg px-2.5 py-1.5 text-xs text-ink-1 outline-none focus:border-accent-line"
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
              <div className="px-3 py-4 text-xs text-ink-3">无匹配语言</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, sub, selected, onClick }: { label: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-[13px] ${
        selected ? 'bg-bg-3 text-accent' : 'text-ink-1 hover:bg-bg-3'
      }`}
    >
      <span className="flex-1">{label}</span>
      <span className="font-mono text-[9.5px] text-ink-3 tracking-wider uppercase">{sub}</span>
      {selected && <Check size={13} className="text-accent" />}
    </div>
  )
}
