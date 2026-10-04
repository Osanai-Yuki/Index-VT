/**
 * 素笺 (Blank Sheet) — 主题运行时
 * ------------------------------------------------------------
 * 三档主题（light / dark / system）+ 三档正文字号（small / standard / large）。
 *
 * 契约（Task 2.1 Produces，后续 Task 与 Track C 直接消费）：
 *   type ThemeMode / type FontSize
 *   applyTheme(mode) / applyFontSize(size)
 *   watchSystemTheme(cb) -> 取消订阅函数
 *   storedTheme() / storedFontSize()
 *
 * 主题由 <html data-theme="light|dark"> 驱动，token 定义在 src/theme/tokens.css
 * 的 `:root, [data-theme="light"]` 与 `[data-theme="dark"]` 两块里——深色不是
 * 第二套设计，只是同一批语义名换了值。
 *
 * 首帧白闪由 index.html 的内联脚本消除（CSS 是 JS 注入的，晚于首帧）；
 * 本模块负责其后的所有运行时切换，并清掉那段内联兜底色。
 */

/** 三档主题：跟随系统时用 matchMedia 实时解析 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** 三档正文字号：只缩放阅读/正文/说明三级，**不动** --text-micro */
export type FontSize = 'small' | 'standard' | 'large'

/**
 * localStorage key。index.html 的内联首屏脚本无法 import 本模块，
 * 因此那个 key 是逐字复制的——改动此处必须同步改 index.html。
 */
export const THEME_STORAGE_KEY = 'indexvt.theme'
export const FONT_SIZE_STORAGE_KEY = 'indexvt.fontSize'

const SYSTEM_QUERY = '(prefers-color-scheme: dark)'

/** DESIGN.md §3.3 的字面值。applyFontSize 以它为基准乘系数。
 *  token 名带 --suj- 前缀：与旧 styles/tokens.css 的原始变量零重名（共存规则，
 *  见 tokens.css 文件头与 DESIGN.md §9）。tokens.css 的 @theme 里
 *  --text-read/body/caption 引用这三个 --suj-text-*，故内联覆盖能穿透到 utility。 */
const SCALABLE_TEXT_TOKENS = [
  { token: '--suj-text-read', base: 15.5 },
  { token: '--suj-text-body', base: 13.5 },
  { token: '--suj-text-caption', base: 12 },
] as const

/**
 * 缩放系数。
 * --text-micro（11px，刻度标签/表头/指标）**刻意不在** SCALABLE_TEXT_TOKENS 内：
 * 表头与表格列宽一旦随字号变化，cue 表在用户改字号时会整列重排、滚动位置错乱。
 */
const FONT_SIZE_SCALE: Record<FontSize, number> = {
  small: 0.92,
  standard: 1,
  large: 1.1,
}

/** WebView2 的 localStorage 在极端情况下（隐私模式/存储被禁）会抛异常，一律吞掉 */
function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* 存不下就只用内存态，不影响本次会话的主题生效 */
  }
}

/** 系统是否偏好深色 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(SYSTEM_QUERY).matches
}

/** 把三档模式解析成实际要写进 data-theme 的两值 */
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

/** 读取已存的主题档位；无值或值非法时回落 'system'（DESIGN.md：默认跟随系统） */
export function storedTheme(): ThemeMode {
  const raw = readStore(THEME_STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** 读取已存的字号档位；无值或值非法时回落 'standard' */
export function storedFontSize(): FontSize {
  const raw = readStore(FONT_SIZE_STORAGE_KEY)
  return raw === 'small' || raw === 'standard' || raw === 'large' ? raw : 'standard'
}

/**
 * 应用主题：持久化档位 + 写 <html data-theme>。
 * 传 'system' 时按当前系统偏好解析；系统偏好变化由 watchSystemTheme 负责回调。
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  writeStore(THEME_STORAGE_KEY, mode)

  const root = document.documentElement
  root.setAttribute('data-theme', resolveTheme(mode))

  /* index.html 的内联脚本在 CSS 加载前给 <html> 写过一次兜底底色；
     样式表接管后必须清掉，否则之后切主题会残留首帧那一版底色。 */
  root.style.removeProperty('background-color')
}

/**
 * 应用正文字号：只在 <html> 上写内联 --suj-text-read / --suj-text-body / --suj-text-caption。
 * 内联自定义属性优先于样式表 :root 的同名声明，因此能覆盖 tokens.css 里这三个原始变量的
 * 字面值；@theme 的 --text-read/body/caption 又引用它们，于是 text-* utility 一起跟随。
 * 'standard' 档直接移除内联覆盖，交回 tokens.css 作为唯一权威来源。
 */
export function applyFontSize(size: FontSize): void {
  if (typeof document === 'undefined') return
  writeStore(FONT_SIZE_STORAGE_KEY, size)

  const root = document.documentElement
  const scale = FONT_SIZE_SCALE[size] ?? 1

  for (const { token, base } of SCALABLE_TEXT_TOKENS) {
    if (scale === 1) {
      root.style.removeProperty(token)
      continue
    }
    /* 三位小数足够：13.5 × 1.1 = 14.85，避免浮点尾巴写进 CSS */
    root.style.setProperty(token, `${Math.round(base * scale * 1000) / 1000}px`)
  }
}

/**
 * 监听系统主题变化。返回取消订阅函数（调用方需自己判断当前是否为 'system' 档，
 * 用户显式选了 light/dark 时不应被系统偏好覆盖）。
 */
export function watchSystemTheme(cb: (prefersDark: boolean) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mql = window.matchMedia(SYSTEM_QUERY)
  const onChange = (event: MediaQueryListEvent): void => cb(event.matches)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
