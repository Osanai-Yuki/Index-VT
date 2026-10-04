import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
/* CSS 导入顺序 = 层叠顺序，**不可调换**：
   旧 styles/tokens.css 在前（现存 6 个页面有 203 处旧 utility 依赖它，Track C 才整体删除），
   新 theme/* 在后。新层原始变量一律加 --suj- 前缀（--suj-ink-1 / --suj-accent / --suj-danger …），
   与旧的 --ink-1 / --accent / --danger / --warn **零重名** → 两条链各自独立解析，旧页面不再被
   素笺浅色墨色覆盖（Fix round 1 修复的 1.11:1 不可读缺陷；共存规则见 DESIGN.md §9）。
   唯一残留的同名原始变量是 --font-mono（font-mono utility 的 @theme 键，不能加前缀），
   靠 theme/tokens.css 末尾的**非分层重申**让新层取胜——不能只靠导入顺序兜底（见该处注释）。
   R29 已删掉旧文件 @theme inline 里的六行自引用条目。 */
import './styles/tokens.css'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
