"""Dump the exact character set a font covers into a plain text file.

One codepoint per line plus a header comment, so the file diffs cleanly in git
and can be fed straight back into build-subsets.py as --chars-file. This is how
a replacement font is held to the *same* coverage contract as the font it
replaces: dump the old, subsample the new with that list, then diff the two
dumps and expect only intentional differences.

Run: python tools/fonts/dump-charset.py <font> <out.txt>
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont


def dump(font_path: Path, out_path: Path) -> int:
    font = TTFont(font_path)
    try:
        codepoints = sorted(font.getBestCmap())
        glyphs = font["maxp"].numGlyphs
    finally:
        font.close()

    lines = [
        f"# charset dump of {font_path.name}",
        f"# codepoints={len(codepoints)} glyphs={glyphs}",
        "# one Unicode codepoint per line, U+XXXX (4-6 hex digits)",
        "",
    ]
    lines.extend(f"U+{cp:04X}" for cp in codepoints)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{font_path.name}: {len(codepoints)} codepoints / {glyphs} glyphs -> {out_path}")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    return dump(Path(argv[1]), Path(argv[2]))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
