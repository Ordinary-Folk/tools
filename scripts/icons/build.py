#!/usr/bin/env python3
"""Builds the KBar icons for tools.ordinary.co/scripts from scripts/catalog.json.

Per tool: <id>.svg and <id>.png (128 px) = the coloured tile with the ink glyph,
exactly as the page draws it; <id>-mono.svg / <id>-mono.png = the light glyph
on transparent, for people who keep KBar monochrome. Plus of-kbar-icons.zip
with everything and a README. Stdlib only.

    python3 scripts/icons/build.py          # from the hub repo root
"""
import io
import json
import os
import struct
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, '..', 'catalog.json')
INK = '#14161A'
LIGHT = '#EDEFF3'
SCALE = 8  # 16 px grid -> 128 px PNG


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def runs(glyph):
    """Horizontal runs of # per row: (x, y, width)."""
    out = []
    for y, row in enumerate(glyph):
        x = 0
        while x < 16:
            if row[x] == '#':
                x0 = x
                while x < 16 and row[x] == '#':
                    x += 1
                out.append((x0, y, x - x0))
            else:
                x += 1
    return out


def svg(glyph, bg, fg):
    d = ''.join('M%d %dh%dv1h-%dz' % (x, y, w, w) for x, y, w in runs(glyph))
    rect = '<rect width="16" height="16" fill="%s"/>' % bg if bg else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="128" height="128" '
            'shape-rendering="crispEdges">%s<path d="%s" fill="%s"/></svg>' % (rect, d, fg))


def png(glyph, bg, fg):
    w = h = 16 * SCALE
    bgc = bytes(hex_rgb(bg) + (255,)) if bg else bytes((0, 0, 0, 0))
    fgc = bytes(hex_rgb(fg) + (255,))
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        row = glyph[y // SCALE]
        for x in range(w):
            raw += fgc if row[x // SCALE] == '#' else bgc

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
            + chunk(b'IEND', b''))


def main():
    cat = json.load(open(CATALOG, encoding='utf-8'))
    tiles = cat['tile']
    made = []
    zbuf = io.BytesIO()
    z = zipfile.ZipFile(zbuf, 'w', zipfile.ZIP_DEFLATED)
    for tool in cat['tools']:
        glyph = tool['glyph']
        assert len(glyph) == 16 and all(len(r) == 16 for r in glyph), tool['id']
        bg = tiles[tool['tile']]
        files = {
            tool['id'] + '.svg': svg(glyph, bg, INK if tool['tile'] != 'ink' else LIGHT).encode(),
            tool['id'] + '.png': png(glyph, bg, INK if tool['tile'] != 'ink' else LIGHT),
            tool['id'] + '-mono.svg': svg(glyph, None, LIGHT).encode(),
            tool['id'] + '-mono.png': png(glyph, None, LIGHT),
        }
        for name, data in files.items():
            with open(os.path.join(HERE, name), 'wb') as f:
                f.write(data)
            nice = tool['name'] + (' (mono)' if '-mono' in name else '') + os.path.splitext(name)[1]
            z.writestr('OF KBar icons/' + ('mono/' if '-mono' in name else '') + nice, data)
        made.append(tool['id'])
    landing = cat['landing']['glyph']
    with open(os.path.join(HERE, 'landing.svg'), 'w') as f:
        f.write(svg(landing, None, INK))
    z.writestr('OF KBar icons/README.txt',
               'OF KBar icons\n\nOne icon per OF script, the same tiles as tools.ordinary.co/scripts.\n'
               'KBar 3: edit a button > Icon > Image > pick the PNG (or SVG). The mono folder has the\n'
               'same glyphs in light grey on transparent for a monochrome toolbar.\n')
    z.close()
    with open(os.path.join(HERE, 'of-kbar-icons.zip'), 'wb') as f:
        f.write(zbuf.getvalue())
    print('icons:', ', '.join(made))
    print('zip: %d bytes' % len(zbuf.getvalue()))


if __name__ == '__main__':
    main()
