# Third-party notices

Index-VT's original application work is Copyright (c) 2026 Osanai-Yuki and is licensed under the [MIT License](LICENSE). Third-party work is owned by its respective authors and retains its own license; the project's MIT license does not replace those terms.

This file is an inventory and packaging guide. **It is not a substitute for complete upstream license texts, nor a complete audit of every transitive dependency.** Before distributing a binary, collect notices for the exact versions actually included.

## Fonts included in the interface

The interface embeds modified/subset font files. Keep the following complete license files in source, the embedded frontend, and a readable `licenses/fonts/` folder in release packages:

| Font | Upstream copyright | Local license |
| --- | --- | --- |
| Public Sans | Copyright 2015 The Public Sans Project Authors | [OFL-PublicSans.txt](frontend/public/licenses/OFL-PublicSans.txt) |
| Noto Sans SC | Copyright 2014–2021 Adobe; Reserved Font Name: Source | [OFL-NotoSansSC.txt](frontend/public/licenses/OFL-NotoSansSC.txt) |
| Geist Mono | Copyright 2024 The Geist Project Authors | [OFL-GeistMono.txt](frontend/public/licenses/OFL-GeistMono.txt) |

All three are distributed under the **SIL Open Font License 1.1**. Font subsetting/modification has its own naming and notice requirements; see the [official OFL text](https://openfontlicense.org/open-font-license-official-text/). Do not delete font license files as development residue. The [local font report](docs/research/font-license-verification-2026.md) records how these assets were made.

## Application libraries

The direct frontend runtime dependencies are React, React DOM, Zustand, and Lucide React. The installed React/React DOM/Zustand license files state MIT; Lucide React's license states ISC and retains attribution for Feather-derived portions. Preserve the actual installed license texts, including those of transitive code included in the bundle.

The Go module also uses Wails v2, go-astisub, modernc SQLite, and the Go `x/sys` and `x/text` modules, plus their transitive dependencies. [Wails v2.16.0](https://github.com/wailsapp/wails/blob/v2.16.0/LICENSE) uses MIT. Other components must be checked against the exact module versions in `app/go.mod` and `app/go.sum`; a component list does not replace its notices.

Maintain a release-specific dependency inventory and copy each relevant license/NOTICE from the resolved source or installed package. SQLite's upstream status does not by itself cover the Go driver and all its dependencies.

## Inference engine and runtime libraries

The source repository excludes `thirdparty/`. If a release includes llama.cpp binaries, preserve the [llama.cpp MIT license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE) for the selected build. CUDA, Vulkan, BLAS, WebView2, and other runtime components can have their own redistribution terms. Package only the files from a known compatible runtime build and retain its applicable notices; the llama.cpp license alone does not cover every accompanying DLL.

## Model weights and reference material

Model weights are downloaded separately and are not included in source commits. As checked on 2026-10-18, the following upstream GGUF model cards identify Apache-2.0:

- [IndexTeam/Index-Translate-2B-GGUF](https://huggingface.co/IndexTeam/Index-Translate-2B-GGUF)
- [IndexTeam/Index-Nailong-2B-GGUF](https://huggingface.co/IndexTeam/Index-Nailong-2B-GGUF)
- [IndexTeam/Index-Homura-2B-GGUF](https://huggingface.co/IndexTeam/Index-Homura-2B-GGUF)

Check the exact model revision's full license and any notices before redistribution. The model-card label is a starting point, not a replacement for those files. Index-VT is an independent interface for these models and does not claim authorship of the weights.

`app/internal/translator/testdata/official/` contains upstream reference scripts and prompt material used for compatibility checks. Preserve their provenance and verify the applicable upstream license before publishing those files. Do not replace their attribution with the application author's name.

## Release record

For each release, retain the application's source commit, resolved dependency versions, runtime build/tag, model source revisions when relevant, and asset hashes. Supply complete notices under `licenses/` in the binary archive. Keep this inventory in sync when fonts, libraries, model sources, or runtime builds change.
