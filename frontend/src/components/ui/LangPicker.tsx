// LangPicker —— DESIGN.md §5.6
// 触发器 = Button secondary 语义（32 高）：语言名 + --text-micro 大写英文码；
// 源语言且存在 detected 时，触发器副行显示 `DETECTED · <语言名>`
// （detected 由后端 translate:done 提供，Track C 接线；旧实现硬编码 '…' 从不更新）。
// 弹层 = Popover(280) + 搜索 Field + role="listbox" 虚拟列表（行高固定 32，overscan 6）。
// 键盘：Enter/Space 开、↑↓ 移动、Home/End 跳首尾、Enter 选、Esc 关、输入即过滤；
// 焦点在列表上时键入字母跳转到首个匹配（首字母跳转）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Clock3 } from 'lucide-react'
import { useVirtualRows } from '../../lib/virtualizer'
import { Field } from './Field'
import { Popover } from './Popover'

export interface Lang {
  code: string
  zhName: string
  enName: string
  script?: string
  core?: boolean
}

export interface LangPickerProps {
  langs: Lang[]
  value: string
  onChange: (code: string) => void
  isSource?: boolean
  /** 后端检测到的源语言 code（translate:done.detected） */
  detected?: string
  /** 最近使用的 code（调用方从本地存储取） */
  recent?: string[]
  label: string
}

const ROW_H = 32
const POP_WIDTH = 280

/** 无查询时的展示序：最近使用 → core → 其余（保持传入序） */
function orderedLangs(langs: Lang[], recent: string[]): Lang[] {
  const byCode = new Map(langs.map((l) => [l.code, l]))
  const out: Lang[] = []
  for (const code of recent) {
    const l = byCode.get(code)
    if (l) out.push(l)
  }
  for (const l of langs) if (l.core && !out.includes(l)) out.push(l)
  for (const l of langs) if (!out.includes(l)) out.push(l)
  return out
}

function matchLang(l: Lang, q: string): boolean {
  const query = q.toLowerCase()
  return l.zhName.includes(q) || l.enName.toLowerCase().includes(query) || l.code.toLowerCase().includes(query)
}

export function LangPicker({ langs, value, onChange, isSource = false, detected, recent = [], label }: LangPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const display = useMemo(
    () => (query.trim() ? langs.filter((l) => matchLang(l, query.trim())) : orderedLangs(langs, recent)),
    [langs, query, recent],
  )

  useEffect(() => {
    setActive(0)
  }, [query, display.length])

  useEffect(() => {
    if (open) searchRef.current?.focus()
  }, [open])

  const current = langs.find((l) => l.code === value)
  const detectedName = detected ? (langs.find((l) => l.code === detected)?.zhName ?? detected) : undefined

  const { range, padTop, padBottom, onScroll, containerRef } = useVirtualRows({
    count: display.length,
    rowHeight: ROW_H,
  })

  /* 活动项滚入可视区（虚拟列表上超出窗口才滚） */
  useEffect(() => {
    const el = containerRef.current
    if (!open || !el || display.length === 0) return
    const top = active * ROW_H
    if (top < el.scrollTop) el.scrollTo({ top })
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTo({ top: top + ROW_H - el.clientHeight })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, display.length])

  const select = (code: string) => {
    onChange(code)
    close()
  }

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (display.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(display.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(display.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const l = display[active]
      if (l) select(l.code)
    }
  }

  const recentSet = new Set(recent)

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        aria-label={`${label}：${current?.zhName ?? value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className="inline-flex min-h-(--suj-h-control) flex-col items-start justify-center gap-0.5 rounded-sm border border-line bg-surface px-3 py-1 text-left transition-colors duration-(--suj-dur-quick) ease-(--suj-ease-signature) hover:bg-sunken hover:border-lineStrong"
      >
        <span className="inline-flex items-center gap-1.5 text-body font-medium text-ink1">
          {current?.zhName ?? value}
          <span className="num text-micro text-ink3 uppercase">{current?.code ?? ''}</span>
          <ChevronDown size={14} className="text-ink3" aria-hidden="true" />
        </span>
        {isSource && detectedName && (
          <span className="num text-micro text-ink3 uppercase">Detected · {detectedName}</span>
        )}
      </button>

      <Popover open={open} onClose={close} anchorRef={anchorRef} width={POP_WIDTH} measureKey={display.length}>
        <div className="px-1 pb-1 pt-0.5">
          <Field
            ref={searchRef}
            /* Field 是受控 input；此处透传 size sm 让搜索框紧凑（28 高） */
            label={label}
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="输入以过滤"
          />
        </div>
        <div
          ref={containerRef}
          onScroll={onScroll}
          role="listbox"
          aria-label={`${label}候选`}
          aria-activedescendant={display[active] ? `lang-opt-${display[active].code}` : undefined}
          tabIndex={-1}
          className="max-h-80 overflow-y-auto"
          onKeyDown={(e) => {
            /* 焦点在列表（而非搜索框）时：字母跳转 + 方向键 */
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
              const idx = display.findIndex((l) => l.enName.toLowerCase().startsWith(e.key.toLowerCase()))
              if (idx >= 0) {
                e.preventDefault()
                setActive(idx)
                searchRef.current?.focus()
              }
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) =>
                e.key === 'ArrowDown'
                  ? Math.min(display.length - 1, a + 1)
                  : Math.max(0, a - 1),
              )
            } else if (e.key === 'Enter' && display[active]) {
              e.preventDefault()
              select(display[active].code)
            }
          }}
        >
          <div style={{ paddingTop: padTop, paddingBottom: padBottom }}>
            {display.slice(range.start, range.end).map((l, i) => {
              const idx = range.start + i
              const selected = l.code === value
              return (
                <button
                  key={l.code}
                  id={`lang-opt-${l.code}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => select(l.code)}
                  onMouseEnter={() => setActive(idx)}
                  className={`flex h-(--suj-h-row) w-full items-center gap-2 rounded-sm px-2 text-left ${
                    idx === active ? 'bg-sunken' : ''
                  }`}
                >
                  {recentSet.has(l.code) ? (
                    <Clock3 size={14} className="shrink-0 text-ink3" aria-hidden="true" />
                  ) : (
                    <span className="size-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-body text-ink1">{l.zhName}</span>
                  <span className="num shrink-0 text-micro text-ink3 uppercase">{l.code}</span>
                  {selected && <Check size={14} className="shrink-0 text-accent" aria-hidden="true" />}
                </button>
              )
            })}
            {display.length === 0 && (
              <p className="px-2 py-4 text-center text-caption text-ink3">无匹配语言</p>
            )}
          </div>
        </div>
      </Popover>
    </>
  )
}
