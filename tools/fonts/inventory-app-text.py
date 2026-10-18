"""Inventory the characters the shipped UI can actually display.

Reads the built frontend (or the source tree as a fallback) and reports every
CJK codepoint present in the product's own strings. This is the honest floor for
a CJK subset: the app's own copy plus the classification labels and shortcuts it
renders. The embedded subset is deliberately built larger than this floor —
GB2312 plus punctuation — because user-supplied text (filenames, subtitle
lines, model output) is not knowable ahead of time and must not fall back to a
system font mid-sentence.

Run: python tools/fonts/inventory-app-text.py [--root frontend] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from collections import Counter
from pathlib import Path

SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json", ".md"}
BUILD_SUFFIXES = {".js", ".css", ".html"}
SKIP_DIRS = {"node_modules", "dist", ".git", "coverage"}


def is_interesting(char: str) -> bool:
    """True for scripts the embedded CJK face is expected to cover."""
    cp = ord(char)
    if char.isascii():
        return False
    if 0x2E80 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF:
        return True
    if 0xFF00 <= cp <= 0xFFEF:
        return True
    if 0x3000 <= cp <= 0x303F:
        return True
    return False


def iter_files(root: Path, suffixes: set[str]) -> list[Path]:
    found: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in suffixes:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        found.append(path)
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default="frontend")
    parser.add_argument("--json", help="also write the raw counts as JSON")
    args = parser.parse_args(argv[1:])

    root = Path(args.root).resolve()
    dist = root / "dist"
    scan_root, suffixes, label = (
        (dist, BUILD_SUFFIXES, "built frontend") if dist.is_dir() else (root, SOURCE_SUFFIXES, "source tree")
    )

    counter: Counter[str] = Counter()
    files = iter_files(scan_root, suffixes)
    for path in files:
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        counter.update(ch for ch in text if is_interesting(ch))

    cjk_like = {
        ch: n
        for ch, n in counter.items()
        if 0x4E00 <= ord(ch) <= 0x9FFF
    }
    print(f"scanned {len(files)} files under {scan_root} ({label})")
    print(f"distinct non-ASCII chars of interest : {len(counter)}")
    print(f"  of which CJK unified ideographs    : {len(cjk_like)}")
    print(f"total CJK ideograph occurrences      : {sum(cjk_like.values())}")
    print()
    print("top 40 by frequency:")
    for char, count in counter.most_common(40):
        name = unicodedata.name(char, "?")
        print(f"  U+{ord(char):04X} {char}  {count:6d}  {name}")

    if args.json:
        out = Path(args.json)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(
                {
                    "scan_root": str(scan_root),
                    "files": len(files),
                    "distinct": len(counter),
                    "cjk_ideographs": len(cjk_like),
                    "counts": {f"U+{ord(c):04X}": n for c, n in sorted(counter.items())},
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
