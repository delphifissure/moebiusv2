import numpy as np
W,H = 851,1023
def lut(delta):
    nd = np.linspace(0,1,1024)
    t = np.clip(nd/0.5,0,1); s_lo = 0.02*(1-(t*t*(3-2*t)))
    t2 = np.clip((nd-0.5)/0.5,0,1); s_hi = -0.04*(t2*t2*(3-2*t2))
    s = np.where(nd<0.5, s_lo, s_hi)
    return (delta * s/(0.20+s) * (W/0.16)).astype(np.float32)
def raster_pass(depth, color, shift_px, cut, axis):
    D = depth if axis==0 else depth.T
    C = color if axis==0 else color.transpose(1,0,2)
    S = shift_px if axis==0 else shift_px.T
    Hh,Ww = D.shape
    outC = np.zeros((Hh,Ww,3),np.float32); outZ = np.full((Hh,Ww),-1,np.float32)
    for y in range(Hh):
        dr, cr, xr = D[y], C[y], np.arange(Ww)+S[y]
        for i in range(Ww-1):
            if cut is not None and abs(dr[i+1]-dr[i]) > cut: continue
            x0,x1 = xr[i], xr[i+1]
            a,b = (x0,x1) if x0<=x1 else (x1,x0)
            ia,ib = max(0,int(np.ceil(a))), min(Ww-1,int(np.floor(b)))
            if ib<ia: continue
            t = (np.arange(ia,ib+1)-x0)/((x1-x0) if x1!=x0 else 1)
            zi = dr[i]+(dr[i+1]-dr[i])*t
            ci = cr[i][None,:]+(cr[i+1]-cr[i])[None,:]*t[:,None]
            m = zi > outZ[y,ia:ib+1]
            outZ[y,ia:ib+1][m]=zi[m]; outC[y,ia:ib+1][m]=ci[m]
    return (outC,outZ) if axis==0 else (outC.transpose(1,0,2), outZ.T)
def render(d_fg,c_fg,d_bg,c_bg,camx,camy):
    Lx, Ly = lut(camx), lut(camy)
    frame = np.zeros((H,W,3),np.float32); zbuf = np.full((H,W),-1,np.float32)
    for depth,color,cut in ((d_bg,c_bg,None),(d_fg,c_fg,0.008)):
        sx = np.interp(depth, np.linspace(0,1,1024), Lx).astype(np.float32)
        C,Z = raster_pass(depth,color,sx,cut,0)
        if abs(camy)>1e-6:
            sy = np.interp(np.where(Z>=0,Z,0), np.linspace(0,1,1024), Ly).astype(np.float32)
            C,Z = raster_pass(np.where(Z>=0,Z,0),C,sy,None if cut is None else 0.008,1)
        m = Z > zbuf
        frame[m]=C[m]; zbuf[m]=Z[m]
    return np.clip(frame,0,1)
