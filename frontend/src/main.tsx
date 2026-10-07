import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import PrimitivesPage from './pages/_Primitives'
/* CSS 导入顺序（2026-10-06 Track C 收尾）：旧 styles/tokens.css 已随页面迁移完成删除，
   theme/tokens.css 是唯一 token 权威；base.css 承接文档级默认与动效。 */
import './theme/tokens.css'
import './theme/base.css'
import { applyFontSize, applyTheme, storedFontSize, storedTheme, watchSystemTheme } from './theme/theme'

/* 渲染前接线主题运行时。
   data-theme 已由 index.html 的内联脚本在首帧前设好（消除深色启动白闪），
   这里补齐字号档位，并订阅系统主题变化——仅在用户档位为 system 时跟随，
   显式选了 light/dark 的不被系统偏好覆盖。 */
applyFontSize(storedFontSize())
applyTheme(storedTheme())
watchSystemTheme(() => {
  if (storedTheme() === 'system') applyTheme('system')
})

/* dev-only 原语陈列页（Task 2.5）：/?primitives 查询参数判定，不进导航。
   2026-10-06 决定保留：它是原语速查工具，也是 a11y/contrast/keyboard/datatable 四道门禁
   在组件层的常设靶子（真实页面的门禁见 verify:pages 与 README「验证门禁」）。 */
const isPrimitivesDemo = new URLSearchParams(window.location.search).has('primitives')

async function boot() {
  const params = new URLSearchParams(window.location.search)
  /* dev-only 假后端：?mock 让真实页面带数据渲染，供页面级门禁使用。
     动态 import + DEV 守卫 → 生产包不含 mockbackend.ts */
  if (import.meta.env.DEV && params.has('mock')) {
    const { installMockBackend } = await import('./lib/mockbackend')
    installMockBackend()
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {isPrimitivesDemo ? <PrimitivesPage /> : <App />}
    </React.StrictMode>,
  )
}

void boot()
