// Skeleton —— DESIGN.md §5.11
// --sunken 底 + 目标同圆角；shimmer 用 opacity（.skeleton 类，base.css 定义），
// **不用位移**。只允许出现在任务区，**禁止整页遮罩**。
// rows 给定时渲染 N 条 12px 高的行骨架（模拟多行文本加载），否则渲染单块（尺寸随 className）。
export interface SkeletonProps {
  className?: string
  rows?: number
}

export function Skeleton({ className, rows }: SkeletonProps) {
  if (rows === undefined) {
    return <div aria-hidden="true" className={`skeleton rounded-sm bg-sunken ${className ?? 'h-4 w-full'}`} />
  }
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className ?? ''}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-3 rounded-sm bg-sunken" style={{ width: `${100 - (i % 4) * 12}%` }} />
      ))}
    </div>
  )
}
