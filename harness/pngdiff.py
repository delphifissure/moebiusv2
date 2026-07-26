import struct, zlib, sys, os
def readpng(p):
    d=open(p,'rb').read(); i=8; idat=b''
    while i<len(d):
        ln=struct.unpack('>I',d[i:i+4])[0]; typ=d[i+4:i+8]; dat=d[i+8:i+8+ln]
        if typ==b'IHDR': w,h,bd,ct=struct.unpack('>IIBB',dat[:10])
        elif typ==b'IDAT': idat+=dat
        i+=8+ln+4
    raw=zlib.decompress(idat); ch=4 if ct==6 else 3; stride=w*ch
    out=bytearray(); prev=bytearray(stride); pos=0
    for y in range(h):
        f=raw[pos]; pos+=1; line=bytearray(raw[pos:pos+stride]); pos+=stride
        for x in range(stride):
            a=line[x-ch] if x>=ch else 0; b=prev[x]; c=prev[x-ch] if x>=ch else 0
            if f==1: line[x]=(line[x]+a)&255
            elif f==2: line[x]=(line[x]+b)&255
            elif f==3: line[x]=(line[x]+(a+b)//2)&255
            elif f==4:
                p=a+b-c; pa=abs(p-a); pb=abs(p-b); pc=abs(p-c)
                pr=a if (pa<=pb and pa<=pc) else (b if pb<=pc else c)
                line[x]=(line[x]+pr)&255
        out+=line; prev=line
    return w,h,ch,bytes(out)
d=sys.argv[1]
w,h,ch,F=readpng(os.path.join(d,'a150_footprintdeg.png'))
inside=[F[i+3]>=8 for i in range(0,len(F),ch)]
nin=sum(inside)
print('  footprint = %.1f%% of the canvas (%d px)'%(100*nin/(w*h), nin))
for deg in (0,25,45):
    _,_,_,A=readpng(os.path.join(d,'a149_%ddeg.png'%deg)); _,_,_,B=readpng(os.path.join(d,'a150_%ddeg.png'%deg))
    din=dout=0; sin=0; mxin=0
    for k in range(w*h):
        i=k*ch; dm=max(abs(A[i+c]-B[i+c]) for c in range(3))
        if inside[k]:
            sin+=dm
            if dm>2: din+=1
            if dm>mxin: mxin=dm
        elif dm>2: dout+=1
    print('  %3d deg  INSIDE footprint: %.3f%% differ >2 (mean %.3f, max %d)   OUTSIDE: %.3f%%'
          %(deg,100*din/nin,sin/nin,mxin,100*dout/max(1,w*h-nin)))
