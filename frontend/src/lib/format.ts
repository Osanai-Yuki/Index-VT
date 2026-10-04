// 格式化纯函数（计划 Task 2.4）——无副作用、无 Date 依赖、负输入一律钳到 0。
// 负时间戳约定与后端一致：LRC 生成侧已把负值钳为 0（Track A 核实），前端同规则。
// 数字展示一律走 .num（mono + tabular-nums），由调用方加类名，本文件只出字符串。

const p2 = (n: number): string => String(n).padStart(2, '0')

/** SRT 时间码：`HH:MM:SS,mmm`。tcSrt(-1) === '00:00:00,000'。 */
export function tcSrt(ms: number): string {
  const t = Math.max(0, Math.floor(ms))
  const h = Math.floor(t / 3_600_000)
  const m = Math.floor((t % 3_600_000) / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const mmm = t % 1000
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(mmm).padStart(3, '0')}`
}

/** LRC 时间码（含方括号）：`[MM:SS.xx]`，厘秒两位。 */
export function tcLrc(ms: number): string {
  const t = Math.max(0, Math.floor(ms))
  const m = Math.floor(t / 60_000)
  const s = Math.floor((t % 60_000) / 1000)
  const cs = Math.floor((t % 1000) / 10)
  return `[${p2(m)}:${p2(s)}.${p2(cs)}]`
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 字节数，1024 进制保留 1 位小数（B 档取整）。 */
export function fmtBytes(n: number): string {
  const v = Math.max(0, Number.isFinite(n) ? n : 0)
  let unit = 0
  let x = v
  while (x >= 1024 && unit < BYTE_UNITS.length - 1) {
    x /= 1024
    unit++
  }
  return unit === 0 ? `${Math.round(x)} B` : `${x.toFixed(1)} ${BYTE_UNITS[unit]}`
}

/** 速率：`1.5 MB/s`。 */
export function fmtRate(bytesPerSec: number): string {
  return `${fmtBytes(bytesPerSec)}/s`
}

/** 百分比整数文本。fmtPct(0,0) === '0%'（不得 NaN）。 */
export function fmtPct(done: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0%'
  return `${clampPct(Math.round((100 * Math.max(0, done)) / total))}%`
}

/** 倒计时 `M:SS`（分钟不封顶：3600 → '60:00'）。 */
export function fmtCountdown(sec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${p2(s)}`
}

/** 百分比数值钳制到 [0, 100]；非有限值归 0。 */
export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}
