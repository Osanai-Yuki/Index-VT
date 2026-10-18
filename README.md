# Index-VT

**Local translation for text, subtitles, and long documents on Windows.**

English · [简体中文](README.zh-CN.md)

I built Index-VT to keep translation, terminology, and subtitle editing in one desktop workspace. It runs IndexTeam's translation models through a local `llama-server` process, so the text you translate stays on your computer. Once the engine and models are installed, translation works offline; model downloads require a network connection.

Developed and maintained by **Osanai-Yuki**. This is an independent desktop application; the upstream models and inference engine belong to their respective authors.

> **Development preview.** The workflows below are implemented, but testing on real hardware is still in progress. The interface is primarily Simplified Chinese, with some English labels. These two README versions do not imply a fully localized English interface.

![Index-VT translation workspace](docs/assets/screenshots/translation-light.png)

*Translation workspace, captured on 2026-10-17 with development demo data. Screenshots illustrate the interface; they are not translation-quality or performance benchmarks.*

## What you can do

| Workspace | Features |
| --- | --- |
| Text translation | Streaming output, source/target language selection, built-in and custom translation presets, terminology hints, local history and favorites. |
| Subtitles | Import SRT, ASS, VTT, and LRC; translate a queue; pause, cancel, and retry failures; edit text and timing; split/merge cues; shift/calibrate timing; undo/redo edits; export translated or bilingual subtitles. |
| Long documents | Import TXT or Markdown, translate in chunks with Index-Nailong, continue an interrupted task during the same application session, inspect terminology matches, and export translation or bilingual text. |
| Models and terminology | Download supported GGUF models, choose Q4_K_M or Q8_0, manage detected model files, and create/import/export glossary books using CSV or TSV. |
| Desktop controls | Light/dark/system themes, inference settings, local diagnostics, startup model loading, and automatic model release after inactivity. |

![Index-VT subtitle workspace](docs/assets/screenshots/subtitles.png)

*Subtitle workspace with demo cues. The built-in preview is intended for editing; check complex ASS effects in your target player.*

## Getting started

### Requirements

- **Windows 10/11, x64**, with Microsoft Edge WebView2 Runtime. This project currently targets Windows only.
- A compatible Windows build of **[llama.cpp](https://github.com/ggml-org/llama.cpp/releases)**, including `llama-server.exe` and the DLLs from that build.
- At least one supported GGUF model. An NVIDIA GPU with a compatible CUDA runtime is optional; CPU inference is available but speed depends on your machine.
- Enough disk space for the application, runtime, selected models, and local data. A Q4_K_M model is roughly 1.3 GB; Q8_0 is roughly 2.2 GB. These are model-file sizes, not RAM or VRAM requirements.

### Set up a portable folder

If a release is available in this repository's **Releases** section, read its asset description first. An application-only archive does **not** contain the inference engine or models. GitHub's automatically generated source archives are source code, not a runnable Windows package.

Extract the application to a writable folder and arrange the runtime like this:

```text
Index-VT/
├── Index-VT.exe
├── thirdparty/
│   └── llama-server/
│       ├── llama-server.exe
│       └── ... DLLs from the same runtime build
├── models/                  # created by the application
└── logs/                    # diagnostics, when logging is enabled
```

1. Start `Index-VT.exe` and follow the first-run setup.
2. Download **Index-Translate-2B / Q4_K_M** as a starting point, or place an official supported model file in `models/` before startup.
3. Open the translation workspace, choose a target language, and translate a short sample.
4. Download Nailong or Homura only when you need their specialized workflows.

Models and runtime binaries are excluded from the source repository. A fresh clone needs them too; cloning the project alone does not install the engine.

### Supported model roles

| Model | Used for | Current application scope |
| --- | --- | --- |
| [Index-Translate-2B](https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF) | General text and subtitle translation | Language selection, translation constraints, and glossary hints. |
| [Index-Nailong-2B](https://huggingface.co/IndexTeam/Index-Nailong-2B-GGUF) | Long documents | Chinese ↔ English and Chinese ↔ Japanese. TXT/Markdown content is treated as text; exact formatting is not guaranteed. |
| [Index-Homura-2B](https://huggingface.co/IndexTeam/Index-Homura-2B-GGUF) | Dubbing-oriented text translation | Approximate syllable-budget control. This application does not synthesize audio or dub video. |

The model manager supports **Q4_K_M** and **Q8_0**. For manual installation, keep the official file names, for example `Index-Translate-2B.Q4_K_M.gguf`. Downloads support resuming and Hugging Face/ModelScope sources; installation requires a successful checksum verification. If verification cannot be completed, the partial download is kept for a retry.

### Everyday use

- **Text:** choose the languages and a preset, enter your text, then translate. `Ctrl+Enter` starts a translation; `Esc` cancels it.
- **Subtitles:** import a file, choose a language and optional glossary, translate, inspect the result, then export. Cancel the active queue before editing. Undo history is limited to 20 steps and a memory budget; starting a new translation clears it.
- **Documents:** import a TXT/MD file and select one of the supported directions. The current import limit is **2 MiB and 50,000 Unicode characters**. Export the result before closing the application.
- **Glossaries:** manage books in the model/terminology workspace. Entries guide the model through the prompt; they are not guaranteed text replacements or a semantic consistency score.

After setup, the saved default model loads at startup. With no active task, **30 minutes without input** starts a **30-second countdown** to release the model; interaction cancels the countdown, and a later task loads the model again.

## Your files and privacy

The normal portable layout keeps data beside the executable:

| Location | Contents |
| --- | --- |
| `models/*.gguf` | Downloaded model weights. |
| `models/data/indexvt.db` | Local settings, text history, glossary books, and model records. |
| `logs/` | Application/engine logs and diagnostic archives, if enabled. |

The app sends inference requests to `127.0.0.1`; translation does not need a cloud API key. There is no application telemetry. Model downloads contact the configured model host. Logging is off by default; changing it requires a restart. Diagnostic files may contain local paths, so inspect them before sharing.

**Export subtitle and document work before exiting.** Switching pages preserves the current session, but those workspaces do not automatically restore unfinished work after a full application restart. Back up the portable folder with the application closed if you want to retain models, settings, history, and glossaries. Development builds can resolve their data folder above the executable; see the [development guide](docs/DEVELOPMENT.md).

## Build from source

The stack is **Go / Wails v2 / React / TypeScript / Tailwind CSS / SQLite / llama.cpp**.

Install Go **1.25 or newer** (the selected dependency versions may require a newer toolchain), Node.js **22 or newer**, and Wails CLI **v2.16.0** with its Windows build prerequisites. Run the following in PowerShell from the repository root:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
npm --prefix frontend ci
node scripts/build.mjs
```

The executable is written to `app/build/bin/Index-VT.exe`. Add the runtime/model files as described above to use it.

**Use the build script for a production build.** It builds the frontend, copies it into Go's embed directory, and then builds the executable. A direct `wails build` does not perform that synchronization in this repository and can embed an older interface.

For local development, test commands, and browser demos, see [DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Current limitations

I am still validating real Windows workflows and translation quality across representative material. Browser checks with demo data do not establish model quality or complete native-dialog coverage.

- Translation can omit, distort, or invent content. Check important output against the source; terminology-match counts are review hints.
- Full restart recovery is not available for subtitle/document sessions. A document continuation uses the original task's direction and terminology.
- Complex ASS styling and behavior can differ from external players. Document chunking can change whitespace and layout.
- Homura's syllable count and the displayed GPU-memory estimates are approximate; neither is a hardware or output guarantee.
- Real IME input, unusual display scaling, interrupted downloads, low disk space, CPU performance, and driver/OOM recovery still need broader acceptance testing.

Existing engineering records are indexed in [docs/README.md](docs/README.md). They are dated evidence, not a promise that every scenario has passed on every machine.

## Feedback

When reporting a problem, include the application version (`Index-VT.exe -version`), Windows version, GPU/CPU, model and quantization, selected context size, and the steps to reproduce. A small input you are comfortable sharing is more useful than an entire private document. Attach logs only after checking their contents.

## Copyright and licensing

**Copyright (c) 2026 Osanai-Yuki.** This notice covers original project work; third-party materials retain their own ownership and terms. See [COPYRIGHT](COPYRIGHT) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Original Index-VT code, documentation, and interface assets are available under the **[MIT License](LICENSE)**. Model weights, fonts, dependencies, and runtime binaries retain their respective upstream licenses. See the [licensing guide](docs/LICENSING.zh-CN.md) for scope and distribution details.

Maintainer resources: [release guide](docs/RELEASING.zh-CN.md) · [file cleanup review](docs/CLEANUP-2026-10-18.md).
