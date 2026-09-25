#!/usr/bin/env python3
"""Where does the depth pass belong relative to the colour pass? A known-answer test on the truth kit.

The question. A disocclusion fill needs two things in the hidden region: a colour and a depth. Either the depth is
completed first and the colour is painted to it (depth-first), or the colour is painted first and the depth is read off
the painted picture (colour-first). The truth kit holds every hidden layer's exact depth, so both orders can be scored
against the answer, next to the rule the app uses today (the plane law). Nothing is tuned per scene.

Scenes, pictures and classes (research/S26_depth_stage_test.md §1; built by S26's own ds_build.build, reused unchanged):
  For a kit scene with an env45 truth (out/<S>_env45/scope_gt.npz, plate 800x450) the texels with an ever-visible hidden
  layer are the hidden set m_peel1; the texels where a background / other-thing layer (class 2/3) is ever visible are m_bg.
  Two classes are scored, as in S26:
    bg   the first hidden layer that is background or another thing (class 2/3); region m_bg, truth d_bg.
         Its picture is S26's `bg` (the occluding object removed), its hole m_bg (+ revealed sky).
    own  the first hidden layer is the object's own back face (class 4/5); region m_peel1 & cls_first in {4,5},
         truth d_peel1. Its picture is S26's `peel1` (the front surface peeled off), its hole m_peel1 (+ revealed sky).
  Revealed sky has no finite depth and is excluded from every metres score (S26 §1). Every score is on the class region
  only, i.e. inside the hidden region.

Arms:
  rule          the plane law: plateF.f32 of an a257_probe dump of the scene (S26's probe_dir priority: _16plane_c, then
                _ceil, then the base plane probe), in metres through tk.app_z_of_d with the probe's pn/outer/inner. The
                probe's own band coverage of the region is reported (band_cover).
  depthlab      depth-first diffusion: DepthLab completes the depth BEFORE any colour exists. Inputs as S26's ds_depthlab.py
                (known depth = the true visible depth on m_fit, mask = everything else, unknown filled with the nearest
                known value as DepthLab's infer.py does), except the RGB: in depth-first order the only picture that
                exists is the SOURCE picture (rest.png), so that is what DepthLab sees. One completion per scene serves
                both classes (the known set does not depend on the class). Strength 0.8 (S26 default; --dl-strength 1.0
                optional, S26 §4). Scored raw (metric by construction), raw + clamp, and S26's global / local fit + clamp.
  colour        colour-first: paint the hidden region, then DA3-Mono-Large on the painted picture, aligned to the known
                depth outside the hole (S26's fits, visible texels only) and clamped behind the occluder's front
                (d >= d_vis at the same texel, a135). Headline = S26's local fit + clamp; global fit + clamp and the
                unclamped fits are also written. Painters (--painter):
                  truth  the truth's own colour = S26's pictures (upper bound: a perfect painter)
                  lama   LaMa (grt_eval.lama) on the source picture with the hole
                  sd     SD 1.5 inpainting + depth ControlNet (the pipeline of outpaint_eval.sd_fill / label_prompt_eval),
                         control = the source depth with the hole replaced by the RULE depth (plateF), prompt = today's
                         general prompt (label_prompt_eval GEN_PROMPT / GEN_NEG)
                For painter truth, --s26-cache can point at S26's out/ dir: its da3_{bg,peel1}.npy were computed on the
                very same pictures at process_res 1008 and are reused (only when --da3-res is 1008).

Cleanliness ("new cliffs"), for every arm variant: over 4-neighbour pairs, a pair is a STEP when the ratio of the two
metric eye distances (D + d, eye at D in front of the window, d metres behind it) exceeds the join ratio 1.05. A new
cliff is a step in the arm's depth that is not a step in the truth depth at the same pair. Reported separately:
  interior  both texels in the class region (finite truth): pairs, new_cliffs, missed (truth steps the arm lost),
            share_pairs = new_cliffs / pairs, share_px = region texels touching a new cliff / region texels
  seam      one texel in the region, the other a known visible texel (m_fit): the arm's depth (resp. the truth's) against
            d_vis. A seam cliff that the truth also has (e.g. the occluder's silhouette) is not counted.
  A prediction at infinity is scored at the scene's farthest finite surface (S26's infinity rule, ds_score.errs).

Constants, every one cited (no per-image choice):
  JOIN_RATIO 1.05          reveal.continuity t default = grt_eval.occluded / far_seed (Depth Pro's occluding-contour test
                           uses t in [1.05, 1.25]; the app's join test)
  D, pn, outer, inner      the scene's meta.json (truth geometry) and the probe's meta.json (rule depth law)
  fits (3 spaces, 2 rounds of 3x1.4826 MAD trimming, >= 100 kept; local radius sqrt(A/pi) >= 3 px, fallback to the
                           global fit under 100 ring texels; clamp d >= d_vis; infinity cap) S26 ds_score.py, loaded
                           from that file unchanged (robust_fit, scale_fit, align, local_align, errs)
  DA3_RES 1008             S8 bake-off / S26 ds_run.py (process_res, upper_bound_resize); --da3-res only for smoke tests
  DL_STEPS 20, DL_RES 768, DL_STRENGTH 0.8, guidance 1, blend on, seed 0   S26 ds_depthlab.py (DepthLab README ranges)
  SD_STEPS 20, SD_SEED 1234, strength 1.0, UniPC, SD1.5-inpainting + control_v11f1p_sd15_depth   outpaint_eval.sd_fill /
                           label_prompt_eval.py
  SD_PROMPT / SD_NEG       label_prompt_eval.GEN_PROMPT / GEN_NEG (= sd_return.py's prompt, grt_eval.KLEIN_PROMPT)
  sky colour, pictures     S26 ds_build.py

Usage (heavy phases are cached under --work and can be queued one at a time; the JSON is merged, not overwritten):
  python3 depth_order_eval.py --scenes S2 S5 --arms rule,colour --painter truth --out OUT.json
  python3 depth_order_eval.py --scenes ... --arms depthlab --dl-strength 0.8,1.0 --out OUT.json   (DepthLab venv python)
  python3 depth_order_eval.py --scenes ... --arms colour --painter lama,sd --out OUT.json
"""
import argparse, ast, gc, importlib.util, json, os, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, 'truthkit'))
from tk import app_z_of_d

SP = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad'
KIT_DEFAULT = '/home/user/moebiusv2/harness/truthkit'          # out/ is git-ignored: the kit's truth lives in the main worktree
S26_DEFAULT = '/home/user/moebius/research/s26'
PROBE_DEFAULT = '/home/user/moebiusv2/harness/shots/a257probe'
PROBE_SUFFIXES = '_16plane_c,_16planesky_c,_16plane_ceil,_16planesky_ceil,_16plane,_16planesky'   # ds_score.probe_dir
DA3_SRC_DEFAULT = f'{SP}/bakeoff/Depth-Anything-3/src'
DEPTHLAB_DEFAULT = f'{SP}/depthlab'                              # DepthLab-main/ + ckpt/ as S26's dl_weights.py lays them out

JOIN_RATIO = 1.05
DA3_RES = 1008
DL_STEPS, DL_RES, DL_STRENGTH = 20, 768, 0.8
SD_STEPS, SD_SEED = 20, 1234
SD_PROMPT = 'the background behind, continuous surfaces, natural texture'
SD_NEG = 'text, frame, border, watermark'
CLASSES = ('bg', 'own')
PIC_OF = {'bg': 'bg', 'own': 'peel1'}                             # the picture each class is completed in (S26 §1)

ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('--scenes', nargs='+', required=True)
ap.add_argument('--arms', default='rule,colour', help='comma list of rule, depthlab, colour')
ap.add_argument('--painter', default='truth', help='comma list of truth, lama, sd (colour-first arm)')
ap.add_argument('--out', required=True, help='JSON file (merged if it exists)')
ap.add_argument('--work', default=None, help='cache dir for pictures and model outputs (default: <out>_work)')
ap.add_argument('--kit', default=KIT_DEFAULT); ap.add_argument('--s26-dir', default=S26_DEFAULT)
ap.add_argument('--probe-root', default=PROBE_DEFAULT); ap.add_argument('--probe-suffixes', default=PROBE_SUFFIXES)
ap.add_argument('--s26-cache', default=None, help="S26's out/ dir: reuse its da3_{bg,peel1}.npy for painter truth")
ap.add_argument('--da3-src', default=DA3_SRC_DEFAULT); ap.add_argument('--da3-res', type=int, default=DA3_RES)
ap.add_argument('--depthlab-dir', default=DEPTHLAB_DEFAULT); ap.add_argument('--dl-strength', default=str(DL_STRENGTH))
ap.add_argument('--dl-steps', type=int, default=DL_STEPS); ap.add_argument('--dl-res', type=int, default=DL_RES)
ap.add_argument('--sd-steps', type=int, default=SD_STEPS); ap.add_argument('--seed', type=int, default=SD_SEED)
A = ap.parse_args()
ARMS = [a for a in A.arms.split(',') if a]; PAINTERS = [p for p in A.painter.split(',') if p]
WORK = A.work or os.path.splitext(A.out)[0] + '_work'; os.makedirs(WORK, exist_ok=True)
os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)


def log(*a): print(time.strftime('%H:%M:%S'), *a, flush=True)


# ---------------------------------------------------------------- S26 code, reused unchanged
def load_s26(d):
    """ds_score.py runs its whole scoring at import time, so its functions are taken from the source by name (ast) and
    executed on their own; ds_build.py has a main guard and is imported, with its kit and output dirs pointed here."""
    p = os.path.join(d, 'ds_score.py'); tree = ast.parse(open(p).read(), p)
    want = ('robust_fit', 'scale_fit', 'align', 'local_align', 'errs')
    body = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in want]
    missing = set(want) - {n.name for n in body}
    if missing: sys.exit(f'{p}: functions not found: {sorted(missing)}')
    ns = {'np': np, 'ndimage': ndimage}
    exec(compile(ast.Module(body=body, type_ignores=[]), p, 'exec'), ns)
    spec = importlib.util.spec_from_file_location('ds_build', os.path.join(d, 'ds_build.py'))
    b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
    b.TK = A.kit; b.OUT = WORK
    return ns, b


S26, DSB = load_s26(A.s26_dir)
align, local_align, errs = S26['align'], S26['local_align'], S26['errs']


def probe_dir(S):
    """ds_score.probe_dir with the root and the suffix priority as arguments."""
    for suf in A.probe_suffixes.split(','):
        p = f'{A.probe_root}/{S}{suf}'
        if os.path.exists(f'{p}/plateF.f32') and os.path.exists(f'{p}/meta.json'): return p
    return None


# ---------------------------------------------------------------- scene data
def scene(S):
    """Build (once) S26's pictures and truth for S in WORK/<S>/ and load them."""
    if not os.path.exists(f'{WORK}/{S}/truth.npz'): DSB.build(S)
    t = dict(np.load(f'{WORK}/{S}/truth.npz'))
    meta = json.load(open(f'{A.kit}/out/{S}/meta.json'))
    t['D'] = float(meta['D']); pw, ph = int(t['pw']), int(t['ph'])
    t['own'] = t['m_peel1'] & np.isin(t['cls_first'], (4, 5))
    t['region'] = {'bg': t['m_bg'], 'own': t['own']}
    t['truth'] = {'bg': t['d_bg'], 'own': t['d_peel1']}
    t['hole'] = {'bg': t['m_bg'] | t['sky'], 'peel1': t['m_peel1'] | t['sky']}     # what a painter must fill
    t['hid'] = {'bg': t['m_bg'], 'peel1': t['m_peel1']}                            # the hidden set of each picture (local fit)
    dv = t['d_vis']
    sets = [t['d_bg'][t['m_bg']], t['d_peel1'][t['m_peel1']], dv[np.isfinite(dv)]]
    t['cap'] = float(max(np.nanmax(np.where(np.isfinite(s), s, np.nan)) for s in sets if s.size))   # ds_score's cap
    t['rest_u8'] = np.array(Image.open(f'{WORK}/{S}/rest.png').convert('RGB'))
    dn = np.asarray(Image.open(f'{A.kit}/out/{S}/rest_depth16.png'), np.float32) / 65535.0
    t['dn_src'] = dn if dn.shape == (ph, pw) else np.asarray(Image.fromarray(dn).resize((pw, ph), Image.NEAREST), np.float32)
    pd = probe_dir(S); t['probe'] = pd
    if pd:
        pm = json.load(open(f'{pd}/meta.json'))
        pf = np.fromfile(f'{pd}/plateF.f32', np.float32).reshape(ph, pw)[::-1]          # stored bottom-up (ds_score)
        t['rule_dn'] = pf.copy(); t['rule_m'] = -app_z_of_d(pf, pm['pn'], pm['outer'], pm['inner'])
        dis = f'{pd}/disocc.u8'
        t['band'] = np.fromfile(dis, np.uint8).reshape(ph, pw) > 0 if os.path.exists(dis) else None
    return t


# ---------------------------------------------------------------- scoring
def clamp(d, dv): return np.maximum(d, np.where(np.isfinite(dv), dv, -np.inf))


def cliffs(pred, t, c):
    """New cliffs of `pred` inside class c's region (see the module docstring)."""
    reg = t['region'][c] & np.isfinite(t['truth'][c]); D = t['D']; cap = t['cap']
    p = np.where(np.isfinite(pred), pred, cap); tr = np.where(reg, t['truth'][c], np.nan)
    known = t['m_fit'] & np.isfinite(t['d_vis'])
    mp = D + np.where(reg, p, np.where(known, t['d_vis'], np.nan))          # composite: arm in the region, d_vis outside
    mt = D + np.where(reg, tr, np.where(known, t['d_vis'], np.nan))
    step = lambda a, b: np.maximum(a, b) / np.maximum(1e-12, np.minimum(a, b)) > JOIN_RATIO
    out = {'interior': dict(pairs=0, new_cliffs=0, missed=0, truth_steps=0), 'seam': dict(pairs=0, new_cliffs=0, missed=0, truth_steps=0)}
    touch = np.zeros(reg.shape, bool)
    for ax in (0, 1):
        sl0 = (slice(None, -1), slice(None)) if ax == 0 else (slice(None), slice(None, -1))
        sl1 = (slice(1, None), slice(None)) if ax == 0 else (slice(None), slice(1, None))
        r0, r1 = reg[sl0], reg[sl1]; k0, k1 = known[sl0], known[sl1]
        sp = step(mp[sl0], mp[sl1]); st = step(mt[sl0], mt[sl1]); new = sp & ~st; miss = st & ~sp
        for name, pr in (('interior', r0 & r1), ('seam', (r0 & k1 & ~r1) | (r1 & k0 & ~r0))):
            o = out[name]; o['pairs'] += int(pr.sum()); o['new_cliffs'] += int((new & pr).sum())
            o['missed'] += int((miss & pr).sum()); o['truth_steps'] += int((st & pr).sum())
        ni = new & r0 & r1; touch[sl0] |= ni; touch[sl1] |= ni
    n = int(reg.sum())
    for o in out.values(): o['share_pairs'] = o['new_cliffs'] / o['pairs'] if o['pairs'] else None
    out['interior']['share_px'] = float(touch.sum() / n) if n else None
    return out


def score(pred, t, c):
    e = errs(pred, t['truth'][c], t['region'][c], t['cap'])
    if e is None: return None
    e['cliffs'] = cliffs(pred, t, c); return e


def fit_variants(m, t, pic, raw_metric=False):
    """S26's alignment of a model output m on the visible texels; returns {variant: depth map}."""
    m = m.astype(np.float64); dv = t['d_vis'].astype(np.float64); vm = np.ones(m.shape, bool)
    name, dp, rvis, ab = align(m, vm, dv, t['m_fit'])
    dl, ncomp = local_align(m, vm, dv, t['m_fit'], t['hid'][pic])
    v = {'global': dp, 'global_clamp': clamp(dp, dv), 'local': dl, 'local_clamp': clamp(dl, dv)}
    if raw_metric: v.update({'raw': m, 'raw_clamp': clamp(m, dv)})
    info = {'space': name, 'vis_median_abs': rvis, 'ab': [float(ab[0]), float(ab[1])], 'local_components': int(ncomp)}
    return v, info


# ---------------------------------------------------------------- painters
def paint_path(S, painter, pic): return f'{WORK}/{S}/{pic}.png' if painter == 'truth' else f'{WORK}/{S}/paint_{painter}_{pic}.png'


_lama = None
def paint_lama(t, hole):
    global _lama
    if _lama is None:
        argv = sys.argv; sys.argv = [argv[0]]
        import grt_eval as G                    # grt_eval parses its own args at import; give it none (outpaint_eval does the same)
        sys.argv = argv; _lama = G
    img = t['rest_u8'].astype(np.float32) / 255
    return _lama.lama(img, hole)


_sd = None
def paint_sd(t, hole):
    """outpaint_eval.sd_fill / label_prompt_eval's sd(): that code is not importable (both scripts parse args and run at
    import), so the same pipeline, settings and call are restated here. Control = source depth, hole := the rule depth."""
    global _sd
    import torch
    if _sd is None:
        from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler
        torch.set_num_threads(4)
        cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
        _sd = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                       torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
        _sd.scheduler = UniPCMultistepScheduler.from_config(_sd.scheduler.config); _sd.set_progress_bar_config(disable=True)
    if 'rule_dn' not in t: raise RuntimeError('painter sd needs the rule depth as control: no probe dump for this scene')
    img = t['rest_u8'].astype(np.float32) / 255; seen = img.copy(); seen[hole] = 0
    dctl = t['dn_src'].copy(); dctl[hole] = t['rule_dn'][hole]
    H, W = hole.shape; Ws, Hs = int(round(W / 8) * 8), int(round(H / 8) * 8)
    ctl = Image.fromarray(np.round(np.clip(dctl, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((Ws, Hs), Image.BILINEAR)
    r = _sd(prompt=SD_PROMPT, negative_prompt=SD_NEG, image=Image.fromarray((seen * 255).astype(np.uint8)).resize((Ws, Hs), Image.LANCZOS),
            mask_image=Image.fromarray((hole * 255).astype(np.uint8)).resize((Ws, Hs), Image.NEAREST), control_image=ctl,
            num_inference_steps=A.sd_steps, generator=torch.Generator().manual_seed(A.seed), strength=1.0, width=Ws, height=Hs).images[0]
    return np.asarray(r.resize((W, H), Image.LANCZOS), np.float32) / 255


def pics_needed(t): return sorted({PIC_OF[c] for c in CLASSES if t['region'][c].any()})


def paint_all(T, painter):
    for S, t in T.items():
        for pic in pics_needed(t):
            p = paint_path(S, painter, pic)
            if os.path.exists(p): continue
            hole = t['hole'][pic]; t0 = time.time()
            fill = paint_lama(t, hole) if painter == 'lama' else paint_sd(t, hole)
            comp = t['rest_u8'].copy(); comp[hole] = np.round(np.clip(fill[hole], 0, 1) * 255).astype(np.uint8)
            Image.fromarray(comp).save(p); log('painted', S, pic, painter, f'{time.time() - t0:.0f}s')


# ---------------------------------------------------------------- DA3 (S26 ds_run.py's call)
_da3 = None
def da3(path):
    global _da3
    import torch
    if _da3 is None:
        torch.set_num_threads(4); sys.path.insert(0, A.da3_src)
        from depth_anything_3.api import DepthAnything3
        _da3 = DepthAnything3.from_pretrained('depth-anything/DA3MONO-LARGE').to(device='cpu').eval()
    with torch.no_grad(): pred = _da3.inference([path], process_res=A.da3_res, process_res_method='upper_bound_resize')
    d = np.asarray(pred.depth[0], np.float32); W, H = Image.open(path).size
    if d.shape != (H, W): d = np.array(Image.fromarray(d, mode='F').resize((W, H), Image.BILINEAR), np.float32)
    return d


def da3_all(T, painter):
    out = {}
    for S in T:
        for pic in pics_needed(T[S]):
            o = f'{WORK}/{S}/da3r{A.da3_res}_{painter}_{pic}.npy'
            s26 = f'{A.s26_cache}/{S}/da3_{pic}.npy' if A.s26_cache else None
            if not os.path.exists(o) and painter == 'truth' and A.da3_res == 1008 and s26 and os.path.exists(s26):
                np.save(o, np.load(s26)); log('reused S26 DA3 output', s26)
            if not os.path.exists(o):
                t0 = time.time(); np.save(o, da3(paint_path(S, painter, pic))); log('da3', S, pic, painter, f'{time.time() - t0:.0f}s')
            out[(S, pic)] = np.load(o)
    return out


# ---------------------------------------------------------------- DepthLab (S26 ds_depthlab.py, depth-first input)
def depthlab_all(T, strengths):
    """S26's ds_depthlab.py as functions: conditioning for every job first, encoders freed, then the two UNets.
    RGB = the SOURCE picture (depth-first: no colour has been painted yet). Returns {(S, strength): metric depth}."""
    jobs = [(S, s) for S in T for s in strengths if not os.path.exists(f'{WORK}/{S}/depthlab_s{s:g}_rest.npy')]
    if jobs:
        import torch
        DL = A.depthlab_dir; CK = f'{DL}/ckpt'; MG = f'{CK}/marigold-depth-v1-0'
        for need in (f'{DL}/DepthLab-main', f'{CK}/DepthLab/denoising_unet.fp16.pth', MG, f'{CK}/clip-h-vision-fp16'):
            if not os.path.exists(need): sys.exit(f'DepthLab not installed: {need} missing (code: github.com/Johanan0528/DepthLab -> '
                                                  f'{DL}/DepthLab-main; weights: {A.s26_dir}/dl_weights.py run inside {DL})')
        sys.path.insert(0, f'{DL}/DepthLab-main'); torch.set_num_threads(4); np.random.seed(0)
        from diffusers import DDIMScheduler, AutoencoderKL
        from transformers import CLIPTextModel, CLIPTokenizer, CLIPVisionModelWithProjection, CLIPImageProcessor
        from src.models.unet_2d_condition import UNet2DConditionModel
        from src.models.unet_2d_condition_main import UNet2DConditionModel_main
        from src.models.projection import My_proj
        from src.models.mutual_self_attention import ReferenceAttentionControl
        from inference.depthlab_pipeline import DepthLabPipeline
        mapping = My_proj(); mapping.load_state_dict(torch.load(f'{CK}/DepthLab/mapping_layer.pth', map_location='cpu'), strict=False); mapping.eval()
        img_enc = CLIPVisionModelWithProjection.from_pretrained(f'{CK}/clip-h-vision-fp16', torch_dtype=torch.float32).eval(); proc = CLIPImageProcessor()
        tok = CLIPTokenizer.from_pretrained(MG, subfolder='tokenizer')
        txt = CLIPTextModel.from_pretrained(MG, subfolder='text_encoder', variant='fp16', torch_dtype=torch.float32).eval()
        with torch.no_grad():
            ids = tok('', padding='do_not_pad', max_length=tok.model_max_length, truncation=True, return_tensors='pt').input_ids
            uncond = txt(ids)[0][:, 0, :].unsqueeze(0)
            cond = {S: mapping(img_enc(proc.preprocess(Image.open(f'{WORK}/{S}/rest.png').convert('RGB'), return_tensors='pt').pixel_values).image_embeds.unsqueeze(1))
                    for S in {S for S, _ in jobs}}
        del img_enc, txt; gc.collect(); log('depthlab conditioning done')
        cfg = json.load(open(f'{MG}/unet/config.json'))
        den = UNet2DConditionModel_main.from_config({**cfg, 'in_channels': 12, 'sample_size': 96})
        den.load_state_dict(torch.load(f'{CK}/DepthLab/denoising_unet.fp16.pth', map_location='cpu'), strict=False)
        ref = UNet2DConditionModel.from_config({**cfg, 'in_channels': 4, 'sample_size': 96})
        ref.load_state_dict(torch.load(f'{CK}/DepthLab/reference_unet.fp16.pth', map_location='cpu'))
        den = den.float().eval(); ref = ref.float().eval()
        vae = AutoencoderKL.from_pretrained(MG, subfolder='vae', variant='fp16', torch_dtype=torch.float32).eval()
        sched = DDIMScheduler.from_pretrained(MG, subfolder='scheduler')
        class Dummy(torch.nn.Module):
            device = torch.device('cpu'); dtype = torch.float32
        pipe = DepthLabPipeline(reference_unet=ref, denoising_unet=den, mapping_layer=mapping, vae=vae, text_encoder=None, tokenizer=None,
                                image_enc=Dummy(), scheduler=sched)
        def _fp32(fn):
            def w(x):
                with torch.autocast('cpu', enabled=False): return fn(x.float())
            return w
        pipe.decode_depth = _fp32(pipe.decode_depth); pipe.encode_depth = _fp32(pipe.encode_depth); pipe.encode_RGB = _fp32(pipe.encode_RGB)
        rs = lambda a, W, H, nearest: np.array(Image.fromarray(a).resize((W, H), Image.NEAREST if nearest else Image.BICUBIC))
        with torch.no_grad():
            for S, s in jobs:
                t = T[S]; pw, ph = int(t['pw']), int(t['ph'])
                known = t['m_fit'] & np.isfinite(t['d_vis']); mask = ~known
                idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
                dk = t['d_vis'][tuple(idx)].astype(np.float32); dk[~np.isfinite(dk)] = float(np.nanmax(np.where(known, t['d_vis'], np.nan)))
                sc = min(A.dl_res / pw, A.dl_res / ph); W = int(pw * sc) // 8 * 8; H = int(ph * sc) // 8 * 8
                rgb = np.asarray(Image.open(f'{WORK}/{S}/rest.png').convert('RGB').resize((W, H), Image.BICUBIC)).astype(np.float32) / 255 * 2 - 1
                image = torch.from_numpy(rgb.transpose(2, 0, 1))[None]
                depth = torch.from_numpy(rs(dk, W, H, True).astype(np.float32))[None, None]
                mk = torch.from_numpy(rs(mask.astype(np.uint8), W, H, True).astype(np.float32))[None, None]
                writer = ReferenceAttentionControl(ref, do_classifier_free_guidance=True, mode='write', batch_size=1, fusion_blocks='full')
                reader = ReferenceAttentionControl(den, do_classifier_free_guidance=True, mode='read', batch_size=1, fusion_blocks='full')
                t0 = time.time(); torch.manual_seed(0)
                pred, vmax, vmin = pipe.single_infer(image=image, depth=depth, mask=mk, num_inference_steps=A.dl_steps, show_pbar=False, guidance_scale=1,
                                                     encoder_hidden_states=torch.cat([uncond, cond[S]], 0), reference_control_writer=writer,
                                                     reference_control_reader=reader, strength=s, blend=True, normalize_scale=1, generator=None)
                d = (pred.float() * (vmax - vmin) + vmin).squeeze().cpu().numpy().astype(np.float32)
                d = np.array(Image.fromarray(d, mode='F').resize((pw, ph), Image.BILINEAR), np.float32).clip(min=0)
                np.save(f'{WORK}/{S}/depthlab_s{s:g}_rest.npy', d)
                log('depthlab', S, f'strength {s:g}', f'{time.time() - t0:.0f}s', f'visible median |err| {np.median(np.abs(d - t["d_vis"])[known]):.4f} m')
        del pipe, den, ref, vae; gc.collect()
    return {(S, s): np.load(f'{WORK}/{S}/depthlab_s{s:g}_rest.npy') for S in T for s in strengths}


# ---------------------------------------------------------------- main
res = json.load(open(A.out)) if os.path.exists(A.out) else {}
res['_config'] = dict(JOIN_RATIO=JOIN_RATIO, DA3_RES=A.da3_res, DL_STEPS=A.dl_steps, DL_RES=A.dl_res, SD_STEPS=A.sd_steps, SD_SEED=A.seed,
                      SD_PROMPT=SD_PROMPT, SD_NEG=SD_NEG, probe_root=A.probe_root, probe_suffixes=A.probe_suffixes, kit=A.kit, s26_dir=A.s26_dir)
T = {S: scene(S) for S in A.scenes}


def put(S, c, arm, variants, extra=None):
    t = T[S]; R = res.setdefault(S, {})
    R['probe'] = os.path.basename(t['probe']) if t['probe'] else None
    C = R.setdefault(c, {}); C['n'] = int((t['region'][c] & np.isfinite(t['truth'][c])).sum())
    C['truth_p5_p95'] = [float(np.nanpercentile(t['truth'][c][t['region'][c]], q)) for q in (5, 95)] if C['n'] else None
    C[arm] = {**(extra or {}), **{k: score(v, t, c) for k, v in variants.items()}}


for S, t in T.items():
    if 'rule' not in ARMS: break
    if 'rule_m' not in t: log(S, 'rule: no probe dump under', A.probe_root, 'with suffixes', A.probe_suffixes, '- skipped'); continue
    for c in CLASSES:
        if t['region'][c].any():
            band = t['band']; reg = t['region'][c]
            put(S, c, 'rule', {'raw': t['rule_m']}, {'band_cover': float((reg & band).sum() / max(1, reg.sum())) if band is not None else None})

if 'depthlab' in ARMS:
    strengths = [float(x) for x in A.dl_strength.split(',')]
    DLo = depthlab_all(T, strengths)
    for (S, s), d in DLo.items():
        for c in CLASSES:
            if not T[S]['region'][c].any(): continue
            v, info = fit_variants(d, T[S], PIC_OF[c], raw_metric=True); put(S, c, f'depthlab_s{s:g}', v, {'fit': info, 'rgb': 'rest'})

if 'colour' in ARMS:
    for painter in PAINTERS:
        if painter in ('lama', 'sd'):
            paint_all(T, painter)
            if _lama is not None: _lama._lama = None                                  # the model lives in grt_eval
            globals()['_lama'] = None; globals()['_sd'] = None; gc.collect()       # free the painter before DA3 loads
        D3 = da3_all(T, painter)
        for S, t in T.items():
            for c in CLASSES:
                if not t['region'][c].any(): continue
                v, info = fit_variants(D3[(S, PIC_OF[c])], t, PIC_OF[c])
                put(S, c, f'colour_{painter}', v, {'fit': info, 'da3_res': A.da3_res, 'picture': os.path.basename(paint_path(S, painter, PIC_OF[c]))})

json.dump(res, open(A.out, 'w'), indent=1)
log('wrote', A.out)

# table: median |err| (m) and interior new cliffs (count, share of region texels) per scene, class, arm variant
print(f"{'scene':6} {'cls':4} {'n':>6} {'arm':18} {'variant':13} {'med|e| m':>9} {'p90 m':>8} {'cliffs':>7} {'px%':>6} {'seam':>6}")
for S in A.scenes:
    for c in CLASSES:
        C = res.get(S, {}).get(c)
        if not C: continue
        for arm, V in C.items():
            if not isinstance(V, dict) or arm in ('n',): continue
            for var, e in V.items():
                if not isinstance(e, dict) or 'median_abs' not in e: continue
                ci = e['cliffs']['interior']; cs = e['cliffs']['seam']
                print(f"{S:6} {c:4} {C['n']:6d} {arm:18} {var:13} {e['median_abs']:9.4f} {e['p90_abs']:8.4f} {ci['new_cliffs']:7d} "
                      f"{100 * (ci['share_px'] or 0):6.2f} {cs['new_cliffs']:6d}")
