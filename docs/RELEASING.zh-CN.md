# GitHub 发布与文件管理指南

[项目介绍](../README.zh-CN.md) · [开发指南](DEVELOPMENT.md) · [协议选择](LICENSING.zh-CN.md)

本指南按个人维护的 Windows x64 项目编写。当前仓库尚未配置远程地址，本轮只准备本地文档和 Release notes 配置，没有创建标签、推送、上传附件或发布 Release。

## 首发建议

建议先发布 **预览版**，以“应用本体包 + 用户自行准备引擎与模型”为首发形式。这样容易控制附件内容，也不会误把本机数据库、下载进度或数 GB 的开发运行环境一并公开。若决定提供完整便携包，再固定一套已实测的引擎及 DLL，补齐该构建的授权声明。

项目已采用 **MIT**，根目录 [LICENSE](../LICENSE) 为正式协议。首次发布前仍要收集最终二进制所含依赖的完整声明，并随包携带项目和第三方许可。不要将目前的第三方索引当成已经收齐所有许可证。Windows 原生对话框、真实模型推理与翻译质量的未验收项目应继续列入发布说明。

## 仓库页面设置

| 设置 | 建议 |
| --- | --- |
| About 描述 | `Local translation for text, subtitles, and long documents on Windows.` |
| Topics | `translation`、`subtitles`、`windows`、`wails`、`llama-cpp`、`gguf`、`local-inference`。 |
| Website | 有真实主页再填写，不放不存在的下载地址。 |
| Releases | 对用户开放下载入口；用清楚的附件名称区分源码、应用本体和含引擎便携包。 |
| Issues | 用于问题反馈；提示用户提供版本、模型/量化、上下文及最小复现材料。 |
| Wiki / Projects / Discussions | 当前不用可以关闭，后续有维护需求再启用。 |
| 默认分支 | 当前使用的主分支即可；上传前确认未提交改动，避免把开发工作区误认为已发布源码。 |
| 分支保护 | 如果开启，优先保护主分支的强制覆盖/删除；要求测试的规则应与真实 CI 配套，不设置永远不存在的必需检查。 |
| Actions | 如后续引入构建，普通检查用只读令牌，仅发布步骤使用所需写权限；初期可手动发布。 |

Topics 用于帮助检索，参见 [GitHub 文档](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)。令牌权限原则参见 [GITHUB_TOKEN 文档](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)。这些是建议，当前没有代你修改 GitHub 设置。

## 版本与构建记录

发布前同步以下值；当前代码中的基础版本为 `1.0.0`，它不等于已经发布了正式版：

| 位置 | 更新内容 |
| --- | --- |
| `app/main.go` | `version` 常量，影响 `-version` 与应用状态。 |
| `app/wails.json` | `info.productVersion`，影响 Windows 资源；保留已设置的作者/版权。 |
| `frontend/package.json` | `version`。 |
| `frontend/package-lock.json` | 顶层及 `packages[""]` 的版本。 |
| Git 标签与 Release 名称 | 如 `v1.0.0-preview.1`；用预览后缀区别正式发行。 |

Windows 数字资源版本可保持对应的 `1.0.0`；如果要让 `-version` 显示 `1.0.0-preview.1`，应明确修改 Go 常量，不能仅给压缩包改名。

发布记录保存：源码 commit、是否干净检出、Go/Node/Wails 版本、Windows 版本、选定的 llama.cpp 构建/后端、默认模型和量化、上下文参数、真实执行的检查及附件 SHA-256。不把测试夹具通过写成全体真实机器通过。

## 附件命名与内容

下面的版本仅是命名示例：

| 附件 | 内容 | 说明 |
| --- | --- | --- |
| `Index-VT-1.0.0-preview.1-windows-x64-app-only.zip` | 应用、使用说明、项目许可、依赖许可 | **不含引擎和模型，不能独立完成翻译。** |
| `Index-VT-1.0.0-preview.1-windows-x64-cpu-portable.zip` | 应用 + 指定 CPU 引擎及其库/声明 | 可选；必须实测该 CPU 构建。 |
| `Index-VT-1.0.0-preview.1-windows-x64-cuda-portable.zip` | 应用 + 指定 CUDA 引擎及其库/声明 | 可选；注明要求的 NVIDIA 驱动/运行环境，先确认 DLL 可再分发。 |
| `SHA256SUMS.txt` | 所有上传 zip 的 SHA-256 与文件名 | 哈希用于检查文件一致性，不等同于代码签名或身份保证。 |
| GitHub 自动生成的 Source code | 标签对应的源码 | 不包含 Git 忽略的运行时/模型，也不是可直接运行的程序。 |

GitHub Release 附件与自动生成的源码档案是不同交付物，参见[官方说明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。不要把 GGUF 模型加入源码历史；让应用从上游下载，既减少附件体积，也让模型来源与版本更清楚。

建议的附件内部布局：

```text
Index-VT-<version>-windows-x64-app-only/
├── Index-VT.exe
├── README.txt               # 短版、可离线阅读的说明
├── LICENSE                  # 完整 MIT 协议
├── COPYRIGHT
├── THIRD_PARTY_NOTICES.md    # 当前组件索引
└── licenses/
    ├── fonts/               # 三份完整 OFL
    ├── frontend/            # 实际包含的前端依赖许可
    └── go/                  # 实际包含的 Go 依赖许可/NOTICE
```

完整便携包在此基础上增加 `thirdparty/llama-server/` 和其许可。模型仍建议单独下载。**不要复制开发机现有的 `models/data/`、`logs/`、诊断包、`.part` 文件或私人术语本。** 用户已有便携目录升级时只替换应用及指定运行库，不用整个新目录覆盖旧数据目录。

## 手动打包示例（PowerShell）

先完成完整构建和验收，使用仓库根目录的 MIT `LICENSE`，把所有最终依赖声明整理到本地 `release/notices/frontend/` 与 `release/notices/go/`；这两个目录必须包含实际声明文件，不能以空文件夹替代。然后从仓库根执行：

```powershell
$releaseVersion = '1.0.0-preview.1'
$releaseName = "Index-VT-$releaseVersion-windows-x64-app-only"
$releaseStage = Join-Path $PWD "release/$releaseName"
$releaseZip = Join-Path $PWD "release/$releaseName.zip"
$releaseRequired = @(
  'app/build/bin/Index-VT.exe', 'LICENSE', 'COPYRIGHT',
  'THIRD_PARTY_NOTICES.md', 'docs/releases/README.txt',
  'frontend/public/licenses/OFL-PublicSans.txt',
  'frontend/public/licenses/OFL-NotoSansSC.txt',
  'frontend/public/licenses/OFL-GeistMono.txt'
)
foreach ($releaseInput in $releaseRequired) {
  if (-not (Test-Path -LiteralPath $releaseInput -PathType Leaf)) {
    throw "Missing release input: $releaseInput"
  }
}
foreach ($noticeGroup in @('frontend', 'go')) {
  $noticeDir = Join-Path $PWD "release/notices/$noticeGroup"
  $noticeFiles = @(Get-ChildItem -LiteralPath $noticeDir -File -Recurse -ErrorAction SilentlyContinue)
  if ($noticeFiles.Count -eq 0) { throw "Missing dependency notices: $noticeDir" }
}
if ((Test-Path -LiteralPath $releaseStage) -or (Test-Path -LiteralPath $releaseZip)) {
  throw 'Staging folder or archive already exists; choose a new version or review it manually.'
}
New-Item -ItemType Directory -Path "$releaseStage/licenses/fonts" -Force | Out-Null
Copy-Item -LiteralPath app/build/bin/Index-VT.exe -Destination $releaseStage
Copy-Item -LiteralPath LICENSE,COPYRIGHT,THIRD_PARTY_NOTICES.md -Destination $releaseStage
Copy-Item -LiteralPath docs/releases/README.txt -Destination $releaseStage
Get-ChildItem -LiteralPath frontend/public/licenses -File | Copy-Item -Destination "$releaseStage/licenses/fonts"
foreach ($noticeGroup in @('frontend', 'go')) {
  Copy-Item -LiteralPath "release/notices/$noticeGroup" -Destination "$releaseStage/licenses" -Recurse
}
Compress-Archive -LiteralPath $releaseStage -DestinationPath $releaseZip
$releaseHash = (Get-FileHash -LiteralPath $releaseZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$releaseHash  $releaseName.zip" | Set-Content -LiteralPath release/SHA256SUMS.txt -Encoding ascii
```

该示例按明确清单复制文件，不递归打包项目根目录，也不删除或覆盖现有暂存包。只检查声明目录非空并不能替代人工核对完整性。项目 MIT `LICENSE` 已提供；若尚未准备第三方声明目录，脚本仍会在准备检查中停止。多平台附件都准备好后统一生成所有 zip 的校验列表，不要沿用单包示例覆盖多包记录。

`THIRD_PARTY_NOTICES.md` 的相对链接针对源码仓库；离线附件以同包的 `licenses/` 完整文本为准。短版 `README.txt` 不依赖源码文档或截图路径，可直接随压缩包分发。

## Release notes 配置与正文

已增加两份文件：

- [`.github/release.yml`](../.github/release.yml)：按 breaking-change、feature/enhancement、bug/fix、documentation、dependencies 分类 PR；`skip-changelog` 可排除纯内部变化。
- [`.github/RELEASE_TEMPLATE.md`](../.github/RELEASE_TEMPLATE.md)：英文优先的双语正文，手动复制到 Release 编辑器，填入附件、环境和实际验证结果。GitHub 不会像 PR 模板那样自动套用这个文件。

分类规则只有在使用 GitHub 的“Generate release notes”时生效，按 PR 标签匹配，不会仅凭本地提交标题自动分类，也不会自动创建那些标签。它不会修改 Git 提交作者或 Contributors。规则来源见 [GitHub 官方文档](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)。

如果当前项目主要由本人直接提交，建议使用手写正文，说明本版真正变化、安装前提、升级步骤和未完成验证；不要为了填满版面制造贡献者或通过项。

## 发布操作

1. 检查待发布源码、许可证、作者身份和版本；提交准备好的改动，并确认标签将指向正确 commit。
2. 在真实可写目录测试准备发布的压缩包，不能只运行开发目录里的 exe。至少核查启动、引擎健康、短文翻译、字幕导入/导出、文档翻译/导出、正常退出与二次启动；未执行的项目如实列明。
3. 在 GitHub 选择 **Releases → Draft a new release**，选择明确的目标 commit/标签，填写版本标题并复制正文模板。
4. 上传 zip 与最终校验列表，注明 app-only 不含引擎/模型；选择 **pre-release**，先 **Save draft** 核对。
5. 确认附件、许可、下载说明、哈希和限制后再发布。未签名时如实说明，不宣称已做 Authenticode 签名。
6. 发布后记录标签及附件哈希，不用不同文件静默替换同版本附件；需要修正二进制时发布新的修订版本。

官方界面中的草稿、附件、预发布和发布步骤见 [GitHub Release 文档](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)。后续需要稳定下载入口时，再参考[链接到发行版](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)，使用真实仓库和实际存在的附件名。

## 以后需要 CI 时

可从手动触发的 Windows 构建开始：安装固定工具链 → `npm ci` → 相关测试 → 项目完整构建脚本 → 从明确文件清单打包 → 上传构建附件。模型质量和原生 GUI 验收另记，不要求 CI 自动下载全部模型。

等这个过程稳定后，再考虑创建 **Release 草稿** 的独立任务。令牌只在确有需要的发布步骤授予相应权限，源码提交继续使用维护者的本人身份。当前没有增加会自动发布、提交代码或写入用户数据的 Actions 工作流。
