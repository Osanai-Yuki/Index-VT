"""Build every candidate to the same subset contract, for comparison.

Fair comparison needs identical inputs: the same charset file, the same weight
clamp, the same subsetter options. This wraps build-subsets.py so a candidate's
shipped size and coverage are measured on the artifact that would actually ship,
not on an upstream multi-megabyte download.

Run: python tools/fonts/compare-candidates.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORK = REPO / ".font-work"
UPSTREAM = WORK / "upstream"
OUT = WORK / "subsets"
CHARSETS = HERE / "charsets"

# (output stem, upstream file, charset file, weight range)
CANDIDATES = {
    "latin-ui": [
        ("Archivo", "Archivo.ttf", "latin-ui.txt", "400:600"),
        ("PublicSans", "PublicSans.ttf", "latin-ui.txt", "400:600"),
        ("GolosText", "GolosText.ttf", "latin-ui.txt", "400:600"),
        ("SchibstedGrotesk", "SchibstedGrotesk.ttf", "latin-ui.txt", "400:600"),
        ("InstrumentSans", "InstrumentSans.ttf", "latin-ui.txt", "400:600"),
        ("WorkSans", "WorkSans.ttf", "latin-ui.txt", "400:600"),
    ],
    "latin-mono": [
        ("JetBrainsMono", "JetBrainsMono.ttf", "latin-mono.txt", "400:500"),
        ("GeistMono", "GeistMono.ttf", "latin-mono.txt", "400:500"),
    ],
}


def run(command: list[str]) -> int:
    return subprocess.call(command, cwd=REPO)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failures = 0
    for group, entries in CANDIDATES.items():
        print(f"\n### {group}")
        for stem, upstream_name, charset, weights in entries:
            upstream = UPSTREAM / upstream_name
            if not upstream.is_file():
                print(f"  SKIP {stem}: missing {upstream}")
                failures += 1
                continue
            target = OUT / f"{group}--{stem}.woff2"
            code = run(
                [
                    sys.executable,
                    str(HERE / "build-subsets.py"),
                    "--input",
                    str(upstream),
                    "--output",
                    str(target),
                    "--chars-file",
                    str(CHARSETS / charset),
                    "--weight-range",
                    weights,
                ]
            )
            if code != 0:
                print(f"  FAIL {stem} (exit {code})")
                failures += 1
    print(f"\nsubsets written to {OUT}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
