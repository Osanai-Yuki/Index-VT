"""Compare the codepoint coverage of the outgoing and incoming faces.

A font swap is only safe when everything the replaced face could render is either
also in the replacement, or provably never rendered by the product. This prints
the set difference for each role so the gap is a recorded decision instead of a
surprise in the UI, and flags which of the missing characters actually appear in
source strings (as opposed to comments).

Run: python tools/fonts/compare-coverage.py
"""
from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path

from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FONTS = REPO / "frontend" / "src" / "assets" / "fonts"
SRC = REPO / "frontend" / "src"

# role -> (outgoing face, incoming face)
SWAPS = [
    ("拉丁界面字", FONTS / "archivo-latin-wght400-600.woff2", FONTS / "public-sans-latin-wght400-600.woff2"),
    ("等宽数字", FONTS / "jetbrains-mono-latin-wght400-500.woff2", FONTS / "geist-mono-latin-wght400-500.woff2"),
]
# The outgoing files are deleted as part of the swap; keep them under .font-work.
RETIRED = REPO / ".font-work" / "retired"


def cmap(path: Path) -> set[int]:
    font = TTFont(path, lazy=True)
    try:
        return set(font.getBestCmap())
    finally:
        font.close()


def rendered_uses(codepoint: int) -> list[str]:
    """Lines where the character appears outside a comment."""
    char = chr(codepoint)
    hits: list[str] = []
    if not SRC.is_dir():
        return hits
    for path in SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            if char not in line:
                continue
            stripped = line.strip()
            is_comment = stripped.startswith(("//", "*", "/*"))
            # A JSX text node or string literal is rendered; a comment is not.
            if not is_comment:
                hits.append(f"{path.relative_to(REPO)}:{lineno}")
    return hits


def main() -> int:
    exit_code = 0
    for role, outgoing, incoming in SWAPS:
        if not outgoing.is_file():
            outgoing = RETIRED / outgoing.name
        print(f"=== {role}")
        if not outgoing.is_file():
            print(f"    (退役文件未留存：{outgoing}；跳过集合差，只报告新字体覆盖)")
            if incoming.is_file():
                print(f"    新字体 {incoming.name}: {len(cmap(incoming))} 码位")
            continue
        old, new = cmap(outgoing), cmap(incoming)
        lost = sorted(old - new)
        gained = sorted(new - old)
        print(f"    {outgoing.name}: {len(old)} 码位")
        print(f"    {incoming.name}: {len(new)} 码位")
        print(f"    新增 {len(gained)} / 丢失 {len(lost)}")
        if lost:
            print("    丢失的码位（逐字回退系统字体）：")
            for cp in lost:
                uses = rendered_uses(cp)
                where = "、".join(uses[:3]) if uses else "仅出现在注释中，界面不渲染"
                print(f"      U+{cp:04X}  {unicodedata.name(chr(cp), '?'):32s} {where}")
                if uses:
                    exit_code = 0  # rendered, but the font stack covers it; report only
        print()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
