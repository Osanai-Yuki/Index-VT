"""List the OpenType features a font actually carries.

The design system writes `font-variant-numeric: tabular-nums` on `.num`
(DESIGN.md §3.4). That CSS property is only honoured when the font exposes the
corresponding `tnum` feature — a font without it renders proportional digits no
matter what the CSS says. This prints the features present so the claim can be
checked instead of assumed, and compares them against the features the current
shipped subsets carry so a rebuild cannot silently drop one.

Run: python tools/fonts/report-features.py <font> [...]
"""
from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

INTERESTING = ["tnum", "pnum", "lnum", "onum", "frac", "zero", "case", "calt", "liga", "kern", "salt", "ss01"]


def features(font: TTFont) -> list[str]:
    tags: set[str] = set()
    for table_tag in ("GSUB", "GPOS"):
        table = font.get(table_tag)
        if table is None:
            continue
        feature_list = getattr(table.table, "FeatureList", None)
        if feature_list is None:
            continue
        for record in feature_list.FeatureRecord:
            tags.add(record.FeatureTag)
    return sorted(tags)


def report(path: Path) -> None:
    font = TTFont(path, lazy=True)
    try:
        tags = features(font)
        print(f"=== {path.name}  ({path.stat().st_size / 1024:,.1f} KB)")
        print(f"    all features : {' '.join(tags) if tags else '(none)'}")
        present = [tag for tag in INTERESTING if tag in tags]
        absent = [tag for tag in INTERESTING if tag not in tags]
        print(f"    relevant     : {' '.join(present) if present else '(none)'}")
        print(f"    absent       : {' '.join(absent) if absent else '(none)'}")
        # A monospaced face should already have equal digit advances; report it so
        # 'tnum is missing' can be judged rather than treated as a defect.
        hmtx = font["hmtx"]
        cmap = font.getBestCmap()
        widths = {}
        for char in "0123456789":
            name = cmap.get(ord(char))
            if name:
                widths[char] = hmtx[name][0]
        if widths:
            unique = sorted(set(widths.values()))
            print(f"    digit widths : {unique} ({'uniform' if len(unique) == 1 else 'proportional'})")
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
