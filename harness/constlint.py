#!/usr/bin/env python3
"""Constant provenance linter. Extracts every numeric literal in moebius.js and
classifies it by the UNIT it is compared against, so unscaled px/depth/canvas
constants (the a88/a89 bug class) are found mechanically rather than by memory."""
import re, sys, json
from collections import defaultdict

src = open(sys.argv[1] if len(sys.argv) > 1 else '/workspace/arc73/moebius.js').read()
lines = src.split('\n')

NUM = re.compile(r'(?<![\w.$])(\d+\.\d+|\.\d+|\d+)(?![\w.])')
# tokens that reveal what a literal is being compared/multiplied against
DEPTH  = re.compile(r'\b(dQ|depth|plate|plateQ|plateF|tearStep|fgTearStep|dQ\[|P\[|prom|zbuf|d0|d1|d2|mn|mx|wmn|wmx)\b')
SRCPX  = re.compile(r'\b(pw|ph|PNq|texel|radius|Radius|RWD|RF|BOOT|px|Px|dilate|Dilate|reach|Reach|window)\b')
CANVAS = re.compile(r'\b(canvasWidth|canvasHeight|innerWidth|innerHeight|renderer|viewport|\bw\b|\bh\b)\b')
SCALED = re.compile(r'(pw|ph|w|h)\s*/\s*(1200|1920|1024|2048)|/\s*Math\.max\(1,\s*(pw|ph|w|h)\)')
ITERS  = re.compile(r'\b(ITERS|Iters|iters|passes|Passes|for\s*\(\s*let\s+\w+\s*=\s*0)\b')
COLOR  = re.compile(r'\b(luma|Luma|rgb|RGB|chroma|Chroma|0\.299|0\.587|0\.114|255)\b')
UIISH  = re.compile(r'(style|innerHTML|px;|#[0-9a-fA-F]{3,6}|font|padding|margin|border|width:|height:|z-index|opacity|setTimeout|setInterval|console|toFixed|slice\(|substring|charCodeAt)')
SHADER_HINT = re.compile(r'(gl_|vec[234]|float |uniform |varying |texture2D|dFdx|dFdy|smoothstep|mix\()')

# find shader string regions crudely: lines inside backtick blocks containing GLSL hints
in_shader = [False]*len(lines)
depth_bt = 0
for i, L in enumerate(lines):
    if depth_bt > 0: in_shader[i] = True
    depth_bt += L.count('`') % 2 if L.count('`') % 2 else 0
    if L.count('`') % 2 == 1: depth_bt = 1 - depth_bt
shader_lines = set(i for i, L in enumerate(lines) if SHADER_HINT.search(L))

SKIP_VALS = {'0','1','2','3','4','0.0','1.0','2.0','0.5','100','1000','-1'}
buckets = defaultdict(list)
for i, L in enumerate(lines):
    if UIISH.search(L): continue
    s = L.strip()
    if s.startswith('//') or s.startswith('*'): continue
    for m in NUM.finditer(L):
        v = m.group(1)
        if v in SKIP_VALS: continue
        ctx = L
        if SCALED.search(ctx):            k = 'A_scaled_ok'
        elif i in shader_lines:           k = 'S_shader'
        elif DEPTH.search(ctx):           k = 'D_depth_units'
        elif ITERS.search(ctx):           k = 'C_iters_as_reach'
        elif SRCPX.search(ctx):           k = 'C_src_px'
        elif CANVAS.search(ctx):          k = 'F_canvas_px'
        elif COLOR.search(ctx):           k = 'L_color'
        else:                             k = 'U_unclassified'
        buckets[k].append((i+1, v, s[:120]))

print('=== CONSTANT CENSUS (moebius.js) ===')
for k in sorted(buckets, key=lambda x: -len(buckets[x])):
    print('%-20s %5d' % (k, len(buckets[k])))
print()
print('=== HIGH-RISK: pixel/iteration constants NOT resolution-scaled ===')
seen = set()
for k in ('C_src_px','C_iters_as_reach','F_canvas_px'):
    for ln, v, s in buckets[k]:
        key = (ln, v)
        if key in seen: continue
        seen.add(key)
        print('%-18s L%-6d %-8s %s' % (k, ln, v, s))

# ---------------------------------------------------------------------------
# LAW-COPY DETECTOR (added after a104). The unit census above finds a constant
# whose UNITS are wrong. It does NOT find a constant whose units are right and
# whose VALUE is a silent duplicate of a live global — the defect that hid
# bgDirectionalPlug's private parallax LUT for the whole arc: it inlined
# 0.02 / 0.04 / 0.5 / 0.20 / 0.16, so it kept working, kept passing, and simply
# ignored the volume-depth sliders, the depth-midpoint control, the fade angle
# and the layer's aspect fit.
# Rule: a line that spells out two or more of the physical globals as literals,
# without naming any of them, is re-deriving a law that already exists.
LAW = {
    '0.04': 'innerVolumeDepth', '0.02': 'outerVolumeDepth',
    '0.16': 'terrariumWidth',   '0.09': 'terrariumHeight',
    '0.20': 'portal distance (camera.position.z)',
    '0.2':  'portal distance (camera.position.z)',
    '0.5':  'currentNormPortalPlane',
    '45':   'bgViewFadeEndDeg',  '35': 'bgViewFadeStartDeg',
    '0.06': 'fgTearStep',
}
LAW_NAMES = re.compile(r'\b(innerVolumeDepth|outerVolumeDepth|terrariumWidth|terrariumHeight|'
                       r'currentNormPortalPlane|bgViewFadeEndDeg|bgViewFadeStartDeg|fgTearStep|'
                       r'camera\.position\.z|bgShiftLUTFor|bgConeSlopePerPx|bgConeSlopeAtDepth)\b')
print()
print('=== LAW COPIES: physical globals spelled out as literals ===')
hits = []
for i, L in enumerate(lines):
    if i in shader_lines: continue
    s2 = L.strip()
    if s2.startswith('//') or s2.startswith('*'): continue
    if LAW_NAMES.search(L): continue          # names the real thing: not a copy
    found = {}
    for m in NUM.finditer(L):
        v = m.group(1)
        if v in LAW: found[LAW[v]] = v
    if len(found) >= 2:
        hits.append((i + 1, found, s2[:110]))
for ln, found, s2 in hits:
    print('L%-6d %s' % (ln, ', '.join('%s=%s' % (v, k) for k, v in found.items())))
    print('        %s' % s2)
if not hits:
    print('(none)')
