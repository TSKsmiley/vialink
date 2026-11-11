# SPDX-License-Identifier: GPL-2.0-or-later
"""
Compresses every fixtures/definitions/*.vial.json into *.vial.json.xz, the way
vial-qmk's util/vial_generate_definition.py embeds a definition in firmware:
the JSON is minified, then lzma.compress()'d (XZ container, CRC64).

Usage: python3 -I scripts/compress_fixtures.py
"""
import json
import lzma
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "definitions"

for src in sorted(ROOT.glob("*.vial.json")):
    payload = json.dumps(json.loads(src.read_text(encoding="utf-8")), separators=(",", ":")).encode("utf-8")
    out = src.with_suffix(".json.xz")
    out.write_bytes(lzma.compress(payload))
    print("{} -> {} ({} bytes)".format(src.name, out.name, out.stat().st_size))
