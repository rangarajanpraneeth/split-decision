#!/usr/bin/env python3
"""Inline css/ and js/ into a single portable HTML file.

Optional: the multi-file version is what gets deployed. This produces one file
you can email, drop on a USB stick, or open with no web server at all.
"""
import re, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text()

css = (root / "css/app.css").read_text()
html = html.replace('<link rel="stylesheet" href="css/app.css">',
                    "<style>\n" + css + "\n</style>")
# the webfont is a progressive enhancement: keep the link, fall back to system mono


def inline(match):
    src = match.group(1)
    code = (root / src).read_text()
    return "<script>\n" + code + "\n</script>"

html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
out = root / "blackjack-trainer-standalone.html"
out.write_text(html)
print(f"wrote {out} ({len(html)//1024} KB)")
