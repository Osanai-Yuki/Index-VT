// DataTable —— DESIGN.md §5.7（cue 表 / 历史 / 术语）
// ------------------------------------------------------------
// 结构：role="grid"（ARIA grid 模式，键盘 ↑↓ 移动行）+ div/grid 布局 + 虚拟化。
// - sticky 表头 28px（text-micro + text-ink3 + uppercase + tracking-caps），底线 1px --line-strong
// - 行 32/40（--suj-h-row / --suj-h-row-lg），底线 1px --line，hover → bg-sunken
// - 选中 = 左缘 2px --accent（inset box-shadow）+ bg-accentSoft
// - 行数 > 200 自动开虚拟滚动（virtual prop 可强制）；padding 撑高，不渲染占位行
// - 批量选择：首列 16px 原生 checkbox（role=checkbox + indeterminate），Shift 连选，表头全选
// - 键盘（容器聚焦，aria-activedescendant 指向活动行）：↑↓ 移动、Home/End 跳首尾、
//   Space 勾选活动行、Enter 触发 onRowClick
// - 行内操作按钮的 hover/focus 显现由调用方做（opacity 方案，禁止 display:none），
//   参见陈列页 sec-datatable-actions 的 group-hover/focus-within 用法。
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useVirtualRows } from '../../lib/virtualizer'

export interface Column<T> {
  key: string
  header: string
  /** 固定列宽用 px 字符串（如 '132px'），弹性列用 '1fr' */
  width?: string
  align?: 'left' | 'right'
  /** numeric → .num（mono + tabular-nums）+ 右对齐 */
  numeric?: boolean
  render: (row: T, i: number) => ReactNode
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (r: T, i: number) => string | number
  rowHeight?: 32 | 40 | 56
  /** 默认 rows.length > 200 自动开 */
  virtual?: boolean
  selectable?: boolean
  selected?: Set<string | number>
  onSelectedChange?: (s: Set<string | number>) => void
  onRowClick?: (row: T) => void
  /** 行右键菜单（M4）：与 onRowClick 同语义，键盘可达由容器承担 */
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void
  selectedRowKey?: string | number
  emptyState?: ReactNode
  'aria-label': string
}

const OVERSCAN = 6

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHeight = 32,
  virtual,
  selectable = false,
  selected,
  onSelectedChange,
  onRowClick,
  onRowContextMenu,
  selectedRowKey,
  emptyState,
  'aria-label': ariaLabel,
}: DataTableProps<T>) {
  const gridId = useId()
  const useVirtual = virtual ?? rows.length > 200
  const { range, padTop, padBottom, onScroll, containerRef } = useVirtualRows({
    count: useVirtual ? rows.length : 0,
    rowHeight,
    overscan: OVERSCAN,
  })
  const [activeIdx, setActiveIdx] = useState(0)
  const lastShiftIdx = useRef<number | null>(null)
  const headerCheckRef = useRef<HTMLInputElement>(null)

  /* selectedRowKey 变化 → 活动行跟随（Track C 的"右侧详情随选中行"场景） */
  useEffect(() => {
    if (selectedRowKey === undefined) return
    const idx = rows.findIndex((r, i) => rowKey(r, i) === selectedRowKey)
    if (idx >= 0) setActiveIdx(idx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRowKey, rows])

  /* 活动行滚入可视区（虚拟窗口外才滚） */
  useEffect(() => {
    const el = containerRef.current
    if (!el || rows.length === 0) return
    const top = activeIdx * rowHeight
    if (top < el.scrollTop) el.scrollTo({ top })
    else if (top + rowHeight > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: top + rowHeight - el.clientHeight })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, rows.length, rowHeight])

  /* 表头全选 checkbox 的 indeterminate */
  const allSelected = selectable && rows.length > 0 && !!selected && rows.every((r, i) => selected.has(rowKey(r, i)))
  const someSelected = selectable && !!selected && rows.some((r, i) => selected.has(rowKey(r, i))) && !allSelected
  useEffect(() => {
    if (headerCheckRef.current) headerCheckRef.current.indeterminate = someSelected
  }, [someSelected])

  const toggleRow = (idx: number, shift: boolean) => {
    if (!selectable || !onSelectedChange || !selected) return
    const key = rowKey(rows[idx], idx)
    const next = new Set(selected)
    if (shift && lastShiftIdx.current !== null) {
      const a = Math.min(lastShiftIdx.current, idx)
      const b = Math.max(lastShiftIdx.current, idx)
      const targetState = !selected.has(key)
      for (let i = a; i <= b; i++) {
        const k = rowKey(rows[i], i)
        if (targetState) next.add(k)
        else next.delete(k)
      }
    } else if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    lastShiftIdx.current = idx
    onSelectedChange(next)
  }

  const toggleAll = () => {
    if (!selectable || !onSelectedChange) return
    const next = new Set(selected ?? [])
    if (allSelected) {
      rows.forEach((r, i) => next.delete(rowKey(r, i)))
    } else {
      rows.forEach((r, i) => next.add(rowKey(r, i)))
    }
    onSelectedChange(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return
    const move = (to: number) => {
      e.preventDefault()
      setActiveIdx(Math.min(rows.length - 1, Math.max(0, to)))
    }
    if (e.key === 'ArrowDown') move(activeIdx + 1)
    else if (e.key === 'ArrowUp') move(activeIdx - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(rows.length - 1)
    else if (e.key === ' ' && selectable && selected && onSelectedChange) {
      e.preventDefault()
      toggleRow(activeIdx, false)
    } else if (e.key === 'Enter' && onRowClick) {
      e.preventDefault()
      onRowClick(rows[activeIdx])
    }
  }

  const template = columns.map((c) => c.width ?? '1fr').join(' ')
  const rowCls = (isSelected: boolean, isActive: boolean) =>
    `relative flex w-full items-center border-b border-line ${
      isSelected ? 'bg-accentSoft' : isActive ? 'bg-sunken' : 'hover:bg-sunken'
    }`

  const empty = rows.length === 0

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="grid"
      aria-label={ariaLabel}
      aria-rowcount={rows.length + 1}
      aria-activedescendant={empty ? undefined : `${gridId}-row-${activeIdx}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="max-h-full w-full overflow-y-auto overscroll-contain"
    >
      {/* 表头：sticky 28px（§5.7） */}
      <div role="rowgroup" className="sticky top-0 z-10">
        <div
          role="row"
          aria-rowindex={1}
          className="flex w-full items-center border-b border-lineStrong bg-surface"
          style={{ display: 'grid', gridTemplateColumns: selectable ? `32px ${template}` : template, height: 28 }}
        >
          {selectable && (
            <div role="columnheader" aria-label="全选" className="flex h-full items-center justify-center">
              <input
                ref={headerCheckRef}
                type="checkbox"
                aria-label="全选"
                checked={allSelected}
                onChange={toggleAll}
                className="size-4 accent-(--suj-accent)"
              />
            </div>
          )}
          {columns.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              aria-sort="none"
              className={`flex h-full items-center overflow-hidden px-3 text-micro font-medium uppercase tracking-caps text-ink3 ${
                c.align === 'right' || c.numeric ? 'justify-end' : 'justify-start'
              }`}
            >
              {c.header}
            </div>
          ))}
        </div>
      </div>

      {/* 表体：虚拟化用 padding 撑高，不渲染占位行（§5.7）。
          空态也要走合法的 rowgroup/row/gridcell 链——grid 的 owned 元素
          不允许出现无角色 div（axe aria-required-children critical）。 */}
      {empty ? (
        <div role="rowgroup" className="p-4">
          <div role="row">
            <div role="gridcell" aria-colspan={selectable ? columns.length + 1 : columns.length} className="w-full">
              {emptyState}
            </div>
          </div>
        </div>
      ) : (
        <div role="rowgroup" style={{ paddingTop: padTop, paddingBottom: padBottom }}>
          {(useVirtual ? rows.slice(range.start, range.end) : rows).map((row, i) => {
            const idx = useVirtual ? range.start + i : i
            const key = rowKey(row, idx)
            const isSelected = selectable && !!selected?.has(key)
            const isActive = idx === activeIdx
            /* 行点击以 props 对象注入（而非 JSX 标签内字面 onClick）：
               该 <div role="row"> 在 ARIA grid 内，键盘可达性由容器统一承担
               （↑↓ 移动 + Enter 触发 onRowClick），div-click 规则在此按场景豁免。 */
            const rowClickProps = onRowClick
              ? // lint-allow: div-click —— ARIA grid 行 div；键盘可达由容器 Enter/↑↓ 承担（§5.7）
                { onClick: () => onRowClick(row) }
              : {}
            const rowContextProps = onRowContextMenu
              ? // lint-allow: div-contextmenu —— ARIA grid 行 div；右键菜单由容器键盘操作承担
                { onContextMenu: (e: React.MouseEvent) => onRowContextMenu(e, row) }
              : {}
            return (
              <div
                key={key}
                id={`${gridId}-row-${idx}`}
                role="row"
                aria-rowindex={idx + 2}
                aria-selected={selectable ? isSelected : undefined}
                {...rowClickProps}
                {...rowContextProps}
                className={`${rowCls(isSelected, isActive)} ${onRowClick ? 'cursor-pointer' : ''}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: selectable ? `32px ${template}` : template,
                  height: rowHeight,
                  boxShadow: isSelected ? 'inset 2px 0 0 var(--suj-accent)' : undefined,
                }}
              >
                {selectable && (
                  <div role="gridcell" className="flex h-full items-center justify-center">
                    <input
                      type="checkbox"
                      aria-label={`选择第 ${idx + 1} 行`}
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRow(idx, false)}
                      className="size-4 accent-(--suj-accent)"
                    />
                  </div>
                )}
                {columns.map((c) => (
                  <div
                    key={c.key}
                    role="gridcell"
                    className={`flex h-full min-w-0 items-center overflow-hidden px-3 text-body text-ink1 ${
                      c.align === 'right' || c.numeric ? 'justify-end' : 'justify-start'
                    } ${c.numeric ? 'num text-caption' : ''}`}
                  >
                    {c.render(row, idx)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
