# Index-VT

**在 Windows 上本地完成文本、字幕和长文档翻译。**

[English](README.md) · 简体中文

我开发 Index-VT，是想把翻译、术语管理和字幕编辑放进同一个桌面工作区。应用通过本机的 `llama-server` 运行 IndexTeam 翻译模型，待翻译文本留在自己的电脑上。准备好引擎和模型后，翻译无需联网；模型下载需要网络。

开发与维护：**Osanai-Yuki**。这是独立开发的桌面应用，所使用的上游模型和推理引擎归各自作者所有。

> **当前为开发预览阶段。** 下列工作流已经实现，但真实硬件与 Windows 操作场景仍在验收。界面以简体中文为主，带部分英文标签；中英文 README 不代表已经提供完整的英文界面。

![Index-VT 主翻译台](docs/assets/screenshots/translation-light.png)

*主翻译台截图，摄于 2026-10-17，使用开发演示数据。截图用于展示界面，不代表真实模型的翻译质量或性能测试结果。*

## 可以做什么

| 工作区 | 功能 |
| --- | --- |
| 文本翻译 | 流式输出、源语言与目标语言选择、内置和自定义翻译模式、术语提示、本地历史与收藏。 |
| 字幕工作台 | 导入 SRT、ASS、VTT、LRC；队列翻译、暂停、取消和失败重试；编辑文本与时间；拆分、合并、平移与校准；撤销/重做；导出译文或双语字幕。 |
| 长文档 | 导入 TXT 或 Markdown，以 Index-Nailong 分块翻译；同一次应用会话内继续中断任务；检查术语命中；导出译文或双语对照。 |
| 模型与术语 | 下载受支持的 GGUF 模型，选择 Q4_K_M 或 Q8_0，管理识别出的模型文件；新建、导入、导出 CSV/TSV 术语本。 |
| 桌面设置 | 浅色、深色与跟随系统主题；推理参数；本地诊断；启动加载默认模型；空闲后释放模型。 |

![Index-VT 字幕工作台](docs/assets/screenshots/subtitles.png)

*字幕工作台使用演示字幕。内置预览用于编辑，复杂 ASS 效果请在实际使用的播放器中检查。*

## 开始使用

### 环境要求

- **Windows 10/11，x64**，并安装 Microsoft Edge WebView2 Runtime。目前只面向 Windows。
- 可兼容的 **[llama.cpp Windows 发行包](https://github.com/ggml-org/llama.cpp/releases)**，包括 `llama-server.exe` 及同一构建附带的 DLL。
- 至少一个受支持的 GGUF 模型。NVIDIA GPU 和对应 CUDA 运行环境为可选项；可以使用 CPU，速度取决于硬件。
- 为应用、引擎、模型和本地数据预留空间。单个 Q4_K_M 模型约 1.3 GB，Q8_0 约 2.2 GB；这是模型文件大小，不是运行内存或显存要求。

### 准备便携目录

如果本仓库的 **Releases** 中已有发行版，请先阅读附件说明。仅应用包不含推理引擎或模型；GitHub 自动生成的源码压缩包也不是可直接运行的 Windows 安装包。

将应用解压到可写目录，按下面的结构放置引擎：

```text
Index-VT/
├── Index-VT.exe
├── thirdparty/
│   └── llama-server/
│       ├── llama-server.exe
│       └── ... 同一引擎发行包附带的 DLL
├── models/                  # 应用自动创建
└── logs/                    # 启用日志后保存诊断信息
```

1. 打开 `Index-VT.exe`，按首次引导准备环境。
2. 建议先下载 **Index-Translate-2B / Q4_K_M**；也可以在启动前把受支持的官方模型文件放入 `models/`。
3. 在主翻译台选择目标语言，用一小段文本确认环境可用。
4. 需要长文档或配音文本约束时，再下载 Nailong 或 Homura。

源码仓库不包含模型和引擎二进制。自行克隆项目也需要补齐这些文件。

### 三个模型的分工

| 模型 | 用途 | 当前应用范围 |
| --- | --- | --- |
| [Index-Translate-2B](https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF) | 通用文本、字幕翻译 | 语言选择、翻译约束和术语提示。 |
| [Index-Nailong-2B](https://huggingface.co/IndexTeam/Index-Nailong-2B-GGUF) | 长文档翻译 | 中文 ↔ 英文、中文 ↔ 日文。TXT/Markdown 按文本处理，不保证原排版完全保留。 |
| [Index-Homura-2B](https://huggingface.co/IndexTeam/Index-Homura-2B-GGUF) | 面向配音的文本翻译 | 近似音节预算控制。本应用不合成音频，也不直接为视频配音。 |

模型管理支持 **Q4_K_M**、**Q8_0**。手动放置时保留官方文件名，例如 `Index-Translate-2B.Q4_K_M.gguf`。下载支持 Hugging Face / ModelScope 源和断点续传；只有校验通过才安装，无法完成校验时保留下载进度供重试。

### 常用操作

- **文本：**选择语言和模式后翻译；`Ctrl+Enter` 开始，`Esc` 取消。
- **字幕：**导入文件、选择语言和可选术语本，翻译后检查并导出。编辑前先取消活动队列。撤销历史最多 20 步，并受内存预算限制；开始新一轮翻译会清空撤销历史。
- **文档：**导入 TXT/MD，选择受支持的方向。当前导入上限为 **2 MiB 且不超过 50,000 个 Unicode 字符**。关闭应用前导出结果。
- **术语：**在模型与术语工作区维护术语本。术语通过提示影响模型，不是机械替换；命中计数也不等于语义一致性评分。

完成引导后，应用在启动时加载保存的默认模型。没有活动任务且 **30 分钟无操作**时，会提示 **30 秒倒计时**后释放模型；继续操作会取消倒计时，后续翻译会重新加载模型。

## 数据与隐私

正常便携布局下，数据位于可执行文件旁：

| 路径 | 内容 |
| --- | --- |
| `models/*.gguf` | 下载的模型权重。 |
| `models/data/indexvt.db` | 设置、文本历史、术语本和模型登记信息。 |
| `logs/` | 启用日志后生成的应用日志、引擎日志及诊断包。 |

应用向 `127.0.0.1` 发起推理请求，翻译不需要云端 API Key，没有应用遥测。模型下载会访问所选模型托管站点。日志默认关闭，修改日志开关后需重启；诊断信息可能包含本机路径，分享前请检查内容。

**退出前请导出字幕和文档。** 切换页面会保留本次会话，但应用完全关闭后，字幕和文档工作区不会自动恢复未完成内容。备份时先关闭应用，再复制整个便携目录，以保留模型、设置、历史和术语本。开发环境可能使用可执行文件上层的资源目录，详见[开发指南](docs/DEVELOPMENT.md)。

## 从源码构建

技术栈：**Go / Wails v2 / React / TypeScript / Tailwind CSS / SQLite / llama.cpp**。

安装 Go **1.25 或更新版本**（锁定的依赖可能要求更新的工具链）、Node.js **22 或更新版本**、Wails CLI **v2.16.0** 及其 Windows 构建依赖。在仓库根目录用 PowerShell 执行：

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
npm --prefix frontend ci
node scripts/build.mjs
```

输出为 `app/build/bin/Index-VT.exe`，运行前按前文补齐引擎和模型。

**生产构建请使用脚本。** 它先构建前端，再同步到 Go 的嵌入目录，最后编译应用。当前项目直接执行 `wails build` 不会完成这次同步，可能把旧界面编进新程序。

热更新、测试命令和浏览器演示见 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 当前限制

我仍在补充真实 Windows 工作流与代表性材料的翻译质量验收。浏览器演示测试不能替代真实模型和原生对话框验证。

- 模型可能漏译、误译或增添内容，重要译文请对照原文检查；术语命中只提供审阅线索。
- 字幕和文档不支持跨应用重启恢复。文档续跑沿用任务开始时的方向与术语。
- 复杂 ASS 样式在不同播放器中可能有差异；文档分块也可能改变空白与排版。
- Homura 音节数和界面中的显存估算均为近似值，不是输出或硬件适配保证。
- 真实输入法、特殊缩放、下载中断、磁盘不足、CPU 性能和驱动/OOM 恢复仍需更广泛验收。

既有工程记录见[文档索引](docs/README.md)。这些是注明日期的验证资料，不代表所有场景都已在所有机器通过。

## 反馈问题

请提供应用版本（`Index-VT.exe -version`）、Windows 版本、GPU/CPU、模型与量化档位、上下文大小，以及复现步骤。可以公开的一小段样例比整份私人文档更便于定位；附日志前先检查其中的信息。

## 版权与许可

**Copyright (c) 2026 Osanai-Yuki。** 此声明针对项目原创部分，第三方材料保留各自权利和条款，见 [COPYRIGHT](COPYRIGHT) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Index-VT 原创代码、文档和界面资产采用 **[MIT 协议](LICENSE)**。模型、字体、依赖和运行时分别保留各自的上游许可；适用范围及分发要求见[许可指南](docs/LICENSING.zh-CN.md)。

维护文档：[发布指南](docs/RELEASING.zh-CN.md) · [文件清理记录与剩余候选](docs/CLEANUP-2026-10-18.md)。
