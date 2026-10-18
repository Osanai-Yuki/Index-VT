<!-- Copy into the GitHub Release editor. This file is not applied automatically.
Replace every placeholder and remove these instructions before publishing.
Use only checks you actually performed on the final package. -->

# Index-VT <version>

Local text, subtitle, and long-document translation for Windows x64.

**Channel:** <development preview / stable>  
**Source:** <tag and commit>  
**Application version (`-version`):** <actual output>

## Changes

- <User-visible change and its effect.>
- <Fix or limitation worth calling out.>

## Downloads and requirements

| Asset | Contents | Additional setup |
| --- | --- | --- |
| `<exact app-only zip name>` | Application and license notices | Install a compatible llama-server runtime and download a supported model. |
| `SHA256SUMS.txt` | SHA-256 for the attached archives | Compare with the downloaded file. |

Requires Windows 10/11 x64 and WebView2 Runtime. The interface is primarily
Simplified Chinese. This application-only package does **not** include model
weights or the inference engine. The automatic source-code downloads are not
the runnable application.

Extract to a writable folder. Place `llama-server.exe` and its matching DLLs
in `thirdparty/llama-server/` beside `Index-VT.exe`, then follow first-run setup.

**Runtime tested:** <llama.cpp tag/build, CPU/CUDA backend, driver if relevant>  
**Models tested:** <model, quantization, context size>

## Upgrading and local data

Close the app before replacing files. Keep your existing `models/` directory,
including `models/data/indexvt.db`; it contains local settings, history, and
glossaries. Export subtitle and document work before closing: unfinished
sessions do not automatically return after a full restart.

## Verification and known limitations

- **Tested on the final package:** <actual Windows/hardware and scenarios>.
- **Automated checks:** <commands/results; distinguish mock UI from real inference>.
- **Not yet verified:** <specific scenarios>.
- **Known limitations:** <release-specific issues and workarounds>.
- **Code signing:** <actual signing status; do not imply an unsigned build is signed>.

## Licensing

Original application work: Copyright (c) 2026 Osanai-Yuki.
Project license: MIT; the complete license is included as `LICENSE` in the archive.
Fonts, models, dependencies, and runtime files retain their upstream terms;
see the included notices and `licenses/`.

---

## 中文说明

本版为 <预览版 / 正式版>，适用于 Windows x64，界面以简体中文为主。

- **主要变化：**<与英文一致的实际变化>。
- **下载：**选择上表中的应用 zip；仅应用包不含模型和引擎，源码包也不能直接运行。
- **准备：**安装 WebView2，把兼容的 llama-server 及同版 DLL 放入应用旁的 `thirdparty/llama-server/`，再按首次引导下载模型。
- **升级：**关闭程序后替换指定文件，保留 `models/` 和数据库；字幕/文档退出前先导出，不支持跨程序重启恢复。
- **验证：**<实际验证的机器、模型和场景>；<仍未验证的项目>。
- **限制：**<本版已知问题与处理方式>。
- **许可：**原创部分 Copyright (c) 2026 Osanai-Yuki，采用 MIT 协议，全文随包提供于 `LICENSE`；第三方条款分别保留。
