Index-VT — Windows x64
Copyright (c) 2026 Osanai-Yuki

ENGLISH

This is a desktop application for local text, subtitle, and long-document
translation. The interface is primarily Simplified Chinese.

If this archive is named "app-only", it does not contain llama-server or
model weights. Download a compatible Windows llama.cpp runtime from:
https://github.com/ggml-org/llama.cpp/releases
Keep llama-server.exe and its matching DLLs together under:
  thirdparty/llama-server/
beside Index-VT.exe. Microsoft Edge WebView2 Runtime is also required.

Extract to a writable folder. Start Index-VT.exe and follow first-run setup.
Begin with Index-Translate-2B / Q4_K_M in the model manager. Models can also
be installed manually in models/ using their official GGUF file names.
Model download requires a network connection; prepared translation runs
locally. No cloud API key is needed.

Models, local settings, text history, and glossary books live under models/.
Do not delete models/data/indexvt.db as cache. Close the app before backing
up the portable folder. Export subtitle/document results before exiting:
unfinished work in those workspaces is not automatically restored after a
full application restart.

For an upgrade, keep your models/ and data. Replace only the application
and any explicitly documented runtime files while the app is closed.

Check the release page for the actual version, runtime requirements,
known limitations, tested scenarios, and SHA-256 checksums. Model output
needs review. Homura mode translates text for dubbing constraints; this
application does not generate audio or dub video.

Original Index-VT project work is licensed under the MIT License; the complete
license must be supplied as LICENSE in the archive.
Third-party ownership and terms remain separate. Full dependency/font
license texts are supplied under licenses/. THIRD_PARTY_NOTICES.md is an
inventory; its source-repository links may require internet access.

简体中文

这是用于本地文本、字幕和长文档翻译的 Windows x64 桌面应用。
如果压缩包名称带 app-only，表示不含推理引擎和模型。
从上方 llama.cpp 官方发行页获取兼容的 Windows 引擎，将
llama-server.exe 及同一构建的 DLL 放入应用旁的 thirdparty/llama-server/。
电脑还需要 Microsoft Edge WebView2 Runtime。

解压到可写目录，打开 Index-VT.exe，跟随首次引导操作。
建议先在模型中心下载 Index-Translate-2B / Q4_K_M；模型也可按官方文件名
手动放入 models/。下载需要联网，准备完成后的翻译在本机运行，无需云端 Key。

模型、设置、文本历史和术语本位于 models/，不要把 models/data/indexvt.db
当缓存删除。备份前关闭程序。字幕和文档退出后不会自动恢复未完成会话，
关闭前请导出。升级时保留 models/ 和数据，只替换应用及明确要求的运行库。

具体版本、环境要求、验收范围、限制与 SHA-256 请阅读对应 Release 页面。
译文需要人工检查；Homura 模式只约束配音文本，不合成声音或直接制作视频配音。
项目原创部分采用 MIT 协议，全文见同包 LICENSE；第三方完整许可见 licenses/。
