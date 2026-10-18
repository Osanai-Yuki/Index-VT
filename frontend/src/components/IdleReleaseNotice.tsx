import { useEffect } from 'react'
import { noteUserActivity, useAppStore } from '../stores/appStore'
import { apiKeepAlive } from '../wailsapi'
import { Button } from './ui/index'
import { toast } from '../stores/toastStore'

export function IdleReleaseNotice() {
  const seconds = useAppStore(s => s.idleReleaseSeconds)
  const running = useAppStore(s => s.orchState === 'running')

  useEffect(() => {
    let lastSent = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    let canceled = false
    const send = () => {
      lastSent = Date.now()
      pending = undefined
      apiKeepAlive().catch(() => {
        if (!canceled) {
          // 服务端未确认时不声称已取消释放；轮询将恢复权威状态。
          useAppStore.getState().refreshStatus()
        }
      })
    }
    const activity = () => {
      const warning = useAppStore.getState().idleReleaseSeconds >= 0
      noteUserActivity()
      if (warning || Date.now() - lastSent >= 1000) {
        if (pending) clearTimeout(pending)
        send()
      } else if (!pending) {
        pending = setTimeout(send, 1000 - (Date.now() - lastSent))
      }
    }
    // 监听输入动作，不监听 scroll：流式译文的自动滚动不属于用户活动。
    const events = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'touchmove'] as const
    events.forEach(name => window.addEventListener(name, activity, { capture: true, passive: true }))
    return () => {
      canceled = true
      if (pending) clearTimeout(pending)
      events.forEach(name => window.removeEventListener(name, activity, true))
    }
  }, [])

  if (!running || seconds < 0) return null
  return (
    <aside className="fixed bottom-14 right-6 z-(--suj-z-toast) max-w-md bg-surface border border-lineStrong p-4 e-3" aria-label="模型空闲释放提示">
      <p className="text-body text-ink3" role="status">已连续 30 分钟无操作，将在 <span className={`num ${seconds <= 5 * 60 ? 'text-danger' : ''}`} aria-live="off">{seconds}</span> 秒后释放模型资源。</p>
      <p className="text-caption text-ink2 mt-1">移动鼠标、滚动或按键可继续保持加载。译文会保留，下次翻译会自动加载模型。</p>
      <Button className="mt-3" onClick={() => apiKeepAlive().then(noteUserActivity).catch(() => toast.push({ tone: 'error', message: '保持加载失败，请重试或查看引擎状态。' }))}>继续保持加载</Button>
    </aside>
  )
}
