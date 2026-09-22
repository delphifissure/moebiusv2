#!/usr/bin/env python3
"""S53 / R8 item 3 — THE ORDINAL-PAIR INSTRUMENT FOR BAND DEPTH, on the DA-2K protocol.

WHY THIS EXISTS. Every depth score this project has used is a magnitude score -- RMSE, MAE, delta-1, median |err| in
metres -- and R8's read of the corpus found all of them in the family that rewards the conditional mean, which is
blur. Depth Anything v2 hit the same wall from the other side and said so in its own words (S6.1, read first-hand):

    "Such frequent label noise makes the reported metrics of powerful MDE models not reliable anymore."
    Fig.8 caption: "The noise will cause better models instead achieve lower scores."

Their response was not a better magnitude metric. It was DA-2K (S6.2, Fig.9): sparse ORDINAL pairs -- pick two
pixels, say which is nearer. On their Tab.3 it separates models that the conventional metrics rank as equal
(Marigold 86.8, DAv1 88.5, DAv2-G 97.4). Ordinal judgement is also the thing humans demonstrably agree on, and
PatchRefiner found ranking supervision ORTHOGONAL to scale-and-shift invariance rather than redundant with it.

For the band this is the right shape twice over. There is no dense truth for a hidden surface on a photograph, but
there IS an answer to "is this bit of cave behind that bit of rock". And on the kit, where dense truth exists, the
ordinal score asks the question the magnitude score cannot: is the CONSTRUCTION'S ORDERING right, independently of
whether its scale is.

THE PROTOCOL, AND WHICH PARTS ARE COPIED. From DA-2K S6.2 and C.3:
  - sparse pairs, not dense maps                                                     [copied]
  - keep only pairs whose depth RATIO exceeds a threshold (they use 3), so the       [copied, in metric z, and the
    ordinal answer is unambiguous and the judgement is not a coin flip                threshold is a parameter here]
  - select pairs where strong models DISAGREE, then adjudicate                       [copied: --disagree mode, for
                                                                                      pictures with no truth]
  - organise into scenarios so the result is readable per scenario, not one number   [copied: the families below]
  - human adjudication, triple-checked                                               [NOT done: this emits the sheet
                                                                                      for it and stops there]

THE FAMILIES, which are our scenarios:
  rim        one pixel visible just outside the band, one inside it, within `rimpx` of the rim. The decisive family:
             it asks whether the construction puts the hidden surface on the correct side of its own boundary, which
             is exactly where every streak in this project starts.
  band_band  both inside the band, sampled at range. Internal ordering of the hidden surface.
  occluder   one in the band, one on the occluder in front. A sanity family -- the answer is never in doubt -- so a
             construction that fails it is broken rather than inaccurate, and that must not be averaged away.
  visible    both outside the band. The control: this is measured depth, so any construction scoring badly here has
             corrupted what the viewer can already see.

Scored against truth where truth exists (kit scenes, scope_gt.npz); in --disagree mode it instead ranks pairs by how
far two constructions disagree and writes an adjudication sheet, because on a photograph nothing here is the judge.

  python3 ordinal_pairs.py out/S10_env45/scope_gt.npz ../shots/a257probe/S10 [--pairs 4000] [--ratio 1.5]
  python3 ordinal_pairs.py --disagree <probeA> <probeB> --out sheet.png
"""
import sys, os, json, argparse
import numpy as np
from PIL import Image
from tk import app_z_of_d

RNG = np.random.default_rng(12345)


def load_probe(probe):
    meta = json.load(open(os.path.join(probe, 'meta.json')))
    pw, ph = meta['pw'], meta['ph']
    g = lambda n, t=np.float32: (np.fromfile(os.path.join(probe, n), t).reshape(ph, pw)
                                 if os.path.exists(os.path.join(probe, n)) else None)
    return meta, {'dis': g('disocc.u8', np.uint8), 'ff': g('farField.f32'), 'dQ': g('dQ.f32'),
                  'plateF': g('plateF.f32')}


def metres(dn, meta):
    """The app's normalised d -> metres behind the window, through the app's own law. Positive is farther."""
    return -app_z_of_d(np.clip(dn, 0, 1), meta['pn'], meta['outer'], meta['inner'])


def sample_pairs(maskA, maskB, n, rng, same=False, max_try=60):
    """n index pairs, the first endpoint from maskA and the second from maskB. Rejects coincident pairs."""
    ia = np.flatnonzero(maskA.ravel()); ib = np.flatnonzero(maskB.ravel())
    if ia.size == 0 or ib.size == 0:
        return np.zeros((0, 2), np.int64)
    a = rng.choice(ia, size=n * 2, replace=True)
    b = rng.choice(ib, size=n * 2, replace=True)
    keep = a != b
    return np.stack([a[keep][:n], b[keep][:n]], axis=1)


def ordinal(zA, zB, ratio):
    """DA-2K's rule: keep only the pairs whose metric ratio exceeds `ratio`, then the label is which is nearer.
    Returns (label, keep) with label True meaning the FIRST endpoint is nearer (smaller z)."""
    lo = np.minimum(zA, zB); hi = np.maximum(zA, zB)
    keep = np.isfinite(lo) & np.isfinite(hi) & (lo > 1e-6) & (hi / np.maximum(lo, 1e-6) > ratio)
    return zA < zB, keep


def rim_ring(dis, r):
    """Visible texels within r of the band, and band texels within r of the visible side."""
    a = dis.astype(bool)
    grow = a.copy()
    for _ in range(r):
        g = grow.copy()
        g[1:, :] |= grow[:-1, :]; g[:-1, :] |= grow[1:, :]
        g[:, 1:] |= grow[:, :-1]; g[:, :-1] |= grow[:, 1:]
        grow = g
    out_ring = grow & ~a
    shrink = a.copy()
    for _ in range(r):
        s = shrink.copy()
        s[1:, :] &= shrink[:-1, :]; s[:-1, :] &= shrink[1:, :]
        s[:, 1:] &= shrink[:, :-1]; s[:, :-1] &= shrink[:, 1:]
        shrink = s
    return out_ring, a & ~shrink


def main_scored(gtp, probe, npairs, ratio, rimpx, outp):
    gt = np.load(gtp)
    meta, arr = load_probe(probe)
    pw, ph = meta['pw'], meta['ph']
    dis = arr['dis'] > 0
    cls, w, dep = gt['cls'], gt['w_disp'].astype(np.float32), gt['depth']
    H, W, K = cls.shape
    y0, x0 = (H - ph) // 2, (W - pw) // 2
    cls_c, w_c, dep_c = cls[y0:y0+ph, x0:x0+pw], w[y0:y0+ph, x0:x0+pw], dep[y0:y0+ph, x0:x0+pw]
    vis_hidden = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0)
    has_hidden = vis_hidden.any(axis=-1)
    kk = np.argmax(vis_hidden, axis=-1)
    z_hidden = np.take_along_axis(dep_c, kk[..., None], axis=-1)[..., 0]     # first ever-visible hidden layer, metres
    z_vis = dep_c[..., 0]                                                    # the visible surface, metres

    # THE TRUTH FIELD each pixel is judged on: inside the band the hidden surface, outside it the visible one.
    # A band texel with NO hidden truth (the envelope never reveals anything there) has no ordinal answer and is
    # excluded outright -- falling back to the visible depth would score the construction against the occluder.
    z_true = np.where(dis, z_hidden, z_vis)
    ok_true = np.isfinite(z_true) & (z_true > 0) & (has_hidden | ~dis)

    # EVERY CANDIDATE IS THE COMPOSITE THE APP ACTUALLY RENDERS: the construction inside the band, the observed
    # depth outside it. This is not a detail. farField.f32 is only defined on the band's free texels and holds
    # whatever the run law left elsewhere, and dQ IS the truth outside the band by construction -- so scoring the
    # raw arrays gives the do-nothing baseline a free correct endpoint on every family that touches visible pixels
    # (it scored 100.0% on `visible` and 99.4% on `rim` that way, which measures nothing). Composited, all
    # candidates agree outside the band and every family isolates the construction.
    obs = arr['dQ']
    if obs is None:
        print('no dQ.f32 in ' + probe + ': cannot composite, refusing to score'); return
    comp = lambda f: metres(np.where(dis, f, obs), meta)
    cands = {}
    if arr['ff'] is not None:
        cands['far field (shipped)'] = comp(arr['ff'])
    cands['do nothing'] = comp(obs)
    if arr['plateF'] is not None:
        cands['plate'] = comp(arr['plateF'][::-1])

    out_ring, in_ring = rim_ring(dis, rimpx)
    # THE RIM PAIRS ARE ADJACENT TEXELS, not two texels within r of each other. A random visible neighbour inside a
    # 6 px ring mixes the occluder side of the silhouette with the background side -- two opposite geometries -- and
    # the ratio filter then keeps a biased subset of whichever dominates. That family scored 4% on one scene and 31%
    # on another for reasons about the sampling, not the construction. Pairing each band texel with the visible
    # texel it actually BORDERS asks one well-posed question: is this bit of hidden surface nearer or farther than
    # the visible thing beside it. Split by side, because the two sides are different questions.
    idx = np.arange(pw * ph).reshape(ph, pw)
    rp = []
    for di, dj in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(np.roll(idx, -di, axis=0), -dj, axis=1)
        nbd = np.roll(np.roll(dis, -di, axis=0), -dj, axis=1)
        nbo = np.roll(np.roll(ok_true, -di, axis=0), -dj, axis=1)
        sel = dis & ok_true & ~nbd & nbo
        if di: sel[-1 if di > 0 else 0, :] = False
        if dj: sel[:, -1 if dj > 0 else 0] = False
        rp.append(np.stack([idx[sel], nb[sel]], axis=1))
    rim_adj = np.concatenate(rp) if rp else np.zeros((0, 2), np.int64)

    # the occluder, from the truth rather than a guess: visible texels whose own surface is much nearer than the
    # hidden surface behind them -- i.e. the things doing the hiding.
    occ = (~dis) & ok_true & (z_vis < 0.5 * np.nanmedian(z_hidden[dis & has_hidden]))
    families = {
        'band_band': (dis & ok_true, dis & ok_true),
        'occluder': (dis & ok_true, occ),
        'visible': ((~dis) & ok_true, (~dis) & ok_true),
    }

    print('scene %s  plate %dx%d  band %d px (%.1f%%)  truth hidden %d px'
          % (os.path.basename(probe), pw, ph, dis.sum(), 100*dis.mean(), has_hidden.sum()))
    print('DA-2K rule: a pair is kept only if the TRUE depth ratio exceeds %.2f, so the ordinal answer is not a'
          ' coin flip. rim ring %d px.' % (ratio, rimpx))
    res = {'scene': os.path.basename(probe), 'ratio': ratio, 'rimpx': rimpx, 'families': {}}
    names = list(cands)
    zt = z_true.ravel()

    def score(fam, pr):
        lab, keep = ordinal(zt[pr[:, 0]], zt[pr[:, 1]], ratio)
        pr, lab = pr[keep], lab[keep]
        if not len(pr):
            print('  %-16s %7d   (no pair survives the ratio rule)' % (fam, 0)); return None
        row = {}
        for n in names:
            zc = cands[n].ravel()
            row[n] = float(((zc[pr[:, 0]] < zc[pr[:, 1]]) == lab).mean())
        res['families'][fam] = {'pairs': int(len(pr)), 'accuracy': row}
        print('  %-16s %7d   ' % (fam, len(pr)) + ''.join('%27.1f%%' % (100 * row[n]) for n in names))
        return row

    print('\n  %-16s %7s   ' % ('family', 'pairs') + ''.join('%28s' % n for n in names))
    # The rim, split by which side the visible neighbour is truly on. Conditioning on the answer makes each half a
    # PER-CLASS RECALL rather than an accuracy, which is the point: a construction that always says "the band is
    # farther" scores 100% on one half and 0% on the other, and only the pair of numbers shows it. Their mean is the
    # balanced accuracy, and that is the unbiased single number for the rim.
    if len(rim_adj):
        za, zb = zt[rim_adj[:, 0]], zt[rim_adj[:, 1]]
        r1 = score('rim|nbr nearer', rim_adj[zb < za])
        r2 = score('rim|nbr farther', rim_adj[zb >= za])
        if r1 and r2:
            bal = {n: 0.5 * (r1[n] + r2[n]) for n in names}
            res['families']['rim|balanced'] = {'pairs': None, 'accuracy': bal}
            print('  %-16s %7s   ' % ('rim|BALANCED', '-') + ''.join('%27.1f%%' % (100 * bal[n]) for n in names))
    for fam, (mA, mB) in families.items():
        score(fam, sample_pairs(mA, mB, npairs, RNG))
    print('\n  chance is 50%. Every candidate is composited with the observed depth outside the band, so `visible`')
    print('  is identical for all of them by construction and is there to confirm the truth field, not to rank.')
    print('  `occluder` is a sanity family: below ~90% means hidden surface is being put in front of the thing')
    print('  hiding it. `band_band` is the one that isolates the construction -- both endpoints are hidden surface.')
    if outp:
        json.dump(res, open(outp, 'w'), indent=1); print('\n-> ' + outp)
    return res


def main_disagree(pa, pb, npairs, ratio, rimpx, outp):
    """No truth: DA-2K's SELECTION half. Rank pairs by how strongly two constructions disagree and emit them for
    adjudication. This does not score anything and must not be reported as if it did."""
    ma, aa = load_probe(pa); mb, ab = load_probe(pb)
    dis = aa['dis'] > 0
    za = metres(aa['ff'] if aa['ff'] is not None else aa['dQ'], ma)
    zb = metres(ab['ff'] if ab['ff'] is not None else ab['dQ'], mb)
    out_ring, in_ring = rim_ring(dis, rimpx)
    pr = sample_pairs(in_ring, out_ring, npairs * 4, RNG)
    la, ka = ordinal(za.ravel()[pr[:, 0]], za.ravel()[pr[:, 1]], ratio)
    lb, kb = ordinal(zb.ravel()[pr[:, 0]], zb.ravel()[pr[:, 1]], ratio)
    k = ka & kb
    pr, la, lb = pr[k], la[k], lb[k]
    dis_idx = np.flatnonzero(la != lb)
    print('rim pairs kept by both (ratio > %.2f): %d;  THE TWO CONSTRUCTIONS DISAGREE ON %d (%.1f%%)'
          % (ratio, len(pr), len(dis_idx), 100 * len(dis_idx) / max(1, len(pr))))
    print('these are the pairs worth a human answer -- DA-2K sends exactly this set to annotators')
    if outp and len(dis_idx):
        pw = ma['pw']
        sel = pr[dis_idx[:200]]
        rows = [{'ax': int(i % pw), 'ay': int(i // pw), 'bx': int(j % pw), 'by': int(j // pw),
                 'A_says_first_nearer': bool(la[dis_idx[n]]), 'B_says_first_nearer': bool(lb[dis_idx[n]])}
                for n, (i, j) in enumerate(sel)]
        json.dump({'probeA': pa, 'probeB': pb, 'ratio': ratio, 'pairs': rows}, open(outp, 'w'), indent=1)
        print('-> ' + outp + '  (%d pairs for adjudication)' % len(rows))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('args', nargs='*')
    ap.add_argument('--disagree', action='store_true')
    ap.add_argument('--pairs', type=int, default=20000)
    ap.add_argument('--ratio', type=float, default=1.5)
    ap.add_argument('--rimpx', type=int, default=6)
    ap.add_argument('--out', default=None)
    a = ap.parse_args()
    if a.disagree:
        main_disagree(a.args[0], a.args[1], a.pairs, a.ratio, a.rimpx, a.out)
    else:
        main_scored(a.args[0], a.args[1], a.pairs, a.ratio, a.rimpx, a.out)
