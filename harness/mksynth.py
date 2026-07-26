# A138: A SYNTHETIC ASSET WITH ANALYTICALLY-KNOWN FLOAT DEPTH.
#
# a133 established that all four suite depth maps carry 8 bits of information,
# and that the fold-correct plate step (1/k = 0.00176) is 0.45 of one 8-bit
# quantum — so enforcing it cannot preserve structure, it flattens. That
# explains why a128 measured it losing. It does NOT tell us what happens when
# the constraint becomes expressible, and the repository has no float depth to
# find out with: no PNG metadata, no estimator named anywhere, no .exr/.npy.
#
# So build one. This is SYNTHESIS OF GROUND TRUTH, not reconstruction of
# destroyed slope — a86 tried the latter and measured it making folding worse
# on 2 of 4 assets. Here the float field is defined by a formula and the 8-bit
# version is derived FROM it by quantisation, which is the correct direction.
#
# THE FIELD IS DESIGNED TO SEPARATE THE TWO HYPOTHESES:
#   the ground ramp's per-texel slope is ~0.00044 depth, which is
#     - 0.11 of an 8-bit quantum   -> 8-bit renders it as ~9px terraces whose
#       risers are a full 0.00392, i.e. 2.2x the fold limit, so a fold-correct
#       slope limiter MUST lower them and flatten the ground
#     - 0.25 of the fold limit at 16-bit -> genuinely fold-safe, so the same
#       limiter should leave it alone
#   Same geometry, same colour, same k. Only the expressibility changes.
#
# Resolution matches troll (851x1023) so k is the same 568 px and the numbers
# are directly comparable to the a131 table.
#
#   python3 harness/mksynth.py
import zlib, struct, math

W, H = 851, 1023
HORIZON = 0.42          # fraction of height where sky meets ground


def depth_at(x, y):
    """Float depth, 1 = near, 0 = far. Piecewise but C0, and every piece is
    smooth enough that its slope is well below the fold limit at 16 bits."""
    v = y / (H - 1.0)
    if v < HORIZON:                       # sky / distant backdrop
        d = 0.04 + 0.06 * (v / HORIZON)
    else:                                 # ground plane receding to the horizon
        t = (v - HORIZON) / (1.0 - HORIZON)
        d = 0.10 + 0.42 * (t ** 1.25)
    # a gentle lateral undulation so the field is not separable in y alone
    d += 0.012 * math.sin(2.0 * math.pi * (x / (W - 1.0)) * 1.5)
    return d


def occluders(x, y):
    """Hard depth cliffs. Returns depth or None. These are the disocclusion
    sources — genuine discontinuities that SHOULD tear."""
    # near vertical slab, left of centre
    if 0.18 * W <= x <= 0.40 * W and 0.30 * H <= y <= 0.92 * H:
        return 0.88
    # mid-depth column, right, overlapping in x with nothing (single-layer)
    if 0.62 * W <= x <= 0.74 * W and 0.46 * H <= y <= 0.86 * H:
        return 0.55
    # a small near disc, upper right, to give an isolated silhouette
    dx, dy = x - 0.80 * W, y - 0.26 * H
    if dx * dx + dy * dy <= (0.075 * W) ** 2:
        return 0.80
    return None


def colour_at(x, y, d):
    """Band-limited colour. Deliberately smooth: a correct render should read
    near-zero second-difference comb energy, so any comb the metric sees is an
    artifact rather than the content."""
    u, v = x / (W - 1.0), y / (H - 1.0)
    blob = (math.sin(2 * math.pi * (u * 2.1 + v * 1.3)) *
            math.sin(2 * math.pi * (u * 1.7 - v * 2.3)))
    if d > 0.7:            # near slab / disc
        base = (196, 132, 96)
    elif d > 0.5:          # mid column
        base = (120, 156, 176)
    elif v < HORIZON:      # sky
        base = (150, 178, 206)
    else:                  # ground
        base = (128, 150, 112)
    k = 1.0 + 0.16 * blob
    return tuple(max(0, min(255, int(c * k))) for c in base)


def chunk(t, data):
    return (struct.pack('>I', len(data)) + t + data +
            struct.pack('>I', zlib.crc32(t + data) & 0xffffffff))


def write_png(path, w, h, bitdepth, colortype, rows):
    ihdr = struct.pack('>IIBBBBB', w, h, bitdepth, colortype, 0, 0, 0)
    raw = bytearray()
    for r in rows:
        raw.append(0)
        raw += r
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))
    open(path, 'wb').write(png)


dep = [[0.0] * W for _ in range(H)]
col_rows, d16_rows, d8_rows = [], [], []
slopes = []
for y in range(H):
    crow, r16, r8 = bytearray(), bytearray(), bytearray()
    for x in range(W):
        o = occluders(x, y)
        d = o if o is not None else depth_at(x, y)
        d = max(0.0, min(1.0, d))
        dep[y][x] = d
        c = colour_at(x, y, d)
        crow += bytes(c)
        v16 = int(round(d * 65535)); r16 += bytes([v16 >> 8, v16 & 255])
        r8.append(int(round(d * 255)))
    col_rows.append(crow); d16_rows.append(r16); d8_rows.append(r8)

# report the ground ramp's actual per-texel slope, which is the whole point
for y in range(int(HORIZON * H) + 40, H - 1, 97):
    slopes.append(abs(dep[y + 1][W // 2] - dep[y][W // 2]))
mean_slope = sum(slopes) / len(slopes)

write_png('harness/synth_color.png', W, H, 8, 2, col_rows)
write_png('harness/synth_depth16.png', W, H, 16, 0, d16_rows)
write_png('harness/synth_depth8.png', W, H, 8, 0, d8_rows)

q8, fold = 1.0 / 255, 0.00176
print('wrote harness/synth_color.png  %dx%d rgb8' % (W, H))
print('wrote harness/synth_depth16.png  bitDepth=16')
print('wrote harness/synth_depth8.png   bitDepth=8')
print('ground ramp mean per-texel slope = %.6f depth' % mean_slope)
print('  = %.2f of one 8-bit quantum (%.5f)  -> 8-bit terraces the ramp' % (mean_slope / q8, q8))
print('  = %.2f of the fold limit 1/k (%.5f) -> fold-SAFE when expressible' % (mean_slope / fold, fold))
print('8-bit terrace riser = %.5f = %.2fx the fold limit -> a fold-correct limiter must lower it'
      % (q8, q8 / fold))
