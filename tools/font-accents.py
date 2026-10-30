#!/usr/bin/env python3
"""
Adds the Portuguese accented letters (á à â ã é ê í ó ô õ ú ü ç and capitals)
to the game fonts that only ship plain Latin letters, so pt-BR text renders in
the game's own typefaces instead of falling back to a system font for those
letters.

Each new glyph is the font's own base letter plus an accent mark, scaled and
placed above (or, for the cedilla, below) the letter. The mark comes from the
same font when it has one (grave, acute, ^, ~, ¸, ¨), is mirrored from the
grave/acute when only one of them exists, and otherwise comes from a donor
font that has every mark. Fonts that already have the letters are left alone.

    python3 tools/font-accents.py <donor.ttf> <font.ttf> [<font.ttf> ...]

Requires fontTools (pip install fonttools). Fonts are rewritten in place.
"""
import sys

from fontTools.pens.recordingPen import DecomposingRecordingPen, RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

LETTERS = {
    'á': ('a', 'acute'), 'à': ('a', 'grave'), 'â': ('a', 'circumflex'), 'ã': ('a', 'tilde'),
    'é': ('e', 'acute'), 'ê': ('e', 'circumflex'), 'è': ('e', 'grave'),
    'í': ('i', 'acute'), 'ì': ('i', 'grave'), 'î': ('i', 'circumflex'),
    'ó': ('o', 'acute'), 'ô': ('o', 'circumflex'), 'õ': ('o', 'tilde'), 'ò': ('o', 'grave'),
    'ú': ('u', 'acute'), 'ü': ('u', 'dieresis'), 'ù': ('u', 'grave'),
    'ç': ('c', 'cedilla'),
    'Á': ('A', 'acute'), 'À': ('A', 'grave'), 'Â': ('A', 'circumflex'), 'Ã': ('A', 'tilde'),
    'É': ('E', 'acute'), 'Ê': ('E', 'circumflex'), 'È': ('E', 'grave'),
    'Í': ('I', 'acute'), 'Ì': ('I', 'grave'), 'Î': ('I', 'circumflex'),
    'Ó': ('O', 'acute'), 'Ô': ('O', 'circumflex'), 'Õ': ('O', 'tilde'), 'Ò': ('O', 'grave'),
    'Ú': ('U', 'acute'), 'Ü': ('U', 'dieresis'), 'Ù': ('U', 'grave'),
    'Ç': ('C', 'cedilla'),
}
# Candidate code points for each mark, preferred first.
MARKS = {
    'acute': [0xB4, 0x2CA],
    'grave': [0x60, 0x2CB],
    'circumflex': [0x2C6, 0x5E],
    'tilde': [0x2DC, 0x7E],
    'cedilla': [0xB8],
    'dieresis': [0xA8],
}
# Mark width relative to the base letter's width.
WIDTH = {'acute': 0.38, 'grave': 0.38, 'circumflex': 0.6, 'tilde': 0.66, 'dieresis': 0.62, 'cedilla': 0.42}
MAX_HEIGHT = {'acute': 0.2, 'grave': 0.2, 'circumflex': 0.16, 'tilde': 0.16, 'dieresis': 0.09, 'cedilla': 0.24}


def record(font, name):
    gs = font.getGlyphSet()
    pen = DecomposingRecordingPen(gs)
    gs[name].draw(pen)
    return pen


def bounds(font, rec):
    bp = BoundsPen(font.getGlyphSet())
    rec.replay(bp)
    return bp.bounds


def contours(rec):
    """Splits a recording into one recording per contour."""
    out, cur = [], []
    for op, args in rec.value:
        cur.append((op, args))
        if op in ('closePath', 'endPath'):
            r = RecordingPen()
            r.value = cur
            out.append(r)
            cur = []
    return out


def dotless(font, rec):
    """The letter i without its dot: drop contours that sit above the stem."""
    parts = contours(rec)
    if len(parts) < 2:
        return rec
    boxes = [bounds(font, p) for p in parts]
    stem = min(range(len(parts)), key=lambda i: boxes[i][1])  # lowest contour
    keep = RecordingPen()
    for i, p in enumerate(parts):
        if i == stem or boxes[i][1] < boxes[stem][3] * 0.6:
            keep.value += p.value
    return keep


def mark_source(font, donor, mark):
    """(recording, bounds, font it came from) of a mark."""
    for f in (font, donor):
        cmap = f.getBestCmap()
        for cp in MARKS[mark]:
            if cp in cmap:
                rec = record(f, cmap[cp])
                b = bounds(f, rec)
                # A tilde drawn almost flat would read as a macron.
                if b and mark == 'tilde' and (b[2] - b[0]) > 6 * (b[3] - b[1]):
                    continue
                return rec, b, f
        # acute <-> grave by mirroring the other one
        other = {'acute': 'grave', 'grave': 'acute'}.get(mark)
        if other:
            for cp in MARKS[other]:
                if cp in cmap:
                    rec = record(f, cmap[cp])
                    mirrored = RecordingPen()
                    rec.replay(ReverseContourPen(TransformPen(mirrored, (-1, 0, 0, 1, 0, 0))))
                    return mirrored, bounds(f, mirrored), f
    return None


def add_letters(path, donor):
    font = TTFont(path)
    cmap = font.getBestCmap()
    todo = [ch for ch in LETTERS if ord(ch) not in cmap]
    if not todo:
        print('%s: already complete' % path)
        return
    upm = font['head'].unitsPerEm
    glyf, hmtx = font['glyf'], font['hmtx']
    gap = 0.06 * upm
    added = 0
    for ch in todo:
        base_char, mark = LETTERS[ch]
        if ord(base_char) not in cmap:
            continue
        src = mark_source(font, donor, mark)
        if not src:
            continue
        mrec, mb, _ = src
        base_name = cmap[ord(base_char)]
        brec = record(font, base_name)
        if base_char == 'i':
            brec = dotless(font, brec)
        bb = bounds(font, brec)
        if not bb or not mb:
            continue
        bw = bb[2] - bb[0]
        mw, mh = mb[2] - mb[0], mb[3] - mb[1]
        if mw <= 0 or mh <= 0:
            continue
        base_w = max(bw, 0.42 * upm) if base_char in 'iI' else bw
        scale = min(WIDTH[mark] * base_w / mw, MAX_HEIGHT[mark] * upm / mh)
        cx = (bb[0] + bb[2]) / 2
        if mark == 'cedilla':
            dy = bb[1] + 0.04 * upm - mb[3] * scale
        else:
            dy = bb[3] + gap - mb[1] * scale
        dx = cx - (mb[0] + mb[2]) / 2 * scale
        pen = TTGlyphPen(None)
        brec.replay(pen)
        mrec.replay(TransformPen(pen, (scale, 0, 0, scale, dx, dy)))
        glyph = pen.glyph()
        name = 'uni%04X' % ord(ch)
        glyf[name] = glyph
        glyph.recalcBounds(glyf)
        adv = hmtx[base_name][0]
        hmtx[name] = (adv, getattr(glyph, 'xMin', 0))
        if 'vmtx' in font:
            font['vmtx'][name] = font['vmtx'][base_name]
        for table in font['cmap'].tables:
            if table.isUnicode():
                table.cmap[ord(ch)] = name
        added += 1
    font['maxp'].numGlyphs = len(font.getGlyphOrder())
    font.save(path)
    print('%s: added %d letters' % (path, added))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    donor_font = TTFont(sys.argv[1])
    for p in sys.argv[2:]:
        add_letters(p, donor_font)
