#!/usr/bin/env python3
"""Build a WGT for Apps2Samsung to sign for the target TV."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "dist" / "USBShare-Tizen5-unsigned.wgt"
FILES = {
    "config.xml": ROOT / "config.xml",
    "index.html": ROOT / "app" / "index.html",
    "launcher.js": ROOT / "app" / "launcher.js",
    "app/app.js": ROOT / "app" / "app.js",
    "service/index.js": ROOT / "service" / "index.js",
    "service/server.js": ROOT / "service" / "server.js",
}


def png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def icon_png():
    size = 128
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            # A simple USB fork on a navy tile. No external image tools needed.
            stem = 60 <= x <= 67 and 40 <= y <= 91
            top = 54 <= x <= 73 and 29 <= y <= 40
            left = 38 <= x <= 62 and 65 <= y <= 72
            right = 66 <= x <= 90 and 52 <= y <= 59
            left_tip = 33 <= x <= 43 and 62 <= y <= 75
            right_tip = 84 <= x <= 96 and 46 <= y <= 64
            base = 54 <= x <= 73 and 88 <= y <= 102
            raw.extend((241, 247, 255, 255) if stem or top or left or right or left_tip or right_tip or base else (16, 35, 65, 255))
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return signature + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + png_chunk(b"IEND", b"")


def add(archive, name, content):
    info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    archive.writestr(info, content)


def main():
    OUTPUT.parent.mkdir(exist_ok=True)
    with ZipFile(OUTPUT, "w") as archive:
        for name, source in FILES.items():
            add(archive, name, source.read_bytes())
        add(archive, "icon.png", icon_png())
    print(OUTPUT)


if __name__ == "__main__":
    main()
