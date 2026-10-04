// 固定行高窗口化虚拟滚动（计划 Task 2.4，约 40 行核心）
// ------------------------------------------------------------
// **只支持固定行高**（cue 表 32px / 历史列表 40px，DESIGN.md §5.7）。
// 变高行不支持——没有测量机制，行高不一致时区间会错位。不要假装支持。
//
// 撑高方式：返回上下 padding（px），调用方用 paddingTop/paddingBottom 撑出
// 滚动总高，**不渲染占位行**（5000 行场景下 DOM 恒为 视口行数 + 2×overscan）。
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export interface VirtualRange {
  start: number
  end: number
}
export interface VirtualWindow {
  range: VirtualRange
  padTop: number
  padBottom: number
}

/** 纯函数核：给定行数/行高/滚动状态，算可视区间（含上下 overscan 缓冲）与撑高。
    独立导出以便 verify-lib 在无 React 的环境下直接断言边界。 */
export function computeWindow(
  count: number,
  rowHeight: number,
  scrollTop: number,
  clientHeight: number,
  overscan = 6,
): VirtualWindow {
  if (count <= 0 || rowHeight <= 0) return { range: { start: 0, end: 0 }, padTop: 0, padBottom: 0 }
  const viewportRows = Math.max(1, Math.ceil(clientHeight / rowHeight))
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const start = Math.min(count, Math.max(0, firstVisible - overscan))
  const end = Math.min(count, firstVisible + viewportRows + overscan)
  return {
    range: { start, end },
    padTop: start * rowHeight,
    padBottom: Math.max(0, (count - end) * rowHeight),
  }
}

export interface VirtualRowsOptions {
  count: number
  rowHeight: number
  overscan?: number
}

/** React 薄封装：容器挂 ref、监听 scroll，返回区间与上下撑高。
    初始 clientHeight 在 layout effect 里测量（否则首帧区间为空）。 */
export function useVirtualRows({ count, rowHeight, overscan = 6 }: VirtualRowsOptions): {
  range: VirtualRange
  padTop: number
  padBottom: number
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void
  containerRef: React.RefObject<HTMLDivElement | null>
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [clientHeight, setClientHeight] = useState(0)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (el) {
      setClientHeight(el.clientHeight)
      setScrollTop(el.scrollTop)
    }
  }, [count, rowHeight])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    setClientHeight(el.clientHeight)
  }, [])

  return { ...computeWindow(count, rowHeight, scrollTop, clientHeight, overscan), onScroll, containerRef }
}
