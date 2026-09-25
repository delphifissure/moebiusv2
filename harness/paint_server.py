#!/usr/bin/env python3
"""The paint stage as a local service, for the app's one-click "Paint holes" (S70).

The app bakes, writes the same SD bundle the "SD Bundle" button downloads, and POSTs it here; this runs sd_return.py on
it (the painter the user picked) and hands back the return_band_*.png files, which the app imports through the same path
as "Import plane return". Nothing here decides anything about the painting: it is sd_return.py, run as a subprocess.

One job at a time: SD + ControlNet + DA3 on CPU is about 7 GB, and two at once were OOM-killed on a 15 GB machine.

  python3 harness/paint_server.py [--port 8765] [--host 127.0.0.1]

  POST /paint?painter=sd&depth=1[&sdmask=blob][&refine=0.5][&steps=20]   body: the bundle zip  -> {"job": id}
  GET  /job/<id>        -> {"state": queued|running|done|failed, "elapsed": s, "log": last lines, "files": [...]}
  GET  /job/<id>/files  -> {"<name>.png": base64, ...}   (return_band*_*.png only)
  POST /segment?method=owl_sam   body: the picture (PNG)  -> {"job": id}   (Find objects: segment/seg_run.py)
  GET  /job/<id>/files  -> for a segment job: masks.json and mask_*.png
  GET  /health          -> {"ok": true, "busy": bool, "queue": n}

The app's own server (server.js) forwards /paint, /job and /health here (PAINT_URL), so the page reaches it same-origin
on http and https; a page served elsewhere can call it directly (CORS is open to any origin: it listens on loopback).
"""
import argparse, base64, json, os, subprocess, sys, tempfile, threading, time, uuid, queue
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
PAINTERS = ('sd', 'lama', 'lama+sd', 'wash+sd')          # sd_return.py --painter choices
SDMASKS = ('asis', 'hull', 'blob')
SEG_METHODS = ('owl_sam', 'gdino_sam', 'birefnet', 'sam3')   # segment/seg_models.py
JOBS, Q = {}, queue.Queue()


def args_for(q):
    """query -> sd_return.py flags; anything not in its own choices is refused, not passed through."""
    a = []
    p = q.get('painter', ['sd'])[0]
    if p not in PAINTERS: raise ValueError('painter must be one of ' + ', '.join(PAINTERS))
    a += ['--painter', p]
    m = q.get('sdmask', [None])[0]
    if m is not None:
        if m not in SDMASKS: raise ValueError('sdmask must be one of ' + ', '.join(SDMASKS))
        a += ['--sdmask', m]
    for k, t in (('refine', float), ('steps', int), ('seed', int), ('long', int)):
        v = q.get(k, [None])[0]
        if v is not None: a += ['--' + k, str(t(v))]
    if q.get('depth', ['1'])[0] not in ('0', 'false', 'off'): a.append('--depth')
    pr = q.get('prompt', [None])[0]
    if pr: a += ['--prompt', pr[:300]]
    return a


def worker():
    while True:
        jid = Q.get(); j = JOBS[jid]
        j['state'] = 'running'; j['t0'] = time.time()
        if j.get('kind') == 'segment': cmd = [sys.executable, '-u', os.path.join(HERE, 'segment', 'seg_run.py'), j['bundle'], j['out']] + j['args']
        else: cmd = [sys.executable, '-u', os.path.join(HERE, 'sd_return.py'), j['bundle'], j['out']] + j['args']
        j['cmd'] = cmd
        with open(j['logf'], 'w') as lf:
            r = subprocess.run(cmd, cwd=os.path.dirname(HERE), stdout=lf, stderr=subprocess.STDOUT)
        j['rc'] = r.returncode; j['t1'] = time.time()
        if j.get('kind') == 'segment':
            j['files'] = sorted(f for f in (os.listdir(j['out']) if os.path.isdir(j['out']) else []) if f == 'masks.json' or (f.startswith('mask_') and f.endswith('.png')))
            j['state'] = 'done' if (r.returncode == 0 and 'masks.json' in j['files']) else 'failed'
        else:
            j['files'] = sorted(f for f in (os.listdir(j['out']) if os.path.isdir(j['out']) else []) if f.startswith('return_band') and f.endswith('.png'))
            j['state'] = 'done' if (r.returncode == 0 and any(f.startswith('return_band_colo') for f in j['files'])) else 'failed'
        Q.task_done()


def tail(path, n=6):
    try:
        with open(path, 'rb') as f:
            lines = [l for l in f.read().decode('utf8', 'replace').replace('\r', '\n').split('\n') if l.strip() and 'warn' not in l.lower()]
        return lines[-n:]
    except OSError:
        return []


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b)))
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):                                  # CORS preflight (a zip body is not a "simple" request)
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type'); self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path); parts = [p for p in u.path.split('/') if p]
        if parts == ['health']:
            return self._send(200, {'ok': True, 'busy': any(j['state'] == 'running' for j in JOBS.values()), 'queue': Q.qsize(), 'painters': PAINTERS, 'segment': SEG_METHODS})
        if len(parts) >= 2 and parts[0] == 'job' and parts[1] in JOBS:
            j = JOBS[parts[1]]
            if len(parts) == 3 and parts[2] == 'files':
                if j['state'] != 'done': return self._send(409, {'error': 'job is ' + j['state']})
                out = {}
                for f in j['files']:
                    with open(os.path.join(j['out'], f), 'rb') as fh: out[f] = base64.b64encode(fh.read()).decode()
                return self._send(200, out)
            now = j.get('t1') or time.time()
            return self._send(200, {'state': j['state'], 'elapsed': round(now - j['t0'], 1) if j.get('t0') else 0,
                                    'queuedAhead': sum(1 for k in list(JOBS) if JOBS[k]['state'] == 'queued' and JOBS[k]['n'] < j['n']),
                                    'log': tail(j['logf']), 'files': j.get('files', []), 'rc': j.get('rc'), 'args': j['args']})
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.rstrip('/') == '/segment': return self._segment(u)
        if u.path.rstrip('/') != '/paint': return self._send(404, {'error': 'not found'})
        try: a = args_for(parse_qs(u.query))
        except ValueError as e: return self._send(400, {'error': str(e)})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 512 * 1024 * 1024: return self._send(400, {'error': 'body must be the bundle zip'})
        body = self.rfile.read(n)
        if body[:2] != b'PK': return self._send(400, {'error': 'body is not a zip'})
        jid = uuid.uuid4().hex[:12]; d = tempfile.mkdtemp(prefix='paint_' + jid + '_')
        with open(os.path.join(d, 'bundle.zip'), 'wb') as f: f.write(body)
        JOBS[jid] = {'state': 'queued', 'n': len(JOBS), 'bundle': os.path.join(d, 'bundle.zip'), 'out': os.path.join(d, 'return'),
                     'logf': os.path.join(d, 'paint.log'), 'args': a}
        Q.put(jid)
        self._send(200, {'job': jid, 'args': a})

    def _segment(self, u):
        m = parse_qs(u.query).get('method', ['owl_sam'])[0]
        if m not in SEG_METHODS: return self._send(400, {'error': 'method must be one of ' + ', '.join(SEG_METHODS)})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 64 * 1024 * 1024: return self._send(400, {'error': 'body must be the picture (PNG)'})
        body = self.rfile.read(n)
        if body[:8] != b'\x89PNG\r\n\x1a\n': return self._send(400, {'error': 'body is not a PNG'})
        jid = uuid.uuid4().hex[:12]; d = tempfile.mkdtemp(prefix='seg_' + jid + '_')
        with open(os.path.join(d, 'picture.png'), 'wb') as f: f.write(body)
        JOBS[jid] = {'state': 'queued', 'n': len(JOBS), 'kind': 'segment', 'bundle': os.path.join(d, 'picture.png'), 'out': os.path.join(d, 'masks'),
                     'logf': os.path.join(d, 'seg.log'), 'args': ['--method', m]}
        Q.put(jid); self._send(200, {'job': jid, 'args': ['--method', m]})

    def log_message(self, fmt, *args):                    # the app polls every 2 s: keep the console to POSTs
        if self.command == 'POST': sys.stderr.write('[paint] ' + (fmt % args) + '\n')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--port', type=int, default=8765); ap.add_argument('--host', default='127.0.0.1')
    A = ap.parse_args()
    threading.Thread(target=worker, daemon=True).start()
    print('paint server on http://%s:%d (sd_return.py, one job at a time)' % (A.host, A.port), flush=True)
    ThreadingHTTPServer((A.host, A.port), H).serve_forever()
