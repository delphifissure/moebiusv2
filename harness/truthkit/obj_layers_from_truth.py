#!/usr/bin/env python3
"""S27: completed object layers from the truth kit, keyed to the app's own object ids.

Inputs: the scene's rest_layers.npz (every hit along each rest ray: pid / rgb / depth per layer k), meta.json (depth law),
and the app's plane_object_ids dump (objIds.u8, source rows, from harness/objlayers.js). Each app object is mapped to the
kit primitive (pid) that owns most of its footprint; one layer per pid (several app ids may share one pid — a porous
crown's leaves). The layer's visible mask is the primitive's own visible footprint in the truth (rest first hit == pid), the
visible/amodal split a layer model or an amodal segmenter supplies; the app footprints are reported for comparison. The completed layer of pid p at texel i
is its first hit along the rest ray: colour and depth (metres behind the window -> the app's normalised d through the
inverse of app_z_of_d). Background primitives (label 1) are not objects and are skipped.

Writes to <out>: obj_<id>_color.rgba (4N, alpha 255 where the pid has a hit), obj_<id>_vis.u8 (the truth visible mask), obj_<id>_depth.f32 (normalised d of the pid's first hit), objects_truth.json.
  python3 obj_layers_from_truth.py S15 <out dir with objIds.u8 and objects.json>
"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tk import app_z_of_d

def d_of_depth(depth_m, pn, outer, inner):
    """Inverse of app_z_of_d for points behind the portal (z = -depth <= 0): d in [0, pn]. Beyond outer -> 0; in front -> pn."""
    s = 1.0 - depth_m / outer                      # smoothstep value: z = -outer + outer * s
    s = np.clip(s, 0.0, 1.0)
    # invert s = t^2 (3 - 2t) on [0,1]: t = 0.5 - sin(asin(1 - 2 s) / 3)
    t = 0.5 - np.sin(np.arcsin(1.0 - 2.0 * s) / 3.0)
    d = np.clip(t, 0, 1) * pn
    d = np.where(depth_m <= 0, pn, d)
    return d.astype(np.float32)

S, out = sys.argv[1], sys.argv[2]
TK = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(f'{TK}/out/{S}/meta.json')); pw, ph = meta['nx'], meta['ny']; N = pw * ph
R = np.load(f'{TK}/out/{S}/rest_layers.npz'); pid = R['pid']; rgb = R['rgb']; dep = R['depth']
ids = np.fromfile(f'{out}/objIds.u8', np.uint8).reshape(ph, pw)
objs = json.load(open(f'{out}/objects.json'))
labels = {p['pid']: p['label'] for p in meta['prims']}; names = {p['pid']: p['name'] for p in meta['prims']}
# app object -> kit pid by majority of the front hit over the footprint
by_pid = {}
for o in objs:
    fp = ids == o['id']
    if not fp.any(): continue
    p0 = pid[..., 0][fp]; p0 = p0[p0 >= 0]
    if p0.size == 0: continue
    vals, cnt = np.unique(p0, return_counts=True); p = int(vals[np.argmax(cnt)]); frac = float(cnt.max() / p0.size)
    if labels.get(p, 1) != 2: continue                      # background primitives are the plane law's, not objects
    by_pid.setdefault(p, {'appIds': [], 'purity': []}); by_pid[p]['appIds'].append(o['id']); by_pid[p]['purity'].append(frac)
report = []
for p, info in by_pid.items():
    has = (pid == p).any(-1); k = np.argmax(pid == p, -1)
    col = np.take_along_axis(rgb, k[..., None, None], -2)[..., 0, :]; dm = np.take_along_axis(dep, k[..., None], -1)[..., 0]
    rgba = np.zeros((ph, pw, 4), np.uint8); rgba[..., :3] = col if col.dtype == np.uint8 else np.clip(col * 255 + 0.5, 0, 255).astype(np.uint8); rgba[..., 3] = np.where(has, 255, 0)   # rest_layers stores uint8 (the first build multiplied by 255 again: pink crowns)
    # the visible mask = the object's own visible footprint in the truth (rest first hit is this primitive): what a layer model's
    # visible/amodal split (Amodal SAM, SAMEO) provides; the app's exported footprint misses the object's components without band
    # demand, so it is NOT used as the visibility here (measured on S15: 4.5 k visible crown texels pushed behind the front)
    vis = (pid[..., 0] == p).astype(np.uint8); vis_app = np.isin(ids, info['appIds'])
    dn = d_of_depth(np.where(has, dm, meta['outer']), meta['pn'], meta['outer'], meta['inner'])
    lid = max(info['appIds'])                              # the layer carries the largest app id of the group
    rgba.tofile(f'{out}/obj_{lid}_color.rgba'); vis.tofile(f'{out}/obj_{lid}_vis.u8'); dn.tofile(f'{out}/obj_{lid}_depth.f32')
    hid = has & ~vis.astype(bool)
    report.append({'layerId': lid, 'pid': p, 'name': names.get(p), 'appIds': info['appIds'], 'purity': info['purity'], 'layerPx': int(has.sum()), 'visPx': int(vis.sum()), 'appFootprintPx': int(vis_app.sum()),
                   'hiddenPx': int(hid.sum()), 'hiddenDepthMedian_m': float(np.median(dm[hid])) if hid.any() else None, 'visDepthMedian_m': float(np.median(dm[vis.astype(bool)])) if vis.any() else None})
json.dump(report, open(f'{out}/objects_truth.json', 'w'), indent=1)
print(json.dumps(report))
