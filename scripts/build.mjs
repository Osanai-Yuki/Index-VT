#!/usr/bin/env node
// ============================================================
// Index-VT 生产构建（Windows）
//
// 为什么需要这个脚本，而不是直接 `wails build`：
//   Go 侧用 //go:embed all:frontenddist 嵌入前端（app/main.go:29）。vite 的产物在
//   frontend/dist，而 Go 模块根是 app/ —— go:embed 不能跨 `..`，所以必须把
//   frontend/dist 复制进 app/frontenddist 才能被嵌入。
//   app/frontenddist 是构建产物（.gitignore 已排除），不会自行更新。
//
//   只跑 `wails build` 的后果：它会先构建前端、再编译 Go，但**不会**同步
//   app/frontenddist，于是 exe 里嵌的是上一次复制的旧前端 —— 源码是新的、
//   界面是旧的，且没有任何报错。2026-10-04 18:52 之后的所有构建都踩过这个坑。
//
// 用法：
//   node scripts/build.mjs            # 构建前端 → 同步 → 编译 exe
//   node scripts/build.mjs --skip-frontend   # 前端没改，只重新编译 exe
//
// 构建后自检（应输出非 0；命令按 Shell 选，PowerShell 没有 grep）：
//   Git Bash    : grep -ac suj-ink-1 app/build/bin/Index-VT.exe
//   PowerShell  : (Select-String -Path app/build/bin/Index-VT.exe -Pattern suj-ink-1 -SimpleMatch -Encoding utf8).Count
//   任意 Shell  : 见 README「构建」的 node 写法（数的是出现次数）
// ============================================================

import { spawnSync } from 'node:child_process'
import { rmSync, cpSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRONTEND = join(ROOT, 'frontend')
const APP = join(ROOT, 'app')
const DIST = join(FRONTEND, 'dist')
const EMBED = join(APP, 'frontenddist')
const skipFrontend = process.argv.includes('--skip-frontend')

// commandLine 为整条命令字符串（非 args 数组）：npm / wails 在 Windows 上是 .cmd
// shim，必须经 shell 解析；而 `shell:true` 配 args 数组会触发 Node 的 DEP0190
// （参数只拼接不转义）。此处命令串全部由本文件静态写死，不含外部输入。
function run(commandLine, cwd) {
  console.log(`\n$ ${commandLine}   (cwd: ${cwd})`)
  const r = spawnSync(commandLine, { cwd, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`\n失败：「${commandLine}」退出码 ${r.status ?? '(signal ' + r.signal + ')'}`)
    process.exit(r.status ?? 1)
  }
}

if (!skipFrontend) {
  console.log('[1/3] 构建前端（内部含 lint:design + tsc --noEmit + vite build）')
  run('npm run build', FRONTEND)
} else {
  console.log('[1/3] 跳过前端构建（--skip-frontend）')
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`\n失败：找不到 ${DIST}\\index.html —— 请先不带 --skip-frontend 跑一次。`)
  process.exit(1)
}

console.log('\n[2/3] 同步前端产物到 app/frontenddist（embed 源；先清空以移除旧哈希文件）')
rmSync(EMBED, { recursive: true, force: true })
cpSync(DIST, EMBED, { recursive: true })
console.log(`      ${DIST}  ->  ${EMBED}`)

console.log('\n[3/3] 编译 Go 应用（-s 跳过前端重复构建）')
run('wails build -s -clean -platform windows/amd64 -webview2 embed', APP)

console.log(`
============================================================
完成：app\\build\\bin\\Index-VT.exe

建议自检 exe 内确实嵌入了新前端（应输出非 0；PowerShell 无 grep，用下面任一条）：
  Git Bash   : grep -ac suj-ink-1 app/build/bin/Index-VT.exe
  PowerShell : (Select-String -Path app/build/bin/Index-VT.exe -Pattern suj-ink-1 -SimpleMatch -Encoding utf8).Count
============================================================`)
