"""Check whether candidate upstream fonts carry the glyphs our charsets ask for.

A charset file is a *contract*: it records which codepoints must render. When a
replacement font simply does not contain one of them, no build flag fixes it —
the character falls back to the system font (which the font stack already
provides for). This reports that per font so the gap is a recorded decision
rather than a surprise in the UI.

Run: python tools/fonts/check-glyph-gaps.py
"""
from __future__ import annotations

import sys
import unicodedata
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

# (upstream font, charset it must serve, label)
PAIRS = [
    (".font-work/upstream/PublicSans.ttf", "tools/fonts/charsets/latin-ui.txt", "Public Sans → latin-ui"),
    (".font-work/upstream/Archivo.ttf", "tools/fonts/charsets/latin-ui.txt", "Archivo → latin-ui"),
    (".font-work/upstream/GeistMono.ttf", "tools/fonts/charsets/latin-mono.txt", "Geist Mono → latin-mono"),
    (
        ".font-work/upstream/JetBrainsMono.ttf",
        "tools/fonts/charsets/latin-mono.txt",
        "JetBrains Mono → latin-mono",
    ),
    (".font-work/upstream/NotoSansSC.ttf", "tools/fonts/charsets/cjk.txt", "Noto Sans SC → cjk"),
]


def read_charset(path: Path) -> set[int]:
    out: set[int] = set()
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("U+"):
            out.add(int(line[2:], 16))
    return out


def name_of(cp: int) -> str:
    if cp < 0x20:
        return f"<control U+{cp:04X}>"
    return unicodedata.name(chr(cp), f"U+{cp:04X}")


def main() -> int:
    for rel_font, rel_charset, label in PAIRS:
        font_path = REPO / rel_font
        charset_path = REPO / rel_charset
        if not font_path.is_file():
            print(f"{label:28s} SKIP (missing {rel_font})")
            continue
        font = TTFont(font_path, lazy=True)
        try:
            cmap = set(font.getBestCmap())
        finally:
            font.close()
        wanted = read_charset(charset_path)
        missing = sorted(wanted - cmap)
        status = "complete" if not missing else f"{len(missing)} absent upstream"
        print(f"{label:28s} {len(wanted):5d} requested, {len(wanted & cmap):5d} present — {status}")
        for cp in missing:
            print(f"      U+{cp:04X}  {name_of(cp)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
