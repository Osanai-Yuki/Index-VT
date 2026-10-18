"""Summarize the CJK subset's coverage by Unicode block.

Reads the baseline dump produced by inspect-coverage.py and reports how many
codepoints the embedded subset covers per block, so a replacement font's subset
can be built to the same or better coverage.
"""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

BASELINE = Path(__file__).resolve().parent / "coverage-baseline.txt"


def block_of(cp: int) -> str:
    if cp < 0x2000:
        return "latin/punct"
    if 0x2000 <= cp < 0x2E80:
        return "general punctuation"
    if 0x2E80 <= cp < 0x3000:
        return "CJK radicals / kangxi"
    if 0x3000 <= cp < 0x3040:
        return "CJK symbols + punctuation"
    if 0x3040 <= cp < 0x30A0:
        return "hiragana"
    if 0x30A0 <= cp < 0x3100:
        return "katakana"
    if 0x3100 <= cp < 0x3200:
        return "bopomofo / hangul compat"
    if 0x3200 <= cp < 0x3300:
        return "enclosed CJK"
    if 0x3300 <= cp < 0x3400:
        return "CJK compatibility"
    if 0x3400 <= cp < 0x4E00:
        return "CJK ext A"
    if 0x4E00 <= cp < 0xA000:
        return "CJK unified ideographs"
    if 0xF900 <= cp < 0xFB00:
        return "CJK compat ideographs"
    if 0xFE30 <= cp < 0xFF00:
        return "CJK compat forms"
    if 0xFF00 <= cp < 0xFFF0:
        return "fullwidth / halfwidth"
    return "other"


def main() -> int:
    text = BASELINE.read_text(encoding="utf-8")
    if "noto-sans-sc-cjk" not in text:
        print("baseline missing the CJK font section", file=sys.stderr)
        return 1
    section = text.split("noto-sans-sc-cjk-wght400-600.woff2", 1)[1]
    pairs = re.findall(r"U\+([0-9A-F]{4,6})-U\+([0-9A-F]{4,6})", section)
    groups: dict[str, list[tuple[int, int]]] = defaultdict(list)
    total = 0
    for raw_start, raw_end in pairs:
        start, end = int(raw_start, 16), int(raw_end, 16)
        total += end - start + 1
        groups[block_of(start)].append((start, end))
    print(f"CJK subset ranges={len(pairs)} codepoints={total}")
    for name, spans in groups.items():
        count = sum(end - start + 1 for start, end in spans)
        lo = min(start for start, _ in spans)
        hi = max(end for _, end in spans)
        print(f"  {name:28s} ranges={len(spans):4d} cps={count:5d} U+{lo:04X}..U+{hi:04X}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
