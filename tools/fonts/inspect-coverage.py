"""Read the embedded CJK subset's cmap and report its exact codepoint coverage.

Purpose: the new CJK font must reproduce the *same* coverage contract as the
current noto-sans-sc-cjk-wght400-600.woff2, so we can substitute the family
without losing characters that today already render correctly.

Run: python tools/fonts/inspect-coverage.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

FONT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "src" / "assets" / "fonts"


def ranges(codepoints: list[int]) -> list[tuple[int, int]]:
    """Collapse a sorted codepoint list into inclusive (start, end) ranges."""
    out: list[tuple[int, int]] = []
    for cp in codepoints:
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def main() -> int:
    for path in sorted(FONT_DIR.glob("*.woff2")):
        font = TTFont(path)
        cmap = font.getBestCmap()
        cps = sorted(cmap)
        print(f"=== {path.name}")
        print(f"    codepoints : {len(cps)}")
        print(f"    glyphs     : {font['maxp'].numGlyphs}")
        axes = font.get("fvar")
        if axes is not None:
            for axis in axes.axes:
                print(
                    f"    axis       : {axis.axisTag} "
                    f"{axis.minValue}..{axis.maxValue} default={axis.defaultValue}"
                )
        else:
            print("    axis       : (static font)")
        print(f"    ranges     : {len(ranges(cps))}")
        for start, end in ranges(cps):
            print(f"      U+{start:04X}-U+{end:04X}")
        font.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
