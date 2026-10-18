"""Repair the family/style records of an already-built woff2, in place.

Why this is separate from build-subsets.py: rebuilding a subset is not the only
way to fix a name table, and it is often the wrong way. Re-subsetting pulls the
whole upstream glyph repertoire with it (layout alternates, per-axis deltas), so
a shipped 1.8 MB CJK face comes back at 2.0 MB and the executable grows for a
metadata correction. Rewriting six name records touches no outline, no cmap and
no layout table, so coverage and file size are preserved exactly.

The defect this exists for: subsetting a variable font rewrites `fvar`, and the
subsetter can leave the family records naming the *default instance*. The shipped
files announced themselves as "Noto Sans SC Thin" (a 400-600 axis) and
"Archivo SemiBold" (likewise). Nothing resolves CSS from those records, but any
font inspector or installer does.

Run: python tools/fonts/fix-name-table.py <woff2> "<Family>" [--style Regular]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTFont

# Identity records, as opposed to instance-specific ones (which fvar owns).
IDENTITY_IDS = (1, 2, 4, 6, 16, 17)
LABELS = {1: "family", 2: "subfamily", 4: "full name", 6: "postscript", 16: "typo family", 17: "typo subfamily"}


def set_name(font: TTFont, name_id: int, value: str) -> None:
    name = font["name"]
    targets = {(r.platformID, r.platEncID, r.langID) for r in name.names if r.nameID == name_id}
    if not targets:
        targets = {(3, 1, 0x409)}
    for platform_id, encoding_id, language_id in targets:
        try:
            name.setName(value, name_id, platform_id, encoding_id, language_id)
        except Exception as exc:  # pragma: no cover - legacy encodings reject some strings
            print(f"    warn: could not set id {name_id} on ({platform_id},{encoding_id},{language_id}): {exc}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("font")
    parser.add_argument("family")
    parser.add_argument("--style", default="Regular")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv[1:])

    path = Path(args.font)
    if not path.is_file():
        raise SystemExit(f"not found: {path}")

    size_before = path.stat().st_size
    font = TTFont(path)
    try:
        before = {nid: font["name"].getDebugName(nid) for nid in IDENTITY_IDS}
        cmap_before = len(font.getBestCmap())
        glyphs_before = font["maxp"].numGlyphs

        set_name(font, 1, args.family)
        set_name(font, 2, args.style)
        set_name(font, 4, f"{args.family} {args.style}")
        set_name(font, 6, f"{args.family.replace(' ', '')}-{args.style.replace(' ', '')}")
        set_name(font, 16, args.family)
        set_name(font, 17, args.style)

        after = {nid: font["name"].getDebugName(nid) for nid in IDENTITY_IDS}
        print(f"{path.name}")
        for nid in IDENTITY_IDS:
            marker = "  " if before[nid] == after[nid] else "->"
            print(f"  {marker} {LABELS[nid]:14s}: {before[nid]!r} -> {after[nid]!r}")
        copyright_text = font["name"].getDebugName(0) or ""
        print(f"     copyright     : {copyright_text[:110]!r}")

        if args.dry_run:
            print("  (dry run, nothing written)")
            return 0

        font.flavor = "woff2"
        font.save(str(path))
    finally:
        font.close()

    # Re-read to prove nothing but the name table changed.
    check = TTFont(path)
    try:
        cmap_after = len(check.getBestCmap())
        glyphs_after = check["maxp"].numGlyphs
    finally:
        check.close()

    size_after = path.stat().st_size
    ok = cmap_after == cmap_before and glyphs_after == glyphs_before
    print(
        f"  coverage: {cmap_before} -> {cmap_after} codepoints, "
        f"{glyphs_before} -> {glyphs_after} glyphs   {'OK' if ok else 'CHANGED (unexpected)'}"
    )
    print(f"  size    : {size_before / 1024:,.1f} KB -> {size_after / 1024:,.1f} KB")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
