"""Builds the CatalystFDM brand files from the Duara Mail dragon.

The dragon, its masks and colours come straight from duara-mail/web/assets; only the card
in its mouth changes, from an envelope to a download card (arrow into a tray). Wordmarks are
DM Sans outlines (the Duara brand face) so the SVGs need no font to render.
"""
import re, sys, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

DUARA = os.environ.get('DUARA_ASSETS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../duara-mail/web/assets'))
OUT = sys.argv[1]
NAVY, BLUE, LIGHT, WHITE = '#00316b', '#0b7fd4', '#3ea2f0', '#ffffff'

def card(stroke, arrow, sw):
    # Same card geometry as the envelope so every mask in the source still lines up.
    inset = sw / 2
    return ('<g mask="url(#dh-env)"><g transform="translate(390 214) rotate(-8)">'
            f'<rect x="{inset}" y="{inset}" width="{126-sw}" height="{86-sw}" rx="{12-inset/2:.1f}" fill="none" stroke="{stroke}" stroke-width="{sw}"/>'
            f'<g fill="none" stroke="{arrow}" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M63,27 L63,50" stroke-width="12"/><path d="M50,39 L63,52 L76,39" stroke-width="12"/>'
            '<path d="M43,65 L83,65" stroke-width="9"/></g></g></g>')

def swap_card(svg, stroke, arrow, sw):
    m = re.search(r'<g mask="url\(#dh-env\)">.*?</g></g>', svg, re.S)
    assert m, 'envelope group not found'
    return svg[:m.start()] + card(stroke, arrow, sw) + svg[m.end():]

def relabel(svg):
    return svg.replace('aria-label="Duara Mail"', 'aria-label="CatalystFDM"')

def read(name):
    return open(os.path.join(DUARA, name)).read()

def write(name, svg):
    open(os.path.join(OUT, name), 'w').write(svg)

# ----- marks -------------------------------------------------------------------------------
mark = relabel(swap_card(read('mark.svg'), NAVY, BLUE, 14))
mark_rev = relabel(swap_card(read('mark-reverse.svg'), WHITE, LIGHT, 14))
icon = relabel(swap_card(read('favicon.svg'), WHITE, LIGHT, 14))
write('mark.svg', mark)
write('mark-reverse.svg', mark_rev)
write('app-icon.svg', icon)

# Small sizes (16–32 px): the whole dragon turns to noise, so crop to the head and the card.
inner = re.search(r'<svg[^>]*>(.*)</svg>', mark_rev, re.S).group(1)
small = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="CatalystFDM">'
         f'<rect width="512" height="512" rx="112" fill="{NAVY}"/>'
         f'<g transform="translate(-118 64) scale(1.16)">{inner}</g></svg>')
write('app-icon-small.svg', small)

# ----- wordmark ----------------------------------------------------------------------------
def load(wght):
    f = TTFont(os.path.join(DUARA, 'fonts/dm-sans-latin-normal.woff2'))
    axes = {a.axisTag: a for a in f['fvar'].axes}
    loc = {'wght': wght}
    if 'opsz' in axes:
        loc['opsz'] = axes['opsz'].maxValue
    return instancer.instantiateVariableFont(f, loc)

def outline(font, text, size, x0, y0, tracking=0.0, skew=0.0):
    """Returns (svg path d, width) for text set at size px with its baseline at y0."""
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font['hmtx']
    s = size / font['head'].unitsPerEm
    ds, x = [], x0
    for i, ch in enumerate(text):
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs)
        # font units are y-up; flip, scale, optional oblique (skew) about the baseline
        gs[g].draw(TransformPen(pen, (s, 0, skew * s, -s, x, y0)))
        ds.append(pen.getCommands())
        x += hmtx[g][0] * s + (tracking if i < len(text) - 1 else 0)
    return ' '.join(ds), x - x0

def cap_size(font, cap_px):
    return cap_px / (font['OS/2'].sCapHeight / font['head'].unitsPerEm)

bold, medium = load(700), load(500)
X = 548
big = cap_size(bold, 165)
d1, w1 = outline(bold, 'CATALYST', big, X, 242.2)
fdm_size = cap_size(medium, 67)
_, wf = outline(medium, 'FDM', fdm_size, 0, 0)
track = (w1 - wf) / 2
d2, _ = outline(medium, 'FDM', fdm_size, X, 339.4, tracking=track)
tag = 'Downloads, built for Africa'
tsize = cap_size(medium, 34)
_, wt = outline(medium, tag, tsize, 0, 0)
d3, _ = outline(medium, tag, tsize, X + (w1 - wt) / 2, 451, skew=0.2)
W = round(X + w1 + 8)

def logo(mark_svg, ink, rule, accent):
    inner = re.search(r'<svg[^>]*viewBox="0 0 512 512"[^>]*>(.*)</svg>', mark_svg, re.S).group(1)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 512" role="img" aria-label="CatalystFDM">'
            f'<svg x="0" y="0" width="512" height="512" viewBox="0 0 512 512">{inner}</svg>'
            f'<path fill="{ink}" d="{d1}"/><path fill="{accent}" d="{d2}"/>'
            f'<rect x="{X}" y="373.4" width="{w1:.1f}" height="7" rx="3.5" fill="{rule}"/>'
            f'<path fill="{ink}" d="{d3}"/></svg>')

write('logo.svg', logo(mark, NAVY, BLUE, BLUE))
write('logo-reverse.svg', logo(mark_rev, WHITE, LIGHT, LIGHT))

# Compact one-line wordmark for app chrome: "Catalyst" navy + "FDM" blue.
wsize = cap_size(bold, 70)
da, wa = outline(bold, 'Catalyst', wsize, 0, 80)
db, wb = outline(bold, 'FDM', wsize, wa + 6, 80)
for name, a, b in (('wordmark.svg', NAVY, BLUE), ('wordmark-reverse.svg', WHITE, LIGHT)):
    write(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {wa + wb + 8:.0f} 100" role="img" aria-label="CatalystFDM">'
                f'<path fill="{a}" d="{da}"/><path fill="{b}" d="{db}"/></svg>')
print('ok', W)
