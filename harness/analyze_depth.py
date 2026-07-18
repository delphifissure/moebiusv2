import numpy as np
from PIL import Image, ImageDraw

H = '/workspace/moebiusv2/harness/'
def load(tag): return np.asarray(Image.open(H+'depth_'+tag+'.png').convert('L')).astype(np.int16)
base, raw, noramp, noadopt = load('base'), load('raw'), load('noramp'), load('noadopt')
h,w = base.shape
color = np.asarray(Image.open('/workspace/moebiusv2/starwatcher_color.png').convert('RGB').resize((w,h))).astype(np.float32)

regions = {
  'dune floor':   (0.30,0.90,0.55,0.99),
  'party':        (0.60,0.72,0.78,0.86),
  'astronaut':    (0.24,0.42,0.34,0.74),
  'mountain':     (0.62,0.50,0.80,0.80),
  'staff/glider': (0.20,0.28,0.45,0.60),
  'open sky':     (0.40,0.05,0.60,0.20),
}

def analyze(other, name):
    d = np.abs(base - other)
    ch = d > 2
    tot = h*w
    print(f'== {name} ==  changed {ch.sum()} px ({100*ch.mean():.2f}%), >12/255: {(d>12).sum()} px, mean|delta| on changed = {d[ch].mean() if ch.any() else 0:.1f}/255')
    for k,(fx0,fy0,fx1,fy1) in regions.items():
        x0,y0,x1,y1=int(fx0*w),int(fy0*h),int(fx1*w),int(fy1*h)
        sub = ch[y0:y1,x0:x1]
        print(f'    {k:14s}: {100*sub.mean():5.1f}% of region changed  ({sub.sum()} px)')
    # overlay: tint red by magnitude
    a = np.clip(d/60.0, 0, 1)[...,None]
    ov = color*(1-a) + np.array([255,0,0])*a
    ov = np.where((d>2)[...,None], ov, color)
    Image.fromarray(ov.astype(np.uint8)).save(H+'overlay_'+name+'.png')

analyze(noramp,  'ramp')
analyze(noadopt, 'adopt')
analyze(raw,     'total')

outs=[('overlay_ramp','RAMP-COLLAPSE footprint'),('overlay_adopt','STROKE-ADOPT footprint'),('overlay_total','ALL heuristics vs raw')]
ims=[(Image.open(H+t+'.png'),lab) for t,lab in outs]
sc=900/ims[0][0].width
ims=[(im.resize((int(im.width*sc),int(im.height*sc))),lab) for im,lab in ims]
W=sum(im.width for im,_ in ims)+30*(len(ims)+1); Ht=ims[0][0].height+30
canvas=Image.new('RGB',(W,Ht),(20,20,20)); dr=ImageDraw.Draw(canvas); x=15
for im,lab in ims:
    canvas.paste(im,(x,26)); dr.text((x,8),lab,fill=(255,150,150)); x+=im.width+30
canvas.save(H+'audit_overlays.png'); print('wrote audit_overlays.png', canvas.size)
