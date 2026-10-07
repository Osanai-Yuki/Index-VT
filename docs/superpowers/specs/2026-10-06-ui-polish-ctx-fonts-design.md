# 界面微调五项（历史缩略 / 窄窗布局 / ctx 自定义 / 模式详情 / Archivo 字体）设计

| | |
|---|---|
| **日期** | 2026-10-06 |
| **状态** | 已实施完毕并入库（2026-10-06 执行，2026-10-07 随 Track B/C 并入 `master`，tip `412f0a5`）。执行记录与逐任务证据见 `docs/superpowers/plans/2026-10-06-ui-polish-ctx-fonts.md`。原列的"唯一未做项 = 重建 exe"**已完成**：2026-10-07 18:11 `node scripts/build.mjs` 重建，exe = 20,568,576 B，自检为"整份 JS bundle 与整份 CSS 逐字节嵌于 exe"（另附中文串自检的正确方法，见该计划 Task 8 Step 2 末两条） |
| **上游** | 用户提供的两张截图 + 四项功能请求；本文含对截图症状的实测订正 |
| **影响面** | 前端 6 个文件 + Go 3 个文件 + 门禁/文档若干；无破坏性接口变更 |

---

## 0. 实测订正（先纠正两个此前判断）

1. **"历史缩略已修"不成立。** `MainTranslate.tsx:326-327` 的 span 是
   `block text-body text-ink1 line-clamp-1` —— `display:block` 与 `line-clamp-1`
   自带的 `display:-webkit-box` 冲突且前者胜出，实测 computed `display: block`、
   `-webkit-line-clamp: 1` 形同虚设，条目高 102–154px（1180 宽实测）。这是真 bug，本 spec 修。
   （对照：`SubtitleWorkbench.tsx:260-261` 的 `line-clamp-2` 没带 `block`，是好的。）
2. **截图里的顶栏换行发生在 <1180 宽。** 1180 宽实测：顶栏高 66px、子项宽总和 937px +
   间距 80px = 1017px < 可用 1060px，**不换行、不收缩**（每个子项 `width == scrollWidth`）。
   也就是说截图来自更窄的视口（浏览器 dev 或旧构建窗口）。顶栏加固仍要做——它便宜，
   且开发态天天在窄视口里看页面；但"1180 就错位"的说法要在文档里写准。

3. **锚点核验（2026-10-06 逐项查过，写计划时可直接引用）**：`ModelHub.tsx:101-131` 是顶栏块的
   起止；`Badge` 接受 `title`、`tone="accent"` 渲染为 `bg-accent text-inkInverse`；
   `IconButton` 的 `label` 是必填 prop；`NumberField` 支持 `min/max/step`；
   Tailwind v4 自带 `--breakpoint-*` 命名空间（自定义 `wide:` 变体可行）；
   `app/translate_ctx_test.go` 存在（新测试命名可对齐）、`config` 包确无测试文件。
4. **字体已实测获取**：CDN 不通但 `raw.githubusercontent.com` 通；Archivo 变量字体 643KB、
   Noto Sans SC 变量字体 16.9MB（子集化后 18.3KB / 1.72MB）；brotli 1.2.0 已装到
   `C:/Users/Hanari/AppData/Local/Temp/fontwork/pylibs`（非全局），woff2 产出能力具备。

---

## 1. 目标与范围

做五件事，每件都能独立验证：

| # | 需求 | 交付判据 |
|---|---|---|
| A | 历史条目真缩略 | 条目高回到 ~75px 档；`line-clamp` 生效有 lint 兜底 |
| B | 窄窗不错的顶栏与卡片 | 顶栏在 1036 宽仍单行不折字；模型卡按 §6.2 的两档栅格 |
| C | ctx 自定义档位 + 显存警告 | 2K–64K/1K 步进可存可跑；超可用显存时红字 + 二次确认 |
| D | 约束模板详情 | 内置与自定义模板都能只读查看全部约束字段 |
| E | 界面字体（Archivo + Noto Sans SC 常用子集） | 两份 woff2 已落库（18.3KB + 1.72MB）；栈与 `@font-face` 接好；门禁断言两份都被加载 |

**不在范围**：DESIGN §6.2 其余断点（翻译台侧栏宽度、cue 详情栏、main 限宽）、
`motion-plan.json` 与 PRD 的重生成、cue 编辑（M4）、陈列页出包（P4）、
`docpipeline.CtxTier` 这个 M5 空壳（它有自己的枚举，等 M5 实装再对齐）。

---

## 2. 逐项设计

### A. 历史缩略

- **修法**：`MainTranslate.tsx:326-327` 去掉 `block`（`line-clamp-1` 自带
  `display:-webkit-box`，同级子元素照常纵向堆叠），并给两个 span 加 `title={全文}`。
- **保持 1 行**：侧栏 236px，正文行每行约 28–32 拉丁字符；两行会让条目从 ~75px 涨到
  ~110px、一屏可见条目少四成。点击条目本来就会把全文回填翻译台，侧栏职责是"找到那一条"。
  真机看着不爽再改 `line-clamp-2`，一行代码。
- **防复发（lint 新规则）**：`lint-design-tokens.mjs` 增加 `clamp-display-conflict` ——
  同一 `className` 里同时出现 `line-clamp-*` 与 `block`/`inline-block`/`flex`/`grid` 即报错
  （`line-clamp` 依赖 `display:-webkit-box`，被任何显式 display 覆盖都会静默失效）。
- DESIGN §10 禁止项表加一行说明该冲突。

**验证**：`verify:pages` 的 contrast/keyboard 不回归；新增断言留给人工——条目高度不设门禁
（脆），lint 规则本身是回归锁。

### B. 窄窗布局（顶栏 + 模型卡栅格）

**B1 顶栏**（`ModelHub.tsx:101-131`）：
- 容器 `flex items-center gap-4` → `flex flex-wrap items-center gap-x-4 gap-y-2`；
- VRAM 块 `w-80` → `min-w-0 flex-1 basis-64 max-w-80`（窄视口先让 VRAM 条缩短，而不是挤压别的项）；
- GPU 徽标：`title={全名}` + `max-w-72 truncate`（长 GPU 名不再撑宽整行）；
- `存储：.\models\（项目文件夹）` → `tone="neutral"`、文案 `存储：models/`、`title` 放全路径。
  依据：Swiss 下 `tone="accent"` 是**实底反色字**（实测 `rgb(212,0,0)` 底 + 白字），
  那是危险/强调语义的强度，不该给一个信息标签用；
- 按钮容器 `ml-auto flex gap-2 shrink-0`，`Button` 加 `whitespace-nowrap`
  （截图里的"打开模型文件/夹"换行就是缺这个）。

**B2 模型卡栅格**：`repeat(3,1fr)` → `grid-cols-2 wide:grid-cols-3`，在
`theme/tokens.css` 的 `@theme` 增加 `--breakpoint-wide: 1380px`（Tailwind v4 的
断点即 `@theme` 变量）。窗口最小 1180，所以两档覆盖全部实际宽度，
正好对齐 DESIGN §6.2 的"1180–1379 两列 / ≥1380 三列"；§6.2 那行从"未实现"改为"已落地"。
1180 实测每卡 343px，两列后 ~528px，卡片内 Segmented/进度条的呼吸感更好。

**验证**：`verify:pages:a11y/contrast` 含 1180 宽的组合，改完必须仍全绿；
新增一条 `verify:pages:keyboard` 之外的目视项写进人工清单（顶栏单行）。

### C. ctx 自定义档位（2K–64K，步进 1K）

**C1 Go 侧接口**
- `config.Inference` 增加 `CtxTokensOverride int`（json: `ctxTokensOverride`，0 = 跟随预设档）。
- `Normalize()`：override ≠ 0 时夹取到 `[2048, 65536]` 并四舍五入到 1024 的整数倍
  （UI 已限制输入，这里是持久化层的兜底）。
- 新增 `(c *Config) EffectiveCtxTokens() int64`：override > 0 时用它，否则回落 `CtxTier.Tokens()`。
- `App.CtxTokens()` 改用 `EffectiveCtxTokens()`（`orchestrator` 的 `-c` 参数链路不变）。

**C2 估算绑定**
- 新增 `App.EstimateCtxVRAM(tokens int64) (*CtxEstimate, error)`：
  ```go
  type CtxEstimate struct {
      Tokens                            int64  `json:"tokens"`
      WeightsMiB, KvMiB, ActivateMiB, TotalMiB int
      GPU                               envprobe.GPU `json:"gpu"`   // 复用 15s TTL 缓存
      ExceedsFree                       bool   `json:"exceedsFree"`
      Basis                             string `json:"basis"`  // 说明这是估算及其来源
  }
  ```
- 公式（**对 01 文档 §3.2 表校准的线性模型，标注 `[assumption]`**）：
  `TotalMiB = 权重实测 + tokens/8192 × 875MiB + 600MiB`（全 MiB，与 `nvidia-smi` 口径一致）。
  校准点：8K→2726MiB（文档表 ≈3GB）、32K→5351MiB（≈5GB）、64K→8851MiB。
  权重取当前 active 模型**已就位**档位的 `sizeBytes` 换算 MiB（Q4_K_M = 1312164352 B = 1251 MiB）；
  取不到时按 1251 MiB 兜底并在 `basis` 里说明。4GB 卡（可用约 3.1GiB）下：8K 不超、32K 起超限——
  这正是警告要覆盖的场景。
- 无 GPU（`!gpu.Present`）时 `ExceedsFree=false`，`basis` 说明"CPU 模式无显存可估"。
- **诚实标注**：±20% 偏差可能（并发 slot / flash-attn / 驱动缓存都不在模型里）；
  `freeMB` 是 15 秒 TTL 的快照。这些进 `basis` 文案。

**C3 前端（设置页「上下文档位」行）**
- Segmented 选项 `['8K','16K','32K','自定义']`；`value` 由 `ctxTokensOverride>0` 推导。
- 选中「自定义」→ 用 `NumberField`（原语自带 min/max/step）展开数字输入（K 为单位，min 2 max 64 step 1）+ 一行状态：
  - GPU 在：`预计占用 X.X GB / 当前可用 Y.Y GB`；
  - 超限：红字 `预计占用 X.X GB，超过可用显存 Y.Y GB`（用 `text-danger`，不放 `dangerSoft` 底）；
  - 无 GPU：`CPU 模式：无显存可估，ctx 越大越慢`。
  - 每次输入去抖 300ms 调 `EstimateCtxVRAM`。
- **保存流**：输入失焦 → 超限则先弹 `Modal`（title「显存可能不足」，正文列估算与可用值，
  footer 取消/`仍要使用`(danger)，两钮都带 `data-modal-initial`，初始焦点在取消）→ 确认后才 `save`；
  未超限直接存。选回预设档时把 `CtxTokensOverride` 置 0。
- 文案必须写"预计"：这是估算不是测量。

**C4 连带文档**：`docs/02-执行细节说明.md` §3 与 DESIGN §4/§5.5 里"UI 仅暴露 8K/16K/32K"
的口径改为"预设三档 + 自定义 2K–64K"；README 的 UNVERIFIED 清单新增一条
**"64K 档真机未验证"**（见 §4）。

**验证**：Go 单测覆盖 `Normalize`（0/2048/65536/超界/非对齐）、`EffectiveCtxTokens`、
`EstimateCtxVRAM` 的无 GPU 分支与兜底权重分支；键盘门禁在设置页跑通（自定义输入 +
确认弹窗焦点行为）。

### D. 约束模板详情

- 新增 `components/ModeDetails.tsx`：只读 `Modal`，展示名称、描述、硬约束列表、
  软约束列表、文体域、JSON 保持开关。复用现有 `Modal`（`initialFocus="first"`，
  只读面板无破坏性操作）。
- 入口两处：
  1. 主翻译台模式下拉旁加 `Info` 图标按钮（`IconButton`，`label="查看当前模式详情"`）；
  2. 设置页「翻译模式」内置模板行加「查看」按钮（自定义行已有「编辑」，字段全覆盖，不重复加）。
- **验证**：键盘门禁可选加一条（打开详情 → Esc 归还焦点）；至少人工点一遍。

### E. 界面字体：Latin 用 Archivo、中文用 Noto Sans SC 常用子集

**状态：字体已获取并落库**（2026-10-06）。CDN 被策略拦，改走 `google/fonts` GitHub 原始文件（OFL），
本机用 fontTools 子集化 + 裁轴（brotli 已装到临时目录，woff2 可产出）。

**落库产物**（`frontend/src/assets/fonts/`）：

| 文件 | 体积 | 内容 |
|---|---|---|
| `archivo-latin-wght400-600.woff2` | **18.3 KB** | latin 子集（与 JetBrains Mono 同 unicode-range），变量轴裁到 wght 400–600、wdth 固定 100，234 字形 |
| `noto-sans-sc-cjk-wght400-600.woff2` | **1.72 MB** | GB2312 全集（7445）+ 假名 + CJK 标点/全角 + 源码里出现的全部字符，共 **7994 字形**；同样裁轴到 wght 400–600 |
| `OFL-Archivo.txt` / `OFL-NotoSansSC.txt` | 各 4.3 KB | 两份 OFL 1.1 许可证文本（随仓库分发） |

**栈**（`theme/tokens.css` 的 `--font-app`）：
`'Archivo', 'Helvetica Neue', Helvetica, Arial, 'Noto Sans SC', 'Microsoft YaHei UI', 'Source Han Sans CN', 'PingFang SC', system-ui, sans-serif`

**`@font-face`（`theme/base.css`）**，两段，各自限定 unicode-range 以免互相抢字：
- Archivo：`font-weight: 400 600`、`font-display: swap`、latin range（照抄 JetBrains Mono 那段）。
- Noto Sans SC：`font-weight: 400 600`、`font-display: swap`、range 限定为
  `U+2E80-303F, U+3040-30FF, U+31C0-33FF, U+4E00-9FFF`（CJK 与假名；拉丁字形已被子集剔除，
  即使被放到前面也不会渲染拉丁）。

**覆盖边界（如实记入 DESIGN §3.1 与 README 已知限制）**：
- 子集=GB2312 档，简体常用字与假名齐；**超出子集的字（生僻字、繁体、韩文）不在字库内**，
  浏览器按字形回退到系统 `Microsoft YaHei UI`，是逐字回退——同一段文本里可能出现字形混排。
  这是 1.72MB 对 17MB（Noto Sans SC 全量变量字体实测 16.9MB）的取舍结果。
- 若日后要覆盖繁体/韩文，重跑子集脚本扩大字符集即可（脚本流程记录在实施计划里），
  woff2 体积大致线性增长。

**体积账**：前端资源 +1.74MB，exe 从 ~18.7MB 到 ~20.5MB（+9%）。DESIGN §3.1 原来"不打包 CJK——
单字重 10MB+ 与便携布局冲突"的结论据此改写为"打包常用子集（1.72MB），全量不打包"。

**门禁口径**：`verify-theme #7` 断言两个 woff2 均被请求（200）+ 无站外字体请求 + `@font-face`
里不得出现 Inter。文件缺失即 FAIL——它们现在是仓库资产，缺了就是仓库坏了，不再是"等用户投喂"的状态。

**DESIGN 同步**：§3.1（打包策略与体积账）、§3.2（字体栈 + 逐字回退说明）、
§3.3（600 字重在 Archivo/Noto 下是真 600；仅当两级都回退到 Arial 时才等效 700）。

---

## 3. 验证计划

| 层 | 内容 |
|---|---|
| Go 单测 | `Normalize` 边界、`EffectiveCtxTokens`、`EstimateCtxVRAM`（无 GPU / 兜底权重 / 超限真值） |
| 组件门禁 | `npm run verify:all`（含新增 lint 规则）全绿 |
| 页面门禁 | `npm run verify:pages` 全绿；设置页键盘含自定义输入与确认弹窗路径 |
| 构建 | `npm run build` 干净；`verify:theme #7` 断言两份 woff2 被请求（200）、无站外字体、无 Inter 残留 |
| 人工 | ① 1180 与 1036 宽目视顶栏单行；② 历史条目缩略后高度；③ 64K 档真机跑一次（见 §4） |

## 4. 风险与未验证项

1. **64K 档真机未验证**：模型 GGUF 标称 262144 positions，64K 理论上在范围内，但
   `-c 65536` 的启动耗时、显存峰值与失败时的 orchestrator 退避从未实测。进 README
   UNVERIFIED 清单；首次使用超 32K 档位建议手工观察一次。
2. **估算偏差 ±20%**：模型是文档表的两点线性外推，不含并发 slot/flash-attn/驱动缓存差异。
   文案统一用"预计"，二次确认保留"仍要使用"出口。
3. **CJK 子集有覆盖边界**：GB2312 档之外的生僻字/繁体/韩文逐字回退系统雅黑，可能出现字形混排（口径与体积取舍见 E）。要覆盖繁体需重跑子集脚本扩字符集。
4. **exe 体积 +1.74MB**（≈+9%），换来中文不再依赖系统字体；若要回到"零内嵌 CJK"是删两个文件 + 两段 `@font-face` 的事。
4. **`freeMB` 15 秒快照滞后**：警告可能偏乐观，文案已注明是"当前可用"。

## 5. 文件清单

**改**：`frontend/src/pages/MainTranslate.tsx`（A + D 入口）、`frontend/src/pages/ModelHub.tsx`（B1）、
`frontend/src/pages/Settings.tsx`（C3 + D 入口）、`frontend/src/theme/tokens.css`（B2 断点 + E 栈）、
`frontend/src/theme/base.css`（E 字体面）、`frontend/scripts/lint-design-tokens.mjs`（A 新规则）、
`frontend/scripts/verify-theme.mjs`（E 断言口径）、`app/internal/config/config.go`（C1）、
`app/app.go`（C2 绑定）、`docs/03-GUI设计图/DESIGN.md`、`docs/02-执行细节说明.md`、`README.md`。

**新增**：`frontend/src/components/ModeDetails.tsx`（D）、
`app/internal/config/config_test.go`（新建，覆盖 `Normalize` 与 `EffectiveCtxTokens`；config 包目前无测试）、
`app/ctx_estimate_test.go`（`EstimateCtxVRAM` 挂在 `*App` 上，测试放 app 包，命名对齐既有的 `translate_ctx_test.go`）。

**已就位（E，无需计划步骤）**：`frontend/src/assets/fonts/` 下的
`archivo-latin-wght400-600.woff2`、`noto-sans-sc-cjk-wght400-600.woff2`、`OFL-Archivo.txt`、`OFL-NotoSansSC.txt`。

**不改**：`orchestrator` 的 `-c` 链路（沿用 `CtxTokens()`）、`docpipeline.CtxTier`（M5 再对齐）、
事件层、`verify:pages` 的靶子集合（新增页面断言不改变现有靶子）。
