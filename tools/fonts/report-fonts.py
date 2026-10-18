"""Report each candidate font's identity, licence metadata and variable axes.

The Reserved Font Name question cannot be answered from a font's family name: the
OFL text that ships with the file is authoritative, and the `name` table records
what the vendor considers the family/copyright strings. This prints both, so a
substitution decision cites the file it actually ships rather than the README.

Run: python tools/fonts/report-fonts.py .font-work/upstream/*.ttf
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

NAME_IDS = {
    0: "copyright",
    1: "family",
    2: "subfamily",
    4: "full name",
    5: "version",
    6: "postscript",
    13: "license",
    14: "license URL",
    16: "typo family",
    17: "typo subfamily",
}


def report(path: Path) -> None:
    font = TTFont(path, lazy=True)
    try:
        print(f"=== {path.name}  ({path.stat().st_size / 1024:,.0f} KB)")
        name = font["name"]
        for nid, label in NAME_IDS.items():
            value = name.getDebugName(nid)
            if not value:
                continue
            value = " ".join(value.split())
            if len(value) > 220:
                value = value[:217] + "..."
            print(f"    {label:14s}: {value}")
        fvar = font.get("fvar")
        if fvar is not None:
            axes = ", ".join(
                f"{a.axisTag} {a.minValue:g}-{a.maxValue:g}" for a in fvar.axes
            )
            print(f"    axes          : {axes}")
        else:
            print("    axes          : (static)")
        print(f"    glyphs        : {font['maxp'].numGlyphs}")
    finally:
        font.close()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    for raw in argv[1:]:
        path = Path(raw)
        if not path.is_file():
            print(f"missing: {path}", file=sys.stderr)
            continue
        report(path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
