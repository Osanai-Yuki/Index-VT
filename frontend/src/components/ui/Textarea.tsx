// Textarea —— DESIGN.md §5.5
// --surface 底 + 1px --line（border 常驻占位）；focus → 1px --accent；
// read=true → --text-read（15.5/1.9）+ max-width 72ch 居中（§3.5：大面积留白靠限宽产生）。
import { useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
  /** 阅读态：--text-read 15.5/1.9 + 72ch 限宽居中（翻译台读写区用） */
  read?: boolean
}

export function Textarea({ label, error, read = false, className, id, ...rest }: TextareaProps) {
  const autoId = useId()
  const areaId = id ?? autoId
  const errId = error ? `${areaId}-err` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={areaId} className="text-caption font-medium text-ink2">
        {label}
      </label>
      <textarea
        id={areaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={errId}
        className={`block w-full rounded-sm border bg-surface px-3 py-2 text-body text-ink1 placeholder:text-ink3 focus-visible:border-accent ${
          read ? 'mx-auto max-w-(--suj-measure-read) text-read' : ''
        } ${error ? 'border-danger' : 'border-line'} ${className ?? ''}`}
        {...rest}
      />
      {error && (
        <span id={errId} className="inline-flex items-center gap-1 text-caption text-danger" role="alert">
          <CircleAlert size={12} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  )
}
