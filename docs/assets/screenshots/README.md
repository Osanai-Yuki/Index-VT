# README screenshots

Updated on **2026-10-19**. Both public documentation images have been regenerated from the production frontend currently embedded in `app/build/bin/Index-VT.exe`. The capture checks that every JS, CSS, and font asset is present byte-for-byte in that executable before rendering it in Chromium.

| Published asset | Content |
| --- | --- |
| `translation-light.png` | Chinese source text and English translation, with the corresponding sample history item selected. |
| `subtitles.png` | Eight Chinese-to-English subtitle cues, all completed, with the first cue's detail panel open. |

The images show the current production interface, rendered at **1440 × 900** in the light theme. They are browser renders of the embedded application frontend, rather than captures of the native Windows window. The native window could not be captured reliably in this execution environment.

All source text, translations, history, subtitle rows, and status values come from an isolated screenshot fixture. The translations are predefined examples; no model inference or hardware measurements are represented. GPU memory figures and inference-speed figures are omitted. No existing user database, glossary, or document is used by this rendering fixture.

The previous 2026-10-17 images remain in their dated review directory as historical evidence. They are no longer used by either README. Both language versions share the two refreshed assets above.

## Reproduce

With the current exe and its matching `app/frontenddist/` available, run from the repository root:

```powershell
node scripts/capture-readme.mjs
```

The helper requires the installed frontend Playwright dependency and system Chrome. It serves the embedded frontend locally, blocks external browser requests, loads the public fixture, and replaces the two images. It does not start the inference engine or access runtime user data. Update both README captions when refreshing them on a later date.

[capture.json](capture.json) records the source commit, executable hash, embedded asset hashes, sample text, render method, image dimensions, and image hashes for this capture. It documents visual provenance, not end-to-end native application validation.

Original Index-VT interface work: Copyright (c) 2026 Osanai-Yuki. Fonts, icons, and any included third-party material retain their own terms; see the root third-party notices.
