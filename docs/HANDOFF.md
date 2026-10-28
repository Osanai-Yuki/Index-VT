# 项目进度与 Agent 交接

最近接续核对：**2026-10-28（Asia/Singapore）**。§1–6 保留 2026-10-26 的原始交接快照，其“本轮”“未运行”“P0 未完成”均指当时。**最新 P0 实施、实际验证和下一步见 §8**；接手时仍须重新核对 Git 与文件状态。

**2026-10-28 GitHub 更新归档见 §9。** §3 的公开截图与文案已形成独立提交；本文件早期章节中的“未提交”保留原快照语义。

**当前主线：已有 Windows 翻译应用处于开发预览阶段；Wenyi P0 核心已在隔离分支实现并完成小样本链路验证，产品 GUI / Go 接线仍待 P1。** 上游全量回归有一项并发顺序断言未通过，边界见 §8。另有一组已生成、未提交的公开截图与说明更新，必须单独保留和交接。

## 1. Git 与协作位置

| 项 | 本次观察 |
| --- | --- |
| 当前目录 | `E:\Code_Projects\Go\Index-VT_GUI` |
| 当前分支 | `codex/wenyi-local-integration` |
| HEAD | `6eb07c41e6143d58c7fefdfeb7cc0ad0dc5678cb`，2026-10-25 13:55 +08:00 |
| 最新提交 | `docs: plan Wenyi local-model integration and record benchmarks`，只新增方案、探针和原始结果三份文件 |
| 应用基线 | `7fea3c2`，2026-10-18，`Prepare project for public preview release`；当前 `main` 与本地 `origin/main` 均指向此处，未联网核对远端 |
| 源码差异 | HEAD 相对 `7fea3c2` 没有 `app/`、`frontend/` 源码变化；本轮开始时这两处也没有工作区改动 |
| 暂存与 stash | 本轮开始时没有暂存改动，`git stash list` 为空 |
| 另一 worktree | `E:\Code_Projects\Go\Index-VT_GUI-wenyi-design`，登记分支 `codex/wenyi-integration-design`，登记 HEAD 同为 `6eb07c4` |

另一 worktree 的 `.git` 指针和目录可读取，但本沙箱中的 Git 查询出现 `Permission denied` / `must be run in a work tree`。**尚不能确认其工作区是否干净，也不能据此认定 worktree 损坏。** 接手者在允许访问该目录的环境先运行 `git -C E:/Code_Projects/Go/Index-VT_GUI-wenyi-design status --short --branch`，再决定同步；本轮没有修改其文件、ACL 或 Git 登记。

本轮可见的协作 agent 只有当前 agent，没有向其他运行中的 agent 派发任务。交接通过根目录 [AGENTS.md](../AGENTS.md)、本文和[文档索引](README.md)供后续 agent 接续；不要把准备好交接材料记成“对方已经接收”。本轮未提交、推送、创建标签或发布；其他 worktree 不会自动获得这些未提交文档，应先从当前目录读取。

## 2. 已完成与尚未完成

| 方向 | 已有实现或证据 | 当前边界 / 下一步 |
| --- | --- | --- |
| 文本翻译与模型管理 | Wails v2 + Go + React/TypeScript；本机 llama-server；Translate / Nailong / Homura；流式翻译、历史、术语与设置 | 仍是开发预览；真实硬件适配与语义质量不是全部验收通过 |
| 字幕工作台 | SRT/ASS/VTT/LRC、队列、编辑、撤销/重做、样式、双语导出；文档代次和 revision 隔离 | 只支持会话内保留；真实 IME、复杂 ASS、外部播放器与原生对话框仍需验收 |
| 长文档 | TXT/MD、Nailong 分块、继续与全量重翻、术语诊断、部分导出；2 MiB / 50,000 Unicode 字符限制 | 内存任务，不具备跨重启恢复；没有 EPUB 书籍工作区 |
| 10-17 后续修复 | 取消终态、迟到事件隔离、导出保护、术语维护、下载停止语义、模型占用保护、h1 等已进入 `7fea3c2` 基线 | [剩余问题修复记录](review-2026-10-17/剩余问题修复记录.md)描述实现与当时验收边界；不能沿用更早缺陷清单重复估工 |
| 公开说明与发布准备 | 中英文 README、开发/发布/许可说明、Release 模板与第三方声明已存在 | 未核实任何线上 Release；10-19 截图和文字更新仍未提交 |
| 翻译质量 Harness | [可行性报告](research/translation-quality-harness-feasibility-2026-10-18.md)、[24 条诊断输入](research/translation-quality-pilot-cases.json) | 尚未实现并测量报告中的新流水线；诊断集不能当独立测试集 |
| Wenyi 接入 | [方案](../exa-results/wenyi-local-integration-2026-10-25.md)、[探针](../scripts/wenyi-model-probe.py)、[原始结果](research/wenyi-model-probe-2026-10-25.json)已提交 | 尚未运行真实 Wenyi Core 流水线；worker、网关、持久项目、书籍 UI 与 EPUB 往返均未实现 |

历史 M2–M5 的功能实现不能直接等同于 M6 发布验收完成。[10-08 状态报告](项目状态报告-2026-10-08.md)、[10-09 限制台账](已知限制清单-2026-10-09.md)、忽略目录中的旧计划保留为历史依据；当前判断需要结合 10-17 后续修复、10-18 提交和实际源码。

## 3. 本轮开始时的未提交断点：公开截图与文案

以下是**原有九个文件**，不包含本轮交接新增文件；没有回退或代为提交。

| Git 状态 | 文件 | 当前内容 / 接续动作 |
| --- | --- | --- |
| M | `README.md`、`README.zh-CN.md` | 文案整理、术语导入/导出口径澄清、截图日期更新；合入前核对两种语言一致性和 Release 可用性措辞 |
| M | `docs/DEVELOPMENT.md` | 增加公开截图脚本入口；保留原改动 |
| M | `docs/RELEASING.zh-CN.md` | 仓库名称与主分支说明更新；保留原改动 |
| M | `docs/assets/screenshots/README.md` | 说明生产前端渲染、公开夹具、非真实推理的来源边界 |
| M | `docs/assets/screenshots/translation-light.png`、`subtitles.png` | 两张 1440×900 图片已生成 |
| ?? | `docs/assets/screenshots/capture.json` | 记录生成时间、来源提交、exe/资源/图片哈希与公开示例；与两张图片一起交接 |
| ?? | `scripts/capture-readme.mjs` | Playwright + 系统 Chrome；读取当前 exe 和匹配 embed 目录，默认覆盖上述两图及 metadata |

**恢复点：文件已经在磁盘，无需重新拍图才能继续。** 本轮 `node --check scripts/capture-readme.mjs` 通过；exe、两图、五份前端资源共 **8 项 SHA-256 全部匹配** `capture.json`。未重跑浏览器渲染或真实模型。

当前 exe：`app/build/bin/Index-VT.exe`，20,832,768 字节，SHA-256：

```text
fb2d5bf473dd8205f2fe1de36d84e4dc8dd5f9fb499e9ccfd99035a3865f3ba3
```

截图 metadata 的 `sourceCommit` 是 `7fea3c2`，截图时间为 2026-10-19；当前 HEAD 后续仅增加 Wenyi 研究文件，两者并不冲突。`review-2026-10-17/latest-build.json` 记录的是另一份旧 exe（哈希 `2616215d…`），不能用它指认当前产物。当前磁盘未发现清理历史中提到的 `Index-VT-exit-fix.exe`，本轮没有删除该文件。

若确需重新生成，先阅读[截图说明](assets/screenshots/README.md)。脚本占用回环端口 **5193**；可用 `node scripts/capture-readme.mjs --output=.tmp-readme-capture/<新目录>` 保留公开版本。`frontend/dist/` 与 `app/frontenddist/` 当前均存在，早期清理报告里的“已删除”是当时状态。

下一步是复核后按截图任务范围选择文件提交，不把它们混入 Wenyi 功能提交。跨 worktree 同步前先确认目标目录状态；同机可先读取当前目录，Git 同步需等对应文件形成提交。

## 4. 重点断点：功能恢复语义

| 场景 | 已实现的恢复方式 | 丢失边界与注意点 |
| --- | --- | --- |
| 页面切换 | 主翻译、字幕、文档保留挂载；隐藏页面不抢快捷键/弹层；后台事件继续接收 | 页面保留不是磁盘持久化 |
| 文档取消 / 失败 | `DocResume` 复用原文档、方向与术语，只补 pending/failed；done 保留；取消中的块回 pending | 状态在 `docpipeline.Engine.docs` 内存 map；应用退出后无法恢复原任务 |
| 文档重新翻译 | `DocRestart` 经界面确认后清空旧块结果并全量重新生成 | 不能用 Restart 代替 Resume，避免覆盖已完成译文 |
| 字幕暂停 / 继续 | 完成当前条后停；`SubResumeQueue` 恢复仍存在的队列及原参数 | 只对活动/暂停队列有效；取消后不是同一个暂停队列 |
| 字幕取消 / 重试 | 等队列终态，保留完成条；取消行回可重试状态；按失败/指定行重新排队 | 文档、队列与撤销栈均在内存；取消后的再次翻译先核对目标范围和参数；全量重翻会覆盖人工结果并清历史 |
| 模型下载停止 | 保留 `<模型>.part` 与 `.part.json`；再次下载按同源 URL 和内容信息决定续传 | 切源、ETag 变化、服务端不支持 Range 等会重新下载；最终 SHA-256 校验不可省略；真实断网/跨重启续传仍待验收 |
| 主翻译取消 | 保留界面部分译文并等待后端终态；历史单独持久化 | 未完成请求的草稿不是可跨重启续跑的任务 |
| Wenyi 项目 | 方案要求独立项目状态、稳定段落 ID 与跨进程恢复 | **目前没有实现，也没有可恢复的 Wenyi 产品任务** |

定位实现时先读：`app/internal/docpipeline/pipeline.go`、`app/internal/subtitle/engine.go` / `queue.go`、`app/internal/modelmanager/download.go`、`app/app.go` 的 Doc/Sub/退出绑定，以及 `frontend/src/pages/DocTranslate.tsx`、`SubtitleWorkbench.tsx`。

**退出前先导出字幕/文档。** 关闭时的确认提示是保护措施，不会创建持久断点。`models/data/indexvt.db` 保存设置、历史、术语和模型登记；复制数据库不能恢复这些内存工作台任务。

## 5. Wenyi 接手点与阶段出口

**最后完成：** 2026-10-25 的接入可行性、架构建议和两个本地 2B 模型的 10 次代表性请求。Translate / Nailong 的短输入 decode 中位数约 87.20 / 86.85 token/s，仅是已记录的特定机器探针；没有整书质量或完整流程吞吐结论。

**下一条工作：P0，真实 Core 小样本验证。** 不必重做已经保存的检索和短输入测速。上游 v1.2.7 是原方案的固定参考，实际实施前固定完整 revision 与依赖；本文未重新联网验证上游变化。

| 阶段 | 下一步与完成判据 |
| --- | --- |
| P0（未完成） | 固定 Core/依赖与本地 provider；准备原创小型 TXT/EPUB；跑原版批次翻译，验证真实输出、导出和状态；至少完成一次中断、退出进程、重新启动后续跑，核对已完成段落未重译、ID/顺序/原文未漂移 |
| P1（未开始） | 版本化 JSONL worker（stdout 仅协议、stderr 诊断）、Go 回环网关、动态 llama 端口映射、应用级书籍任务占用、请求级 TaskBegin/TaskDone、取消与回收、最小书籍页面；从应用导入到导出并跨应用重启恢复 |
| P2（未开始） | EPUB 图片/样式/目录/段落往返、校对与术语、异常退出恢复、独立 worker/运行时打包、版权许可与干净 Windows 验收 |
| P3（未开始） | 通用模型分析/摘要/审校能力、操作路由与串行模型调度；有质量对照后再开启 |

P0 的持久断点证据至少包含：源文件身份/哈希、固定 Core 版本、模型与量化、语言、提示词/术语版本、已完成段落 ID、失败/取消状态、恢复命令及导出对应关系。测试状态写入隔离目录，保留上次成功检查点和失败输出。

沿用方案中的几个约束：单 slot 先串行；现有文档内存 map 不当作书籍存储；`book_understanding: false` 不能据此假定所有分析都已关闭；`finish_reason=length`、段落数量或顺序错误不得记完成；JSON 合法不证明分析正确。PDF 依赖和完整审校另排，不算首阶段离线能力。详细架构与失败处理见[接入方案](../exa-results/wenyi-local-integration-2026-10-25.md)。

复跑模型探针会启动 GPU 服务并覆盖 `--output` 指定文件。若要新增测量，使用新的结果路径，先检查已有推理实例及资源占用；原 10-25 结果保留。`.tmp-wenyi-probe/`、`.tmp-readme-capture/` 仅存在本地且被忽略，接手其他机器时不能假定可用。

## 6. 验证证据与待补项

| 证据 | 本次核对结论 |
| --- | --- |
| 10-17 修复报告 | 当时记载 Go 测试、前端门禁、页面矩阵、术语验证、生产构建和一次原生启动/退出检查通过；这些是历史执行，不是本轮重跑 |
| workflow 文字与 JSON 不一致 | 旧报告称 17 项未执行、请求曾被拒绝；后续 `7fea3c2` 收录的 `workflow-results.json` 实际为 **20 项、20 个 ok=true**，与现有脚本 20 个用例相符。应表述为“后续归档显示 20/20；本轮未重跑”，不继续写成从未执行，也不冒称本轮通过。JSON 没有执行时间/commit 元数据，后续新跑要补充来源 |
| 当前 `verify:all` | 不包含 `verify:workflows`；运行前者不能自动覆盖后者 |
| 本轮实际检查 | Git/文件/恢复代码核对；截图脚本语法通过；截图 provenance 8 项哈希匹配；未执行应用行为测试或完整构建 |

仍需真实环境覆盖：中文/日文 IME、Windows 保存/覆盖/退出对话框、磁盘满/文件占用、下载断网/换源/跨重启、200% 缩放及 125%/150% DPI、复杂 ASS 与外部播放器、CPU 样本、OOM/驱动故障、语义忠实与人工术语审校。普通双文件导出的回滚不能等同于断电时跨两个路径的原子事务。

本轮工具链观察：Node `v26.12.1`、Go `go1.27.1 windows/amd64`、`GOTOOLCHAIN=auto`、`CGO_ENABLED=0`；模块声明 Go 1.25.0，Wails 依赖 v2.16.0。工具链值是本机观察，不是最低版本承诺。不要声称 `go test -race` 已通过。

后续按任务运行适当门禁，详见[开发指南](DEVELOPMENT.md)：

```powershell
# 先确认所在目录与原有差异
git status --short --branch
git log -3 --oneline
git worktree list

# 需要完整重建时（会更新构建产物）
node scripts/build.mjs

# Go 与前端改动的相关验证
Push-Location app
go test ./...
Pop-Location
npm --prefix frontend run verify:all
npm --prefix frontend run verify:pages
npm --prefix frontend run verify:workflows
```

Go 主包需要有效 `app/frontenddist/`；缺失时先走完整构建。浏览器验证通常写回 `docs/review-2026-10-17/`，`verify-workflows.mjs` 使用 **5181** 并覆盖 `workflow-results.json`。新一轮验证需保留旧证据并记录新执行的日期、commit、命令、退出码和范围；遇到权限拒绝记录为未执行，不计通过。

## 7. 建议协作分工与同步规则

以下是可认领任务，不是已启动的 agent 或既定实现承诺。没有认领前 Owner 均为空；同一文件的并行编辑先协调。

| 任务 | Owner / 状态 | 建议修改范围 | 依赖与交付 |
| --- | --- | --- | --- |
| S：公开截图收口 | Codex `/root` 已完成（2026-10-28）；提交 `e3d7b5f` | 本文 §3 的九个文件；`E:\Code_Projects\Go\Index-VT_GUI` / `codex/wenyi-local-integration` | 中英文核对、脚本语法、8 项 SHA-256 与图片目视检查完成；下一步按需复用截图 |
| G：GitHub 更新 | Codex `/root` 检查与归档完成（2026-10-28）；同步范围见 §9 | 当前工作区 / `codex/wenyi-local-integration`；S 的九个文件及 `AGENTS.md`、本文、`docs/README.md`，按任务分开提交 | 用户已授权提交并推送；已获取远端与检查差异，保留其他 worktree 的未提交工作；远端最终状态以 Git ref 为准 |
| D：main 项目简介 | Codex `/root` 已完成（2026-10-28，Asia/Singapore） | `E:\Code_Projects\Go\Index-VT_GUI` / `codex/wenyi-local-integration`；仅本文登记，简介在聊天交付；未提交 | 最后完成：核对 Git 状态、日志、worktree 与 `main`（`7fea3c2`）中英文 README，完成简介；下一步：按需使用简介。只做文案核对，未运行构建或应用测试；无阻塞 |
| W0：Wenyi P0 | Codex `/root` 核心完成，见 §8 验证边界（2026-10-28）；未提交 | `E:\Code_Projects\Go\Index-VT_GUI-wenyi-p0` / `codex/wenyi-p0-core`；仅 P0 的 `integrations/wenyi/`、隔离夹具/新结果与必要文档；主工作区仅更新本交接记录 | 真实 Core、只读 DTO、配置/模型/预算、TXT/EPUB 跨进程续跑已出证据；上游并发顺序断言未通过；未派发子 agent |
| W1：Go/worker 集成 | 未认领；W0 核心合同已可读取 | 新 worker/网关/任务管理；必要的 `app/` 绑定 | 先从 §8 与 P0 report 确认边界，再与前端约定 JSONL/RPC/事件、任务 ID、错误和取消语义；接口冻结后接线 |
| W2：书籍 UI | 未认领；等待最小接口 | 新书籍页面、导航、桥接与生成类型 | 先用独立夹具验证，再接真实 worker；避免与 W1 同时手改同一绑定文件 |
| Q：验证与发布缺口 | 未认领；有历史归档 | 新验证记录、原生场景与 Release 核对 | 区分历史结果、本轮结果和待测；禁止把假数据截图计入真实推理验收 |

根目录 `AGENTS.md` 和本文由当前协调任务建立。接手时填写 Owner、目录/分支、最后完成步骤、下一条操作；需要共享接口或更换文件范围时先更新这里。不同 worktree 共享 Git 历史，**不共享未提交文件、node_modules、模型、数据库或临时夹具**。同步以明确的文件或提交为单位，读取目标状态后执行，避免整包覆盖工作区。

2026-10-26 的交接工作只新增 `AGENTS.md`、本文，并在 `docs/README.md` 增加入口；开始时九个已有改动保留。该历史轮次未修改业务代码、数据库、运行资产及另一 worktree。2026-10-28 的实际实施另见 §8。

接续记录可用下列格式追加，不需要复制整份报告：

```text
时间 / 时区：
Agent / 任务编号：
工作目录 / 分支 / 基准 commit：
已完成 / 最后有效检查点：
本轮修改文件 / 对应 commit（未提交则注明）：
验证命令 / 退出码 / 结果路径 / 未执行原因：
下一条可执行操作：
阻塞 / 所需输入 / 与其他任务的接口变更：
```

## 8. 2026-10-28：Wenyi P0 核心实施接续

Agent：Codex `/root`，W0；没有启动子 agent。新增 worktree：
`E:\Code_Projects\Go\Index-VT_GUI-wenyi-p0`，分支 `codex/wenyi-p0-core`，基准 `6eb07c4`。
设计 worktree 的修订 3 已复制到 P0 目录；未修改原设计 worktree。P0 改动当前未提交、未推送或合并。
`main` 仍为 `7fea3c28edfd937f4bf88e98c827b240e136c13b`；根工作区保留 §3 的原有改动，
本任务只更新根目录这份交接文档。不要将本任务源码与截图任务混在一次提交里。

**最后完成：** 固定 Wenyi `4c27cb8cbf0f0427bbe888c687870dd634935643`、三文件 local-only 补丁与
Python 依赖；真实 Core 解析/初始化、Translate/Nailong 本地翻译、分页只读 DTO、模型 SHA/量化校验、
完整模板 token 预算和有限回退、原生持久状态与 EPUB/TXT 导出均已实现。
TXT / EPUB 各强制结束 worker 后用新进程续跑，已完成段落不重译，段 ID / 顺序 / 原文保持。

实际证据位于 P0 worktree：

- [实施与验证报告](../../Index-VT_GUI-wenyi-p0/docs/research/wenyi-p0-verification-2026-10-28.md)。
- [源码与复跑说明](../../Index-VT_GUI-wenyi-p0/integrations/wenyi/README.zh-CN.md)。
- `wenyi-p0-live-2026-10-28-v2.json`：两个格式、20 次 completion、44.79 秒；
  Translate decode 中位数约 86.89 token/s。首轮 `wenyi-p0-live-2026-10-28.json` 存在占位符和串段，
  仅保留作失败诊断，不能把首轮结构断言当质量通过。
- `wenyi-p0-models-2026-10-28.json`：两模型共 12 个 tokenizer 对账探针，
  Nailong 另有两个正文段及一个标题请求；真实 Q4_K_M，未跑 Q8。
- `wenyi-p0-distribution-2026-10-28-v2.json`：三个 wheel / 三个 sdist、新 venv 非 editable 安装、
  59 个 Core 资源 / 四个 Nailong 模板、读取正式项目与 pip check 通过。

**本轮实际验证：** 适配器离线测试 `35 passed`；Ruff 通过。上游 Core 全量首次
`1516 passed / 5 failed / 10 skipped`，UTF-8 目标复核 `159 passed`，UTF-8 全量
`1520 passed / 1 failed / 10 skipped`（另有 73 个 subtests passed）。剩余为
`test_profile_probes_cover_unrouted_profiles_in_registry_order` 的并发请求发起顺序断言；
未算全绿、未改动无关上游模块。未打补丁完整克隆对照 `1521 passed / 10 skipped`，
未复现该失败；并发顺序解释来自代码分析，不能说原版同样失败。所有自建推理服务已回收。没有修改 Go/React，因此没有运行产品构建、
Go/前端全套或 race detector；不得在后续说明中补写为已通过。

**下一条可执行操作：** 在 P0 worktree 先运行 `git status --short --branch`，阅读实施报告 §6，
认领 W1 / W2；将 P0 `Project.summary/query`、冻结模型身份与 local-only 能力映射为版本化 worker
协议和 Go 服务，再同时实现书籍 GUI / 设置兼容。先完成应用任务准入与项目/运行身份合同。

**未解决与接口边界：** P0 是 Python 核心/参考网关，桌面程序里还不能使用 Wenyi。
当前原有字幕/文档仍只有应用会话内恢复；P0 worker 进程恢复不能改写为产品已支持跨重启。
强杀可留下 `running` 的运行记录，P1 supervisor 须核对原生正式状态并负责取消/回收。
人工修改、适配版本迁移、复杂 EPUB、整书质量/吞吐、无 Python 干净 Windows 打包留后续阶段。
模型 / 原应用数据库 / thirdparty 资产和历史结果均须继续保留。

## 9. 2026-10-28：公开更新与 GitHub 归档

Agent：Codex `/root`；工作目录 `E:\Code_Projects\Go\Index-VT_GUI`，分支
`codex/wenyi-local-integration`。本节为提交时的记录，远端同步结果以 Git ref 为准。
用户已明确授权将最新更新提交到 GitHub。本轮 `git fetch origin` 成功；核对时
`origin/main` 仍为 `7fea3c2`，远端尚无本地 Wenyi 分支。

**最后完成与提交范围：**

- `e3d7b5f`：公开截图、截图脚本与 metadata、中英文 README、开发与发布说明，严格为 §3 的九个文件。
- `AGENTS.md`、本文与 `docs/README.md` 单独归档交接信息；更新接续日期和 Wenyi P0 状态，明确 P0 实现仍在独立 worktree。
- 原有 `6eb07c4` 的 Wenyi 方案、探针和结果随当前分支同步；没有合并 P0 实现，也没有修改应用源码。

**本轮实际验证：** `node --check scripts/capture-readme.mjs` 退出码 0；
metadata 所记录的 exe、五份前端资源、两张图片共 8 项 SHA-256 全部匹配；
两张公开图片目视检查完成；中英文功能和截图说明一致；`git diff --check` 与
公开更新提交前的 `git diff --cached --check` 退出码均为 0。
未重新拍图、执行真实推理、运行产品构建或 Go/前端全套测试；没有声称这些检查通过。

**交付与下一步：** 将上述提交推送到 `origin/codex/wenyi-local-integration`，
再核对本地 HEAD 与远端分支 SHA；本次不更新 `main`、创建标签或发布程序包。
后续产品接入继续按 §8 认领 W1/W2。

**保留与未解决：** 其他 worktree 的未提交文件、模型、数据库、运行依赖和历史证据保留原状；
Wenyi P0 的上游回归边界与产品未接入状态仍见 §8。本轮没有检查或提交其他 worktree 的改动。
