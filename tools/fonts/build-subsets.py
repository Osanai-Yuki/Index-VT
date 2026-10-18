"""Build the three self-hosted woff2 subsets the UI ships.

Why this exists: the app is an offline desktop build, so every font must be a
local woff2 with a `unicode-range` that keeps the Latin and CJK faces from
capturing each other's characters. Hand-built subsets rot silently — this script
is the reproducible source of truth, and --verify re-checks a built file against
its charset list so a regeneration cannot quietly drop coverage.

Typical use:

    # 1. Snapshot the family's own coverage, or reuse a previous charset file.
    python tools/fonts/dump-charset.py <upstream.ttf> <charset.txt>

    # 2. Build a subset.
    python tools/fonts/build-subsets.py --input <upstream.ttf> --chars-file <charset.txt> \
        --weight-range 400:600 --output frontend/src/assets/fonts/<name>.woff2

    # 3. Prove the built file covers what was asked for.
    python tools/fonts/build-subsets.py --verify frontend/src/assets/fonts/<name>.woff2 \
        --chars-file <charset.txt>

Fonts stay variable (the wght axis is kept, optionally clamped) because the
design system uses exactly three weights — 400 / 500 / 600 — and a variable axis
carries all three in one file at less than the cost of three statics.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

CODEPOINT = re.compile(r"^U\+([0-9A-Fa-f]{4,6})$")


def read_charset(path: Path) -> set[int]:
    """Read a charset file: comments and blank lines ignored, one U+XXXX per line."""
    codepoints: set[int] = set()
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = CODEPOINT.match(line)
        if not match:
            raise SystemExit(f"{path}:{lineno}: not a U+XXXX codepoint: {line!r}")
        codepoints.add(int(match.group(1), 16))
    if not codepoints:
        raise SystemExit(f"{path}: no codepoints found")
    return codepoints


def parse_weight_range(value: str) -> tuple[float, float]:
    try:
        low, high = value.split(":", 1)
        return float(low), float(high)
    except ValueError:
        raise SystemExit(f"--weight-range must look like 400:600, got {value!r}") from None


# name IDs that describe the *font's* identity rather than a specific instance.
NAME_FAMILY = 1
NAME_SUBFAMILY = 2
NAME_FULL = 4
NAME_POSTSCRIPT = 6
NAME_TYPO_FAMILY = 16
NAME_TYPO_SUBFAMILY = 17


def set_name(font: TTFont, name_id: int, value: str) -> None:
    """Set a name record across every platform/encoding the font already uses."""
    name = font["name"]
    platforms = {(r.platformID, r.platEncID, r.langID) for r in name.names if r.nameID == name_id}
    if not platforms:
        # Fall back to the records any other name ID uses, so a record that is
        # absent upstream still lands somewhere sensible.
        platforms = {(r.platformID, r.platEncID, r.langID) for r in name.names}
    name.setName(value, name_id, 3, 1, 0x409)  # Windows / Unicode BMP / en-US
    for platform_id, encoding_id, language_id in platforms:
        if (platform_id, encoding_id, language_id) == (3, 1, 0x409):
            continue
        try:
            name.setName(value, name_id, platform_id, encoding_id, language_id)
        except Exception:
            # A non-Unicode legacy encoding may reject the string; the Windows
            # Unicode record already carries it.
            continue


def normalize_names(font: TTFont, family: str, style: str) -> None:
    """Give a subset a coherent identity instead of inheriting a stray instance name.

    Subsetting a variable font rewrites `fvar`, and the subsetter can leave the
    family records naming the *default instance* rather than the family. That is
    how a 400-600 variable file ends up announcing itself as "… Thin" or
    "… SemiBold": nothing resolves CSS from those records, but any font manager,
    installer or inspector that does will report a weight the file cannot render.

    Setting them explicitly also matters legally: when a licence reserves a font
    name, the primary name presented to users is what the reservation governs, so
    it must be a deliberate choice recorded here rather than an accident of the
    upstream build.
    """
    set_name(font, NAME_FAMILY, family)
    set_name(font, NAME_SUBFAMILY, style)
    set_name(font, NAME_FULL, f"{family} {style}")
    set_name(font, NAME_POSTSCRIPT, f"{family.replace(' ', '')}-{style.replace(' ', '')}")
    set_name(font, NAME_TYPO_FAMILY, family)
    set_name(font, NAME_TYPO_SUBFAMILY, style)
    if "fvar" in font:
        # Named instances keep the family stem; only their subfamily varies.
        for instance in font["fvar"].instances:
            current = font["name"].getDebugName(instance.subfamilyNameID) or ""
            stem = current.split(" ")[0] if current else style
            if stem and stem != current:
                set_name(font, instance.subfamilyNameID, f"{family} {stem}")


def describe(path: Path) -> None:
    font = TTFont(path)
    try:
        cmap = font.getBestCmap()
        axes = font.get("fvar")
        axis_text = (
            ", ".join(
                f"{a.axisTag} {a.minValue:g}..{a.maxValue:g}" for a in axes.axes
            )
            if axes is not None
            else "static"
        )
        print(
            f"  {path.name}: {len(cmap)} codepoints, {font['maxp'].numGlyphs} glyphs, "
            f"axes={axis_text}, {path.stat().st_size / 1024:.1f} KB"
        )
    finally:
        font.close()


def build(args: argparse.Namespace) -> int:
    source = Path(args.input)
    target = Path(args.output)
    if not source.is_file():
        raise SystemExit(f"input font not found: {source}")

    codepoints = read_charset(Path(args.chars_file))
    if args.extra_chars:
        extra = read_charset(Path(args.extra_chars))
        print(f"merging {len(extra)} codepoints from {args.extra_chars}")
        codepoints |= extra

    options = subset.Options()
    # Keep the variable axis so 400/500/600 all come from one file, and keep the
    # layout tables and hinting metadata the browser needs to shape and align text.
    options.drop_tables += ["DSIG"]
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.canonical_order = True
    options.prune_unicode_ranges = True
    options.retain_gids = False
    options.desubroutinize = False
    options.hinting = True
    if args.flavor:
        options.flavor = args.flavor
    if args.no_subset_tables:
        # Keep shaping/layout tables intact: subsetting them is what breaks
        # complex-script mark positioning, and the size win is negligible here.
        options.drop_tables = list(options.drop_tables)

    font = subset.load_font(str(source), options)
    try:
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(font)

        if args.weight_range:
            low, high = parse_weight_range(args.weight_range)
            fvar = font.get("fvar")
            if fvar is None:
                raise SystemExit(
                    f"--weight-range given but {source.name} has no variation axis"
                )
            for axis in fvar.axes:
                if axis.axisTag != "wght":
                    continue
                axis.minValue = max(axis.minValue, low)
                axis.maxValue = min(axis.maxValue, high)
                axis.defaultValue = min(max(axis.defaultValue, low), high)
                print(f"  clamped wght axis to {axis.minValue:g}..{axis.maxValue:g}")
    # A variable axis the design system never drives is pure weight in the
    # file: a face may ship a `wdth` axis that no CSS touches, and its deltas
    # alone can take a latin subset from 18 KB to 93 KB. Pin such an axis at its
    # default so only the axes the UI actually uses survive.
        for tag in args.drop_axis or []:
            fvar = font.get("fvar")
            if fvar is None or tag not in {a.axisTag for a in fvar.axes}:
                print(f"  axis {tag}: not present, nothing to drop")
                continue
            before = len(font.getBestCmap())
            font = instancer.instantiateVariableFont(font, {tag: None}, inplace=False)
            print(
                f"  dropped axis {tag} (pinned at default); "
                f"{before} codepoints preserved"
            )
        # instance records outside the clamped range would advertise weights the
        # file can no longer render
        if "fvar" in font and args.weight_range:
            low, high = parse_weight_range(args.weight_range)
            fvar = font["fvar"]
            fvar.instances = [
                i
                for i in fvar.instances
                if all(
                    low <= i.coordinates.get(a.axisTag, a.defaultValue) <= high
                    for a in fvar.axes
                )
            ]

        target.parent.mkdir(parents=True, exist_ok=True)
        if args.family_name:
            normalize_names(font, args.family_name, args.style_name)
            print(f"  family name set to '{args.family_name}' / '{args.style_name}'")
        subset.save_font(font, str(target), options)
    finally:
        font.close()

    print(f"built {target}")
    describe(target)
    return 0


def verify(args: argparse.Namespace) -> int:
    target = Path(args.verify)
    font = TTFont(target)
    try:
        covered = set(font.getBestCmap())
        glyphs = font["maxp"].numGlyphs
        family = font["name"].getDebugName(1) or ""
        typo_family = font["name"].getDebugName(16) or ""
        copyright_text = font["name"].getDebugName(0) or ""
    finally:
        font.close()

    expected = read_charset(Path(args.chars_file))
    missing = sorted(expected - covered)
    print(f"{target.name}: {len(covered)} codepoints ({glyphs} glyphs)")
    print(f"  family      : {family!r}  (typographic: {typo_family!r})")
    print(f"  copyright   : {copyright_text[:100]!r}")
    print(f"  requested   : {len(expected)}")
    print(f"  missing     : {len(missing)}")
    ok = True
    if args.expect_family and family != args.expect_family:
        print(f"  FAIL family  : expected {args.expect_family!r}")
        ok = False
    for reserved in args.reserved_name or []:
        if reserved.lower() in family.lower():
            print(f"  FAIL reserved font name {reserved!r} appears in the family name")
            ok = False
    if not copyright_text:
        print("  FAIL copyright: name ID 0 is empty (OFL §2 wants the notice to travel)")
        ok = False
    if missing:
        preview = " ".join(f"U+{cp:04X}" for cp in missing[:40])
        print(f"  first missing: {preview}")
        ok = False
    return 0 if ok else 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="upstream font (.ttf/.otf/.woff2)")
    parser.add_argument("--output", help="woff2 to write")
    parser.add_argument("--chars-file", help="charset list, one U+XXXX per line")
    parser.add_argument(
        "--extra-chars", help="second charset list merged into the first"
    )
    parser.add_argument("--weight-range", help="clamp the wght axis, e.g. 400:600")
    parser.add_argument(
        "--drop-axis",
        action="append",
        help="pin a variable axis the UI never drives at its default (e.g. wdth); "
        "repeatable",
    )
    parser.add_argument(
        "--flavor", default="woff2", help="woff2 (default) or none for a raw ttf"
    )
    parser.add_argument(
        "--family-name",
        help="set the family name records to this (a subset of a variable font "
        "otherwise inherits a stray instance name such as 'Thin' or 'SemiBold')",
    )
    parser.add_argument("--style-name", default="Regular", help="subfamily/typographic subfamily")
    parser.add_argument(
        "--expect-family", help="with --verify: assert the built family name equals this"
    )
    parser.add_argument(
        "--reserved-name",
        action="append",
        help="with --verify: assert this OFL Reserved Font Name does not appear in the family",
    )
    parser.add_argument(
        "--no-subset-tables", action="store_true", help="accepted for compatibility"
    )
    parser.add_argument("--verify", help="verify an existing file instead of building")
    args = parser.parse_args(argv[1:])

    if args.verify:
        if not args.chars_file:
            raise SystemExit("--verify requires --chars-file")
        return verify(args)
    if not (args.input and args.output and args.chars_file):
        parser.print_help()
        return 2
    return build(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
