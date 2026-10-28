# Agent 接续入口

开始工作前先读 [docs/HANDOFF.md](docs/HANDOFF.md)，其中记录当前进度、未提交改动、断点、验证边界和建议分工。最后核对日期：2026-10-28（Asia/Singapore）。

- 先核对 `git status --short --branch`、`git log -3 --oneline` 和 `git worktree list`；交接是快照，以当前文件及 Git 状态为准。
- 认领任务时在交接表登记 agent、工作目录、分支和修改范围；结束时补充最后完成步骤、下一条操作、验证与未解决问题。表中的建议分工不代表已经派发。
- 当前工作区原有的 README、开发/发布说明、截图与截图脚本改动需要保留；具体九个文件见交接文档。提交时按任务选文件。
- 文译（Wenyi）P0 核心已在独立 worktree 完成小样本验证，尚无产品内接入；验证边界和 P1 接手点见交接文档 §8。该 worktree 的未提交实现不在当前分支。
- 字幕和长文档只支持同一次应用会话内恢复；跨应用重启持久断点尚未实现。不要将模型下载的 `.part` 续传混同为工作台恢复。
- 生产构建从根目录运行 `node scripts/build.mjs`，确保前端同步到 `app/frontenddist/` 后嵌入 exe。
- 历史报告、归档 JSON、本轮实际执行分开记录；`verify:all` 不包含 `verify:workflows`。本机 `CGO_ENABLED=0`，不能声称 race detector 已通过。
- `models/` 包含数据库，`thirdparty/` 是运行依赖；`.archcore/`、`.superpowers/` 等含被忽略的本地资料。保留用户资产和历史验收证据。
