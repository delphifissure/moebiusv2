#!/usr/bin/env python3
"""FLUX.2 [klein] 4B (Black Forest Labs, Apache-2.0, step-distilled to 4 steps) as an in/outpainter on this CPU box.

The full diffusers checkpoint is ~16 GB (transformer 7.75 + Qwen3-4B text encoder 8.05) against ~8 GB of free disk and
15 GB of RAM, so:
  * the text encoder runs ONCE per prompt set, on klein's own bf16 weights streamed by HTTP range read into RAM (no
    disk; a GGUF route would dequantise to fp32, ~13 GB). klein's text encoder is stock Qwen3-4B (three norm tensors
    are bit-identical between the checkpoints). Only the first 28 of 36 layers are loaded (hidden_states 9, 18, 27 are
    the ones klein stacks). The prompt embeddings are saved to klein_embeds/.
  * the transformer is unsloth/FLUX.2-klein-4B-GGUF Q8_0 (4.3 GB), dequantised per layer to bf16 at compute time.
  * VAE and scheduler from the official repo (0.17 GB).

  python3 klein.py embed "prompt one" "prompt two" ...      # writes klein_embeds/<sha1>.pt
  python3 klein.py fetch                                     # transformer GGUF + VAE + scheduler
  (library) paint(image_u8, mask_bool, prompt) -> u8 image, the mask repainted
"""
import hashlib, os, sys, time
import numpy as np, torch
REPO = 'black-forest-labs/FLUX.2-klein-4B'
HERE = os.path.dirname(os.path.abspath(__file__))
EMB = os.path.join(HERE, 'klein_embeds')
torch.set_num_threads(4)


def key(p): return hashlib.sha1(p.encode()).hexdigest()[:16]


def _stream_te(n_layers=28):
    """klein's own text encoder, exact bf16, streamed by HTTP range read tensor by tensor straight into RAM (no disk):
    only the embedding and the first n_layers layers. 28, not 27: transformers replaces the LAST entry of hidden_states
    with the final-normed output, so the 27th layer's raw output (hidden_states[27]) needs one layer after it."""
    import json, struct, requests
    from huggingface_hub import hf_hub_download, hf_hub_url
    from transformers import Qwen3Config, Qwen3ForCausalLM
    cfg = Qwen3Config.from_pretrained(REPO, subfolder='text_encoder'); cfg.num_hidden_layers = n_layers
    cfg.layer_types = cfg.layer_types[:n_layers]
    with torch.device('meta'): te = Qwen3ForCausalLM(cfg)
    wm = json.load(open(hf_hub_download(REPO, 'text_encoder/model.safetensors.index.json')))['weight_map']
    want = {k: f for k, f in wm.items() if not k.startswith('model.layers.') or int(k.split('.')[2]) < n_layers}
    sess = requests.Session(); heads = {}
    def rng(url, a, b):
        for t in range(5):
            try:
                r = sess.get(url, headers={'Range': 'bytes=%d-%d' % (a, b)}, timeout=120); r.raise_for_status()
                if len(r.content) == b - a + 1: return r.content
            except Exception as e: print('retry', t, e, flush=True); time.sleep(2 ** t)
        raise RuntimeError('range read failed')
    sd = {}; t0 = time.time()
    for k, f in sorted(want.items()):
        url = hf_hub_url(REPO, 'text_encoder/' + f)
        if url not in heads:
            n = struct.unpack('<Q', rng(url, 0, 7))[0]; heads[url] = (json.loads(rng(url, 8, 8 + n - 1)), 8 + n)
        h, base = heads[url]; m = h[k]; a, b = m['data_offsets']; assert m['dtype'] == 'BF16'
        sd[k] = torch.frombuffer(bytearray(rng(url, base + a, base + b - 1)), dtype=torch.bfloat16).reshape(m['shape'])
    sd['lm_head.weight'] = sd['model.embed_tokens.weight']        # tied (config), never used for the hidden states
    te.load_state_dict(sd, strict=True, assign=True); te.eval()
    print('text encoder: %d tensors, %.2f GB, %.0f s' % (len(sd) - 1, sum(v.numel() for v in sd.values()) * 2 / 1e9, time.time() - t0), flush=True)
    return te


def embed(prompts):
    from transformers import AutoTokenizer
    from diffusers import Flux2KleinInpaintPipeline as P
    os.makedirs(EMB, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(REPO, subfolder='tokenizer')
    te = _stream_te()
    for p in prompts:
        t0 = time.time()
        with torch.no_grad():
            e = P._get_qwen3_prompt_embeds(te, tok, p, dtype=torch.bfloat16, device=torch.device('cpu'))
        torch.save(e, os.path.join(EMB, key(p) + '.pt'))
        print('embedded', repr(p), tuple(e.shape), round(time.time() - t0, 1), 's', flush=True)


def fetch():
    from huggingface_hub import hf_hub_download
    hf_hub_download('unsloth/FLUX.2-klein-4B-GGUF', 'flux-2-klein-4b-Q8_0.gguf')
    for f in ['vae/config.json', 'vae/diffusion_pytorch_model.safetensors', 'scheduler/scheduler_config.json', 'transformer/config.json', 'model_index.json']:
        hf_hub_download(REPO, f)
    print('fetched')


_pipe = None
def pipe():
    global _pipe
    if _pipe is None:
        from huggingface_hub import hf_hub_download
        from diffusers import Flux2KleinInpaintPipeline, Flux2Transformer2DModel, GGUFQuantizationConfig, AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler
        g = hf_hub_download('unsloth/FLUX.2-klein-4B-GGUF', 'flux-2-klein-4b-Q8_0.gguf')
        tr = Flux2Transformer2DModel.from_single_file(g, quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
                                                      config=REPO, subfolder='transformer', torch_dtype=torch.bfloat16)
        vae = AutoencoderKLFlux2.from_pretrained(REPO, subfolder='vae', torch_dtype=torch.bfloat16)
        sch = FlowMatchEulerDiscreteScheduler.from_pretrained(REPO, subfolder='scheduler')
        _pipe = Flux2KleinInpaintPipeline(scheduler=sch, vae=vae, text_encoder=None, tokenizer=None, transformer=tr, is_distilled=True)
        _pipe.set_progress_bar_config(disable=True)
    return _pipe


def paint(img_u8, mask, prompt, seed=1234, steps=4, long=768):
    """Repaint `mask` (bool HxW) of `img_u8` (HxWx3 uint8); returns HxWx3 uint8 (the caller keeps colour only on the mask)."""
    from PIL import Image
    e = torch.load(os.path.join(EMB, key(prompt) + '.pt'))
    H, W = mask.shape; s = long / max(H, W)
    Wm, Hm = int(round(W * s / 16) * 16), int(round(H * s / 16) * 16)      # klein works on 16-px patches
    r = pipe()(image=Image.fromarray(img_u8).resize((Wm, Hm), Image.LANCZOS), mask_image=Image.fromarray((mask * 255).astype(np.uint8)).resize((Wm, Hm), Image.NEAREST),
               prompt_embeds=e, height=Hm, width=Wm, strength=1.0, num_inference_steps=steps, guidance_scale=1.0,
               generator=torch.Generator().manual_seed(seed)).images[0]
    return np.asarray(r.resize((W, H), Image.LANCZOS))


if __name__ == '__main__':
    if sys.argv[1] == 'embed': embed(sys.argv[2:])
    elif sys.argv[1] == 'fetch': fetch()
