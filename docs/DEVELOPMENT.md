# Development

[Project overview](../README.md) · [文档索引](README.md)

This guide describes the current Windows repository layout. Run commands from the repository root unless a block explicitly changes directory. Examples use PowerShell.

## Prerequisites

- Windows x64 and WebView2 Runtime.
- Go: the module declares `go 1.25.0`; selected dependencies can require a newer toolchain. Allow Go's normal toolchain selection or install a recent compatible release. Check `go version` and `go env GOTOOLCHAIN` if dependency resolution fails.
- Node.js 22+ and npm; install the versions resolved by `frontend/package-lock.json` using `npm ci`.
- Wails CLI v2.16.0 and its Windows build prerequisites.
- `llama-server.exe`, its matching DLLs, and a supported model for real inference. Browser demos do not need them.

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0
wails doctor
npm --prefix frontend ci
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `app/` | Go module, Wails entry point, platform integration, application bindings. |
| `app/internal/` | Inference orchestration, model downloads, subtitles, document pipeline, data store, and tests. |
| `app/build/windows/` | Windows resource templates, manifest, and icon. Keep these source assets. |
| `frontend/src/` | React UI, state, themes, and the Wails adapter. |
| `frontend/wailsjs/` | Generated bridge declarations/runtime. The UI imports types from this copy. |
| `scripts/` | Repository-level production build. |
| `frontend/scripts/` | UI verification and screenshot tools. |
| `tools/fonts/` | Font subset generation, inspection, and charset contracts. |
| `docs/` | Public guides and dated engineering/acceptance records. |
| `models/`, `thirdparty/`, `logs/` | Local runtime assets and data; excluded from Git. |

`app/frontend/wailsjs/` is another tracked generated bridge copy. It appears redundant with the configured frontend path, but removal is pending a separate regeneration/build check and the maintainer's cleanup approval. Do not replace or delete the active `frontend/wailsjs/` types as a shortcut.

## Production build

```powershell
node scripts/build.mjs
```

The script performs three steps:

1. `npm run build` in `frontend/` (design lint, TypeScript checking, Vite).
2. Replace `app/frontenddist/` with `frontend/dist/`.
3. Build `app/build/bin/Index-VT.exe` using Wails for `windows/amd64`.

The copy is required by Go's `//go:embed all:frontenddist`. Calling `wails build` directly does not synchronize that directory. If `app/frontenddist/` was removed, restore it through a full build before testing/compiling the main package.

```powershell
# Only after a previous frontend build, and only when its sources have not changed:
node scripts/build.mjs --skip-frontend

# Print the application's embedded version without starting its UI:
& ./app/build/bin/Index-VT.exe -version
```

An embedded version string and a file timestamp do not prove what source was built. For a release, record the commit, toolchain/runtime versions, and the SHA-256 of the final archive as described in the [release guide](RELEASING.zh-CN.md).

## Development sessions

For the desktop app with frontend/backend development tooling:

```powershell
Push-Location app
wails dev
Pop-Location
```

For a browser-only interface demo:

```powershell
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open the following URLs in a browser while that server is running:

| URL | View |
| --- | --- |
| `http://127.0.0.1:5173/?mock&page=translate` | Translation workspace with demo history. |
| `http://127.0.0.1:5173/?mock&page=subtitle` | Subtitle workspace; import uses demo cues. |
| `http://127.0.0.1:5173/?mock&page=doc` | Document workspace with a development backend. |
| `http://127.0.0.1:5173/?mock&page=model` | Model/terminology workspace. |
| `http://127.0.0.1:5173/?mock&fresh=1` | First-run setup. |
| `http://127.0.0.1:5173/?primitives` | UI component gallery used by several checks. |

The mock backend is a development tool. Its successful responses, apparent GPU usage, and sample translations are not evidence of real model behavior. A plain browser session without `?mock` has no Go backend.

To refresh the public README images, run `node scripts/capture-readme.mjs` with a built exe and matching `app/frontenddist/`. This renders the exact embedded production frontend with an isolated public sample fixture. It does not use the development mock page or run model inference. See the [capture notes](assets/screenshots/README.md) for provenance and requirements.

## Verification

Run the relevant existing checks after a code change:

```powershell
Push-Location app
go test ./...
Pop-Location

npm --prefix frontend run build
npm --prefix frontend run verify:all
npm --prefix frontend run verify:pages
```

Browser checks require Playwright's Chromium installation:

```powershell
Push-Location frontend
npx playwright install chromium
Pop-Location
```

Additional targeted commands:

```powershell
npm --prefix frontend run verify:glossary
npm --prefix frontend run verify:workflows
```

The 2026-10-17 record explicitly states that `verify:workflows` was not executed in that review. Listing its command here does not change that status. Native Windows dialog, IME, driver, download-failure, and translation-quality checks remain separate from browser tests. Inspect scripts before running a native verification session; some start the real application and write dated reports.

Several verification tools currently write into `docs/review-2026-10-17/`. Preserve that path until those tools and document references are migrated together.

## Runtime data and diagnostics

The base folder is resolved in this order:

1. `INDEXVT_ROOT`, if explicitly set for this process.
2. The executable's directory, then up to four parents, looking for an assembled runtime (`llama-server.exe` or a complete GGUF model).
3. The executable's directory as a fallback.

This lets an executable under `app/build/bin/` reuse the repository's local `thirdparty/` and `models/`. An empty `models/` folder or an incomplete `.part` file alone does not identify an assembled root. The database is `models/data/indexvt.db`; do not treat the whole model directory as disposable download cache.

Use an isolated `INDEXVT_ROOT` only with a dedicated test data folder and matching runtime/model assets. Do not point an experimental build at valuable user data unintentionally.

Logging is off by default. After enabling it in Settings, restart the app. The log cleanup action may skip files that are in use. Review local paths and document information before sharing diagnostics; never add the database, private input files, or model weights to a release archive.

## Source and release boundaries

Keep tests, lockfiles, Windows build resources, font licenses, and active bridge types in source control. Keep dependency folders, generated bundles, executables, model files, user data, and runtime DLLs outside source commits. `.gitignore` prevents accidental additions but does not untrack files already committed.

Before publishing, synchronize version values in `app/main.go`, `app/wails.json`, `frontend/package.json`, and the root package entry in `frontend/package-lock.json`. See [licensing](LICENSING.zh-CN.md), [releases](RELEASING.zh-CN.md), and the [cleanup review](CLEANUP-2026-10-18.md).
