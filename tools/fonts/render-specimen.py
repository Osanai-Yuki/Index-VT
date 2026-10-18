"""Render type specimens of the app's real UI and screenshot them.

Metrics pick candidates; eyes pick the winner. This loads the actual subsetted
woff2 files that would ship, sets them in the design system's real type scale
(DESIGN.md §3.3) against the real surfaces and text colours, and writes PNGs
through Chromium so the choice is made by looking at the thing.

Files are inlined as data URIs: a file:// page cannot load a sibling font file
under CORS, and inlining also guarantees the screenshot shows the exact bytes
being evaluated.

Run: python tools/fonts/render-specimen.py
"""
from __future__ import annotations

import base64
import html
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORK = REPO / ".font-work"
SUBSETS = WORK / "subsets"
SHOTS = WORK / "shots"

# The design system's real type scale: size px, line-height, weight, token.
SCALE = [
    (20, 28, 600, "display"),
    (15, 22, 600, "title"),
    (15.5, 30, 400, "read"),
    (13.5, 22, 400, "body"),
    (12, 18, 400, "caption"),
    (11, 15, 500, "micro"),
]

READING = (
    "素笺是一份本地优先的翻译工作台。它把原文与译文并排放在同一行网格上，"
    "让校对成为阅读而不是比对。所有推理都在本机完成。"
)
UI_STRINGS = "开始翻译　模型中心　设置　导出字幕　批量队列　术语表　识别语言　目标语言"
NUMBERS = "00:12:34.567 ｜ 48.2 tok/s ｜ TTFT 312 ms ｜ VRAM 6.42/12.00 GB"
LATIN = "Translate  Model Hub  Settings  Export subtitles  Offline ready"
PUNCT = "「引号」（全角括号）、逗号，句号。冒号：分号； Handgloves 0123456789"
MIXED = "导入 SRTHandgloves 字幕文件，检测到 1284 行 cue。"


def data_uri(path: Path) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    mime = "font/woff2" if path.suffix == ".woff2" else "font/ttf"
    return f"data:{mime};base64,{payload}"


def face(family: str, path: Path) -> str:
    return (
        f"@font-face {{ font-family: '{family}'; font-style: normal; font-weight: 400 700; "
        f"font-display: block; src: url('{data_uri(path)}') format('woff2'); }}"
    )


def rows_for(families: list[str]) -> str:
    out = []
    for size, leading, weight, token in SCALE:
        cols = []
        for family in families:
            cols.append(
                f"<div class='col' data-font='{html.escape(family)}'>"
                f"<div class='chip'>{html.escape(family)}</div>"
                f"<p class='read'>{READING}</p>"
                f"<p class='ui'>{UI_STRINGS}</p>"
                f"<p class='num'>{NUMBERS}</p>"
                f"<p class='lat'>{LATIN}</p>"
                f"<p class='pun'>{PUNCT}</p>"
                f"<p class='mix'>{MIXED}</p>"
                f"<div class='ruler'>Hamburgefonstiv 汉 0123456789</div>"
                "</div>"
            )
        out.append(
            f"<section><h2>--text-{token} · {size}px / {leading} · w{weight}</h2>"
            f"<div class='grid' style='font-size:{size}px;line-height:{leading}px;font-weight:{weight}'>"
            + "".join(cols)
            + "</div></section>"
        )
    return "".join(out)


def page(title: str, fonts: list[tuple[str, Path]], body: str) -> str:
    faces = "".join(face(name, path) for name, path in fonts)
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>{html.escape(title)}</title><style>
{faces}
* {{ box-sizing: border-box; }}
body {{ margin: 0; padding: 28px; background: #FFFFFF; color: #000000;
  font-size: 13.5px; line-height: 1.6; -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility; }}
h1 {{ font-size: 20px; font-weight: 600; margin: 0 0 2px; font-family: sans-serif; }}
.sub {{ color: #6A6A6A; margin: 0 0 24px; font-size: 12px; font-family: sans-serif; }}
section {{ border-top: 1px solid #CCCCCC; padding: 12px 0 4px; }}
h2 {{ font-size: 11px; font-weight: 500; letter-spacing: .08em; margin: 0 0 10px;
  color: #404040; font-family: sans-serif; text-transform: uppercase; }}
.grid {{ display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 20px; }}
.col {{ min-width: 0; }}
.chip {{ font-family: sans-serif; font-size: 11px; font-weight: 500; color: #D40000;
  margin-bottom: 6px; letter-spacing: 0; }}
.col p {{ margin: 0 0 6px; overflow-wrap: anywhere; }}
.ruler {{ color: #6A6A6A; font-size: 11px; border-top: 1px solid #F0F0F0; padding-top: 4px; }}
</style></head><body>
<h1>{html.escape(title)}</h1>
<p class="sub">DESIGN.md §3.3 字阶 · 纯白底 / 纯黑墨 · 字重 400 / 500 / 600 · 直角网格</p>
{body}
</body></html>"""


def build_group(title: str, stem_prefix: str, out_html: Path) -> list[tuple[str, Path]]:
    fonts = []
    for path in sorted(SUBSETS.glob(f"{stem_prefix}--*.woff2")):
        label = path.stem.split("--", 1)[1]
        fonts.append((label, path))
    if not fonts:
        print(f"no subsets for {stem_prefix}", file=sys.stderr)
        return []
    out_html.write_text(page(title, fonts, rows_for([n for n, _ in fonts])), encoding="utf-8")
    print(f"wrote {out_html}  ({len(fonts)} candidates, {out_html.stat().st_size / 1024:,.0f} KB)")
    return fonts


def main() -> int:
    groups = [
        ("拉丁界面字候选 · Latin UI", "latin-ui", "specimen-latin-ui"),
        ("等宽数字候选 · Monospace", "latin-mono", "specimen-mono"),
    ]
    built: list[str] = []
    for title, prefix, out_stem in groups:
        print(f"\n### {title}")
        out_html = WORK / f"{out_stem}.html"
        if not build_group(title, prefix, out_html):
            continue
        built.append(str(out_html))
    print("\nnow screenshot them with the project's own browser harness:")
    print(f"  cd frontend && node scripts/shoot-specimen.mjs {' '.join(built)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
