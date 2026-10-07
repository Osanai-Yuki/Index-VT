# 配音模式前端入口（F-07）· 设计

| | |
|---|---|
| **日期** | 2026-10-07 |
| **状态** | 待实现（本文与实现同轮交付） |
| **上游** | `docs/01-设计方案文档.md` §6.2「配音模式开关」/ §4.2 Homura 模板 / §3 表格行「UI 回显实测音节数并支持重 roll」；`docs/04-交付与验收方案.md` ★F-07 |
| **影响面** | `frontend/src/pages/MainTranslate.tsx`、`frontend/src/lib/mockbackend.ts`；后端零改动 |
| **本文职责** | 入口位置、状态流、约束抽屉的口径提示。不重复 01 文档的模板与参数表 |

---

## 0. 后端现状（为什么这是纯前端工作）

`TranslateRequestUI` 早已有 `Dubbing bool` / `Syllables int`（`app.go:414-415`），绑定层把它们
映射进 `translator.ModeDubbing`，`ModelForMode` 已将配音路由到 Index-Homura-2B（ADR-004）；
`translate:done` 事件已携带 `targetSyllables` / `actualSyllables`（`app.go:531-532`，后者由
后端 `CountSyllables` 实算）；历史已记录 `Mode`。整个链路只有前端没有任何入口。

## 1. 入口与状态

- **位置**：主翻译台语言栏，「模式」下拉 + 详情按钮之后。沿用该栏既有 idiom：
  可见 caption + 控件（同「模式」的 select 写法）——`配音` caption + `Switch(srOnly)`。
- **音节数输入**：开启后展开 `音节` caption + 原生 number 输入（`num` 右对齐，与语言栏
  select 同款边框底色），aria-label「目标音节数」，min 1 / max 99 / step 1，**默认 7**
  （★F-07 用例值）。不做 Stepper——配音对齐场景就是敲一个数。
- **宽度预算**：语言栏在 1180 宽已有 ml-auto 分组；新增约 190px（关）/~300px（开）。
  页面门禁只跑 1180/1680，实际窄于 1180 的窗口允许折行（flex 无 nowrap 整栏约束，
  仅 ml-auto 分组自身 nowrap）。

## 2. 请求与结果流

- 请求：`apiTranslate({…, dubbing: true, syllables: N})`，配音关时不带这两键
  （`TranslateRequestUI` 的 omitempty 语义）。
- `EV.DONE` 处理器扩展读取 `targetSyllables` / `actualSyllables`，存
  `syl: {target, actual} | null`；发起翻译 / 取消 / 清空时重置。
- **回显**（§4.2「前端计算实测音节数」由后端 `CountSyllables` 承担，前端只回显——
  数值同源，避免两套音节规则）：
  - 输出头部胶囊 `Badge`：`目标 N / 实测 M`，配音模式且 phase=done 且 syl 非空时显示。
  - 「重新翻译」按钮在配音模式下改标「**重新生成**」（F-07 步骤原文）；Homura
    temperature=0.3 天然产出不同表述，重 roll 无需额外逻辑（§135：2B 音节控制为
    近似达标，重 roll 就是补偿手段）。

## 3. 模型徽标

语言栏右侧 orch 状态徽标前，配音开启时新增 accent 徽标 `配音 · Index-Homura-2B`
（§6.2「高亮 Homura 模型徽标」）。orch 状态徽标保持原样——唤醒状态与当前模型是两个
维度，合并会丢信息。

## 4. 约束抽屉的口径提示

Homura prompt（§4.2）只消费术语表与音节预算；硬/软约束、文体域、JSON 保序属于
Translate 模型的 prompt 路径。配音开启时抽屉顶部加一行 caption 提示三者不生效，
**字段保持可编辑**（值要留着，切回普通模式即恢复有效）。

## 5. mock 后端

`Translate` 处理器改为读取请求：`dubbing` 为真时 `translate:done` 事件附带
`targetSyllables: N, actualSyllables: N+1`（确定性偏差，页面门禁可断言「胶囊出现」）。
文本流走原有 demo 路径不变。

## 6. 非目标

- 不加 Rail 导航项、不加独立页面（配音是主翻译台的一种模式，不是独立工作台）。
- 不做音节不达标自动重试（§135 只要求回显 + 支持 roll）。
- 历史侧栏不加模式过滤/徽标（HistItem.mode 已存，展示属后续打磨）。
- 不动 StatusBar 的模型名映射。

## 7. 验证

- 门禁：`verify:all` + `verify:pages` + `go build/vet/test`（后端未动也全跑，防装配回归）。
- 手工（真机，★F-07）：开配音、音节 7、输入「我们今天去看电影吧」→ 模型徽标切换 →
  生成 → 回显「目标 7 / 实测 N」→ 重新生成产出不同表述；N 与 7 的偏差记入用例报告。
