"""CPU stand-ins for the four FlexGEMM pieces MoGe-3's sparse 3D refiner uses (flex_gemm.nn.SubmanifoldConv3d,
SparsePool3d, SparseUpsample3d, flex_gemm.ops.NeighborCache), so the refiner (refine_steps > 0) runs without CUDA.

The arithmetic follows FlexGEMM's own PyTorch reference path (flex_gemm/ops/spconv/submanifold_conv3d.py,
_compute_neighbor_cache_torch + the EXPLICIT_GEMM forward): weight (Co, Kw, Kh, Kd, Ci); the kernel offsets are a
meshgrid over (d1, d2, d3) in 'ij' order added to coords[:, 1:4]; out[p] = bias + sum_v W[:, v, :] in[p + offset_v]
(a missing neighbour contributes zero). Coordinates are (batch, i, j, z) int32; shapes are (B, I, J, Z, C) as MoGe-3
passes them. Pooling is the mean over each (b, i//f, j//f, z//f) cell; nearest upsampling gives each fine voxel its
parent cell's feature, in the order of the requested output coords (the U-Net adds the skip features by position).

  import cpu_flex_gemm; cpu_flex_gemm.install()   # before importing moge.model.v3
"""
import sys, types
import torch
import torch.nn as nn

CHUNK = 65536   # voxels per im2col chunk (27 x Ci floats each): bounds memory at level 0


def _keys(coords, dims):
    c = coords.long(); B, I, J, Z = dims
    return ((c[:, 0] * I + c[:, 1]) * J + c[:, 2]) * Z + c[:, 3]


class NeighborCache:
    def __init__(self, **kw): self.__dict__.update(kw)
    @property
    def T(self): return self


class SubmanifoldConv3d(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size=3, algorithm=None, bias=True, **kw):
        super().__init__()
        k = kernel_size if isinstance(kernel_size, int) else kernel_size[0]
        self.k = k
        self.weight = nn.Parameter(torch.zeros(out_channels, k, k, k, in_channels))
        self.bias = nn.Parameter(torch.zeros(out_channels)) if bias else None

    def _neighbours(self, coords, shape):
        B, I, J, Z = [int(s) for s in shape[:4]]; dims = (B, I + 2, J + 2, Z + 2)
        c = coords.long() + torch.tensor([0, 1, 1, 1])                      # pad by one so offsets never go negative
        keys = _keys(c, dims); sk, order = torch.sort(keys)
        r = torch.arange(-(self.k // 2), self.k // 2 + 1)
        off = torch.stack(torch.meshgrid(r, r, r, indexing='ij'), -1).reshape(-1, 3)   # (V, 3), FlexGEMM's order
        V = off.shape[0]; nb = torch.full((c.shape[0], V), -1, dtype=torch.long)
        for v in range(V):
            q = c.clone(); q[:, 1:] += off[v]
            qk = _keys(q, dims); idx = torch.searchsorted(sk, qk).clamp(max=sk.numel() - 1)
            hit = sk[idx] == qk; nb[hit, v] = order[idx[hit]]
        return NeighborCache(nbr=nb)

    def forward(self, feats, coords, shape, neighbor_cache=None):
        if neighbor_cache is None or not hasattr(neighbor_cache, 'nbr'): neighbor_cache = self._neighbours(coords, shape)
        nb = neighbor_cache.nbr; N, V = nb.shape; Co, Ci = self.weight.shape[0], self.weight.shape[-1]
        W = self.weight.reshape(Co, V * Ci).t().to(feats.dtype)
        pad = torch.cat([feats, feats.new_zeros(1, Ci)], 0)                    # row N = the zero feature of a missing neighbour
        out = feats.new_empty(N, Co)
        for s in range(0, N, CHUNK):
            e = min(N, s + CHUNK); idx = nb[s:e].clone(); idx[idx < 0] = N
            col = pad[idx.reshape(-1)].reshape(e - s, V * Ci)
            out[s:e] = col @ W if self.bias is None else torch.addmm(self.bias.to(feats.dtype), col, W)
        return out, neighbor_cache


class SparsePool3d(nn.Module):
    def __init__(self, kernel_size=2, stride=2, reduce='mean', **kw):
        super().__init__(); self.f = stride if isinstance(stride, int) else stride[0]; self.reduce = reduce

    def forward(self, feats, coords, shape, output_shape=None):
        f = self.f; c = coords.long(); pc = c.clone(); pc[:, 1:] = torch.div(pc[:, 1:], f, rounding_mode='floor')
        oshape = output_shape if output_shape is not None else torch.Size([shape[0]] + [(int(s) + f - 1) // f for s in shape[1:4]] + [shape[-1]])
        dims = tuple(int(s) for s in oshape[:4]); keys = _keys(pc, dims)
        uk, inv = torch.unique(keys, return_inverse=True)
        out = feats.new_zeros(uk.numel(), feats.shape[1]).index_add_(0, inv, feats)
        cnt = torch.zeros(uk.numel(), dtype=feats.dtype).index_add_(0, inv, torch.ones(inv.numel(), dtype=feats.dtype))
        if self.reduce == 'mean': out = out / cnt[:, None]
        Z, J, I = dims[3], dims[2], dims[1]
        oc = torch.stack([uk // (I * J * Z), (uk // (J * Z)) % I, (uk // Z) % J, uk % Z], 1).to(torch.int32)
        return out, oc, torch.Size(oshape), NeighborCache(parent=inv, factor=f)


class SparseUpsample3d(nn.Module):
    def __init__(self, scale_factor=2, mode='nearest', **kw):
        super().__init__(); self.f = scale_factor if isinstance(scale_factor, int) else scale_factor[0]

    def forward(self, feats, coords, shape, output_coords=None, output_shape=None, neighbor_cache=None):
        f = self.f; dims = tuple(int(s) for s in shape[:4])
        sk, order = torch.sort(_keys(coords, dims))
        pc = output_coords.long().clone(); pc[:, 1:] = torch.div(pc[:, 1:], f, rounding_mode='floor')
        qk = _keys(pc, dims); idx = torch.searchsorted(sk, qk).clamp(max=sk.numel() - 1)
        if not bool((sk[idx] == qk).all()): raise RuntimeError('cpu_flex_gemm upsample: a fine voxel has no parent cell')
        out = feats[order[idx]]
        oshape = torch.Size(list(output_shape[:4]) + [feats.shape[-1]])
        return out, output_coords, oshape, neighbor_cache


def install():
    fg = types.ModuleType('flex_gemm'); fgnn = types.ModuleType('flex_gemm.nn'); fgops = types.ModuleType('flex_gemm.ops')
    fgnn.SubmanifoldConv3d = SubmanifoldConv3d; fgnn.SparsePool3d = SparsePool3d; fgnn.SparseUpsample3d = SparseUpsample3d
    fgops.NeighborCache = NeighborCache; fg.nn = fgnn; fg.ops = fgops
    sys.modules.update({'flex_gemm': fg, 'flex_gemm.nn': fgnn, 'flex_gemm.ops': fgops})
