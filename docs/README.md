# Documentation / 文档索引

[English overview](../README.md) · [中文介绍](../README.zh-CN.md)

项目入口与开发过程记录分开维护。以下指南描述当前仓库的使用和管理方式；带日期的报告保留当时的结论，不作为当前版本的完整验收证明。

**当前进度与接续入口：** [项目进度与 Agent 交接](HANDOFF.md)（2026-10-28 核对），包含工作区快照、Wenyi P0 验证边界、工作台恢复边界、验证记录差异和协作认领表。Agent 开工另见根目录 [AGENTS.md](../AGENTS.md)。

## 使用与维护

| 文档 | 内容 |
| --- | --- |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 构建、热更新、浏览器演示、测试、数据路径和源码目录。 |
| [RELEASING.zh-CN.md](RELEASING.zh-CN.md) | GitHub 设置、版本、Release 说明、附件组织、校验与发布步骤。 |
| [LICENSING.zh-CN.md](LICENSING.zh-CN.md) | 已采用的 MIT 协议、许可比较和字体/模型/运行时授权边界。 |
| [清理记录与剩余候选](CLEANUP-2026-10-18.md) | A 批次已确认执行；其余文件的属性、体积、可再生成性与清理影响。 |
| [第三方声明索引](../THIRD_PARTY_NOTICES.md) | 已识别第三方组件和发布时需要保留的声明。 |

## 架构与设计

- [设计方案](01-设计方案文档.md)、[执行细节](02-执行细节说明.md)、[交付与验收方案](04-交付与验收方案.md)。
- [界面设计规范](03-GUI设计图/DESIGN.md)。
- `superpowers/specs/` 与 `superpowers/plans/`：专题规格及实施计划。目录名与旧文档互相引用，暂时保留路径。
- [翻译模式评估](prompt-presets-evaluation.md)。

## 验证与研究记录

- [2026-10-17 体验与验收清单](review-2026-10-17/评审与验收清单.md)。
- [后续修复及验证范围](review-2026-10-17/剩余问题修复记录.md)。
- [2026-10-08 状态报告](项目状态报告-2026-10-08.md)、[2026-10-09 限制台账](已知限制清单-2026-10-09.md)：历史基线，部分状态已由后续记录更新。
- [字体来源与处理记录](research/font-license-verification-2026.md)。
- [翻译质量改进可行性](research/translation-quality-harness-feasibility-2026-10-18.md)。
- [Wenyi 本地接入方案与模型探针](../exa-results/wenyi-local-integration-2026-10-25.md)：当前分支仅包含方案、探针与结果；独立 worktree 的 P0 进展见交接文档 §8，尚未接入产品书籍工作区。

`review-2026-10-17/materials/` 是回归输入与生成脚本，不是用户缓存。该目录中的 JSON、截图和报告包含不同时间的证据，不能仅根据扩展名批量删除。

## 截图与发布素材

- `assets/screenshots/`：README 使用的演示截图，以及[来源说明](assets/screenshots/README.md)。
- [Release 正文模板](../.github/RELEASE_TEMPLATE.md)：英文在前、中文在后，手动填入实际验收和附件信息。
- `.github/release.yml`：生成 GitHub Release notes 时的 PR 分类规则，不是发布工作流。

本轮整理通过增加入口和明确用途完成，现有工程记录未搬移、未删除。已按用户确认清理 A 批次的旧截图与两处构建生成物，执行记录和其余候选见清理清单。
