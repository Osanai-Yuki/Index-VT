# M4 字幕编辑与样式 · 设计

| | |
|---|---|
| **日期** | 2026-10-07 |
| **状态** | 已实施（2026-10-08），待真机验证（F-17/F-18）。落地口径与本文的偏差：绑定实为 **10 个**（本文 §1 写 8 个，新增 `SubDeleteCues`/`SubInsertCue`/`SubAssignStyle` 中的删除/插入/指派，`SubCalibrate` 也在内）；样式引擎落在 `astisub.go`+`edit.go` 而非独立 `style.go` |
| **上游** | `docs/01-设计方案文档.md` §6.3（工具栏/行内编辑/样式编辑/接口名）、`docs/04-交付与验收方案.md` ★F-17 / F-18 / F-22、`docs/02-执行细节说明.md` 开篇校正说明（五操作与样式库是仅存未落地的两块） |
| **影响面** | `app/internal/subtitle/`（编辑/样式引擎：`edit.go`+`edit_test.go`+`astisub.go`）、`app/app.go`（10 个新绑定）、`frontend/src/pages/SubtitleWorkbench.tsx`（重构为虚拟化 + 编辑交互，+776/-77）、`frontend/src/wailsapi.ts`（+13） |
| **出口条件** | ★F-17 / F-18 / F-22 通过（docs/04 §5） |
| **本文职责** | 编辑操作的后端契约与语义、样式库数据模型、前端交互形态、F-22 虚拟化方案。不重复 01 文档的界面布局描述 |

---

## 0. 现状与缺口

- 引擎侧只有解析/队列/导出：`subtitle/` 没有 `UpdateCue`/`SplitCue`/`MergeCues`/`ShiftAll`/`Calibrate`，样式只做**保真读写**（`astisub.go` 保留原始 `Style:` 行，无结构化增删改）。
- 前端 cue 表是逐行 `<button>` 平铺渲染（无虚拟化），664 cue 已可感卡顿，5000 cue 不可用（F-22）。
- 已有可复用资产：`DataTable`/`useVirtualRows` 虚拟化组件（历史列表在用）、`EV.CUE` 事件层、`SubGetDoc` 权威快照对账、ASTISUB 样式保真层（B26）。

## 1. 后端契约（8 个绑定，全部返回刷新后的权威快照）

编辑类操作**返回 `*SubtitleDoc`**（一次往返拿到重排后的全量状态），不新增事件——编辑是用户节奏的离散操作，事件流是为队列连续进度设计的，两者不混用。

| 绑定 | 签名 | 语义 |
|---|---|---|
| `SubUpdateCue` | `(docID, index int, patch CuePatch) (*SubtitleDoc, error)` | 行内编辑：改 `startMs/endMs/original/translated/styleName` 任意子集。**不改序号**。`CuePatch` 各字段指针，nil = 不动 |
| `SubSplitCue` | `(docID, index int, atMs int64) (*SubtitleDoc, error)` | 拆分：`atMs ∈ (start, end)` 开区间；时间 [start,atMs] / [atMs,end]；原文按时间占比映射到字符位置、就近落在空白/标点边界（无空白则硬切）；译文同规则。新两条继承原样式；后条及之后全部 Index 重排 |
| `SubMergeCues` | `(docID, fromIndex, toIndex int) (*SubtitleDoc, error)` | 合并**连续区间** [from..to]（≥2 条，校验连续性）：start=首条.start，end=末条.end，原文/译文以空格连接（保持各自覆写标签语义：若任一条带标签则合并后 needsCheck=true 待人工检查），样式取首条。toIndex 之后条目重排 |
| `SubShiftAll` | `(docID, deltaMs int64) (*SubtitleDoc, error)` | 整体平移：全部条目 start/end += delta（可为负，负到 <0 的条目钳到 0 并 needsCheck=true）。**不重排** |
| `SubCalibrate` | `(docID, anchor1Idx int, anchor1Ms int64, anchor2Idx int, anchor2Ms int64) (*SubtitleDoc, error)` | 两点校准：线性映射——两锚点条目的 start 分别对齐到 anchor1Ms/anchor2Ms，求 `scale = (m2−m1)/(old2−old1)` 与 `offset`，作用于**全部**条目 start/end（旧两点重合则退化为纯平移）。校准后全部条目 needsCheck=false（时间轴已被人工确认） |
| `SubStyles` | `(docID) ([]StyleDef, error)` | 样式库列表（结构化字段，见 §2） |
| `SubSetStyle` | `(docID, style StyleDef) (*SubtitleDoc, error)` | 按 `Name` upsert：存在则改，不存在则追加（含前端新建）。结构化字段序列化回 `Style:` 行，其余原始字段（如 BorderStyle/Shadow）保持原值 |
| `SubAssignStyle` | `(docID, indices []int, styleName string) (*SubtitleDoc, error)` | 按行指派（F-18「指派 #1-#3」） |

**并发守卫**：全部编辑绑定在 `queueCancel[docID]` 存在时返回错误「队列进行中，先暂停或取消再编辑」——编辑与队列都写 `doc.Cues`，与其引入字段级竞态规则，不如按用户心智模型一刀切（翻译跑着的时候没人编辑时间轴）。引擎内部仍全程持 `e.mu`。

**删除/插入**：01 文档右键菜单列了插入/删除。补两个绑定：`SubDeleteCues(docID, indices)`（删除选中，重排）、`SubInsertCue(docID, afterIndex)`（在 afterIndex 后插一条 2s 空白 cue，state=pending）。F-17 不考，但右键菜单已承诺，实现成本一行循环。

## 2. 样式库数据模型

`StyleDef` 现在只有 `Name + Raw`。扩展为**结构化字段 + 原始行保真**：

```go
type StyleDef struct {
    Name        string `json:"name"`
    FontName    string `json:"fontName"`
    FontSize    int    `json:"fontSize"`
    PrimaryRGB  string `json:"primaryRGB"`  // "#RRGGBB"（ASS 的 &HAABBGGRA 转换在序列化层）
    OutlineRGB  string `json:"outlineRGB"`
    Outline     float64 `json:"outline"`   // 描边宽度
    Bold        bool   `json:"bold"`
    Alignment   int    `json:"alignment"`   // ASS numpad 1-9（底部居中=2）
    MarginV     int    `json:"marginV"`
    Raw         string `json:"-"`           // 序列化时重建；解析时保留未映射字段
}
```

- **格式边界**：ASS 文档全功能（解析现有 `Style:` 行 → 结构化 → 改动后重建该行，未映射字段逐字保留）。SRT/VTT/LRC 无样式概念：`SubStyles` 返回合成单样式 `Default`，`SubSetStyle/AssignStyle` 照常记录 `styleName`（存内存 doc），仅在**导出为 ASS** 时落成真实样式行——满足 F-18 的「导出 ASS 中 Default 与 Title 均存在」。
- 序列化往返有 B26 回归锁，样式重建必须过现有 roundtrip 测试套件（编辑→导出→重导入逐字段一致）。

## 3. 前端交互（01 §6.3 的落地形态）

- **cue 表重构为虚拟化**（F-22）：行高固定两行文本（原文/译文都 `line-clamp-2`，行高统一 56px），接 `useVirtualRows` 窗口化；行结构从 `<button>` 改为 `div role="row"`（整行点击选中、双击进入编辑不再是单一 button 语义）。5000 cue 渲染窗口 ≈ 20 行。
- **行内编辑**：双击文本格 → 该格变 `Textarea`/`input`，Enter 提交 / Esc 取消；时间格 hover 出现 ±100ms 步进按钮，双击时间格直接精确编辑毫秒。全部经 `SubUpdateCue`。
- **右键菜单**：拆分（默认中点时间，弹窗可改）/ 合并（与下一条 / 选中区间）/ 插入 / 删除 / 重译此条（已接 `SubRetryCues`）。Popover 原语 + 键盘可达（门禁会查）。
- **整体平移**：工具栏「平移」→ Modal 输入秒数（正负）→ `SubShiftAll`。**两点校准**：工具栏「校准」→ 进入锚点选择模式（提示「选择第 1/2 条参照」）→ 每锚点弹窗输入正确时间 → `SubCalibrate`。
- **样式库面板**：右侧详情栏加 Tab（详情 / 样式）。样式 Tab 列出 `SubStyles` + 新建/编辑表单（§2 字段）+ 行指派（选中 cue → 指派下拉）。
- **预览画布**：样式面板底部 16:9 模拟画布，按当前编辑样式渲染选中 cue 文本（CSS 对应：字号按 384px 画布与 1080p 比例缩放、描边用 `-webkit-text-stroke`、Alignment 映射九宫格定位）。静态预览，不做视频播放。

## 4. 编辑与队列/导出的联动语义

- 编辑只动内存 doc（与现状一致，重启即失——持久化属 M6 后话题，不在本里程碑）。
- 编辑后导出直接反映编辑（导出走同一 doc）——F-17 的「导出文件核对一致」即验此链路。
- 拆分/合并/插入产生的 `pending` 新条目，下次「全部翻译」（Full）或「重试失败」按既有语义处理；手动编辑过的 `done` 条目若原文被改，置回 `pending`（译文已不对应新原文）；仅改时间/样式则保持 `done`。

## 5. 测试策略

- 引擎级表驱动：拆分（边界 atMs=start/end 拒绝、中点、无空白硬切、标签条目）、合并（连续性校验、区间首尾时间、needsCheck 传播）、校准（缩放+偏移的期望值、旧两点重合退化、负时间钳 0）、平移（负值钳 0）。
- Roundtrip：编辑 → 导出 ASS/SRT → 重导入 → 逐字段一致（扩展现有 roundtrip 套件）。
- 并发守卫：队列运行中编辑返回错误。
- 前端：`verify:pages` 字幕页三组门禁照常；5000 cue 构造数据手工滚动验证 F-22（60fps 无法自动断言，以长帧采样脚本辅助 + 人工确认）。

## 6. 非目标

- 音频/视频真实播放与时间轴波形对位（预览是样式静态渲染）。
- ASS 高级特性：卡拉OK 标签、动效标签、多样式继承；编辑面板只暴露 §2 结构化字段。
- cue 数据持久化（重启丢失，与现状一致）。
- 撤销/重做栈（编辑即时生效 + 导出前可再改，v1 不做 undo；如真机验证中成为痛点再立 issue）。

## 7. 实施顺序（每步门禁全绿再下一步）

| 步 | 内容 | 估时 |
|---|---|---|
| 1 | 引擎五操作 + 删除/插入 + 并发守卫 + 表驱动/roundtrip 测试 | 1 天 |
| 2 | 8 个绑定 + wailsapi 封装 + mock 条目 | 0.5 天 |
| 3 | F-22 虚拟化重构（先行，编辑交互挂在新表上） | 0.5 天 |
| 4 | 行内编辑 + 右键菜单 + 平移/校准工具栏 | 1 天 |
| 5 | 样式库面板 + 预览画布 + ASS 序列化 | 1 天 |
| 6 | ★F-17 / F-18 真机验证（并入 M3 验证轮之后的里程碑出口流程） | 0.5 天 |
