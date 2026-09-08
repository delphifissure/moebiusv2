#!/usr/bin/env python3
"""The dolly family, mathematically.

The app's off-axis dolly zoom keeps the window W×H and moves the camera to D(f) = (W/2)·(f / 18 mm)
(A208), pinning the subject plane at the window so the focal object keeps its frame position and
size across a cut. In the truth kit D is a free parameter, so the family is one loop: the same
world scene, the subject at z = 0, photographed from each D(f) through the same window. Everything
that follows (shift = e·z/(D − z)·px/m, hole widths, outpaint strips, the window's visible strip
W(D + d)/D) is a function of z/D and of the eye's window angle θ = atan(e/D) alone, and scaling
W, D, z, e together changes no pixel — so the family is fully described by D/W, i.e. by f.

Two envelope conventions are tabulated for each f:
  (a) window angle fixed: θ_max = 45° at every f (e = D tan 45°);
  (b) the app's head units: e = e_ref · D_ref / D (lensGain = tan(hfov/2) = W/(2D) with the dolly),
      so θ_max = atan(e_ref D_ref / D²) — (18/f)² in angle for small angles (R1 §1.4 correction).

  python3 dolly.py S30 [--nx 600] [--f 18,25,35,45,65,90,144]
Outputs out/dolly/<scene>/f<f>/ (make + display GT + reveal) and out/dolly/<scene>/dolly_table.json + dolly_sheet.png.
"""
import argparse, json, os, subprocess, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(' '.join(cmd)); print(r.stdout[-2000:]); print(r.stderr[-2000:]); sys.exit(1)
    return r.stdout


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('scene'); ap.add_argument('--nx', type=int, default=600); ap.add_argument('--f', default='18,25,35,45,65,90,144')
    ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--H', type=float, default=0.09); ap.add_argument('--fade', type=float, default=45.0)
    ap.add_argument('--f-ref', type=float, default=45.0)
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__)); base = os.path.join(here, 'out', 'dolly', a.scene); os.makedirs(base, exist_ok=True)
    fs = [float(v) for v in a.f.split(',')]
    D_ref = (a.W / 2) * (a.f_ref / 18.0); e_ref = D_ref * np.tan(np.radians(a.fade))
    rows = []
    for f in fs:
        D = (a.W / 2) * (f / 18.0)
        out = os.path.join(base, f'f{int(f)}'); os.makedirs(out, exist_ok=True)
        run(['python3', os.path.join(here, 'make.py'), a.scene, '--nx', str(a.nx), '--D', f'{D:.6f}', '--W', str(a.W), '--H', str(a.H), '--out', out])
        meta = json.load(open(os.path.join(out, 'meta.json'))); outer = meta['outer']; inner = meta['inner']
        # (a) window angle fixed at fade deg; (b) head units: e = e_ref D_ref / D
        th_a = a.fade
        e_b = e_ref * D_ref / D; th_b = float(np.degrees(np.arctan2(e_b, D)))
        asp = a.H / a.W
        res = {'f_mm': f, 'D': D, 'hfov_deg': float(np.degrees(2 * np.arctan2(a.W / 2, D))), 'theta_window_deg': th_a, 'theta_head_units_deg': th_b, 'e_window': float(D * np.tan(np.radians(th_a))), 'e_head_units': float(e_b)}
        for tag, th in (('window', th_a), ('head', th_b)):
            thx = ','.join(f'{v:.2f}' for v in np.linspace(0, th, 6)[1:]) if th > 0.05 else '0.05'
            thy_max = float(np.degrees(np.arctan(asp * np.tan(np.radians(th)))))
            thy = ','.join(f'{v:.2f}' for v in np.linspace(0, thy_max, 3)[1:]) if thy_max > 0.05 else '0.05'
            so = os.path.join(out, f'scope_{tag}')
            run(['python3', os.path.join(here, 'scope.py'), a.scene, '--nx', str(a.nx), '--D', f'{D:.6f}', '--W', str(a.W), '--H', str(a.H), '--thx', '0,' + thx, '--thy', '0,' + thy, '--no-atlas', '--out', so])
            s = json.load(open(os.path.join(so, 'scope_summary.json')))
            # the extreme horizontal eye on the axis
            ext = [p for p in s['per_eye'] if p['thy'] == 0 and abs(p['thx'] - th) < 0.05]
            ext = ext[0] if ext else max((p for p in s['per_eye'] if p['thy'] == 0), key=lambda p: p['thx'])
            res[f'{tag}_mean_photographed'] = s['envelope_mean_photographed']; res[f'{tag}_mean_outpaint'] = s['envelope_mean_outpaint']
            res[f'{tag}_mean_disocc'] = s['envelope_mean_bg_disocclusion'] + s['envelope_mean_thing_disocclusion'] + s['envelope_mean_side'] + s['envelope_mean_interior']
            res[f'{tag}_extreme_photographed'] = ext['photographed']; res[f'{tag}_extreme_outpaint'] = ext['outpaint']
            res[f'{tag}_extreme_disocc'] = ext['bg_disocclusion'] + ext['thing_disocclusion'] + ext['side'] + ext['interior']
            # the instrument's numbers at this envelope (band px, max shift)
            ro = os.path.join(out, f'reveal_{tag}')
            run(['python3', os.path.join(here, 'reveal.py'), '--depth', os.path.join(out, 'rest_depth16.png'), '--W', str(a.W), '--H', str(a.H), '--D', f'{D:.6f}', '--pn', '0.5', '--outer', str(outer), '--inner', str(max(inner, 1e-4)), '--fade', f'{th:.4f}', '--out', ro])
            rv = json.load(open(os.path.join(ro, 'reveal_summary.json')))
            res[f'{tag}_band_px'] = rv['band_union_px']; res[f'{tag}_outpaint_max_px'] = rv['outpaint_max_px']
            sx = np.load(os.path.join(ro, 'reveal.npz'))['sig_x']; res[f'{tag}_max_shift_px'] = float(np.abs(sx).max())
        rows.append(res)
        print(f"f {f:5.0f} mm  D {D:.3f}  hfov {res['hfov_deg']:5.1f}  | window 45 deg: phot {res['window_extreme_photographed']:.2f} outp {res['window_extreme_outpaint']:.2f} disocc {res['window_extreme_disocc']:.3f} shift {res['window_max_shift_px']:5.0f} px band {res['window_band_px']:6d} | head units: theta {th_b:5.1f} deg phot {res['head_extreme_photographed']:.2f} outp {res['head_extreme_outpaint']:.2f} disocc {res['head_extreme_disocc']:.3f} shift {res['head_max_shift_px']:5.0f} px band {res['head_band_px']:6d}")
    json.dump({'scene': a.scene, 'W': a.W, 'H': a.H, 'fade_deg': a.fade, 'f_ref_mm': a.f_ref, 'D_ref': D_ref, 'e_ref': float(e_ref), 'rows': rows}, open(os.path.join(base, 'dolly_table.json'), 'w'), indent=1)
    # sheet: per f, the rest photograph and the extreme window-angle eye (rendered directly)
    from tk import Portal, render, to_u8
    from scenes import SCENES
    tiles = []
    for r in rows:
        f = r['f_mm']; D = r['D']; prims, meta = SCENES[a.scene](a.W, a.H)
        ny = int(round(a.nx * a.H / a.W)); plate = Portal(a.W, a.H, D, a.nx, ny, 0.0)
        tiles.append((Image.open(os.path.join(base, f'f{int(f)}', 'rest_rgb.png')), f'f {int(f)} mm  D {D:.3f} m  hfov {r["hfov_deg"]:.0f}: the photograph (subject pinned at the window)'))
        for tag, th in (('window 45 deg', r['theta_window_deg']), ('head units', r['theta_head_units_deg'])):
            e = D * np.tan(np.radians(th)); Rv = render(prims, plate, (e, 0, D), K=1)
            tiles.append((Image.fromarray(to_u8(np.clip(Rv['rgb'][..., 0, :], 0, 1))), f'{tag}: theta {th:.1f} deg, e {e:.3f} m; phot {r[("window" if tag.startswith("window") else "head") + "_extreme_photographed"]:.2f} outp {r[("window" if tag.startswith("window") else "head") + "_extreme_outpaint"]:.2f}'))
    sc = 0.5; tiles = [(im.resize((int(im.width * sc), int(im.height * sc))), t) for im, t in tiles]
    Wt, Ht = tiles[0][0].size; pad = 6; cols = 3; rws = (len(tiles) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (Wt + pad) + pad, 28 + rws * (Ht + 22 + pad)), (20, 20, 20)); d = ImageDraw.Draw(sh)
    d.text((pad, 6), f'{a.scene} dolly family: D = (W/2)(f/18mm), W {a.W}; columns: photograph | extreme eye at a fixed window angle | extreme eye in the app\'s head units (e = e_ref D_ref/D)', fill=(255, 255, 255))
    for k, (im, t) in enumerate(tiles):
        x = pad + (k % cols) * (Wt + pad); y = 28 + (k // cols) * (Ht + 22 + pad); d.text((x, y), t, fill=(255, 230, 120)); sh.paste(im, (x, y + 16))
    sh.save(os.path.join(base, 'dolly_sheet.png')); print('wrote', base)


if __name__ == '__main__':
    main()
