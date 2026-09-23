// Minimal static file server for headless testing.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = +(process.env.PORT || 8099);   // PORT=... to run beside another tree's server
const ROOT = __dirname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.jpg':'image/jpeg', '.mp4':'video/mp4', '.xml':'application/xml',
  '.json':'application/json', '.npz':'application/octet-stream', '.csv':'text/csv',
  '.mjs':'text/javascript', '.wasm':'application/wasm', '.onnx':'application/octet-stream', '.onnx_data':'application/octet-stream' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/__root') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end(ROOT); return; }   // which tree this server serves (harnesses check it)
  if (p === '/') p = '/moebius.html';
  const fp = path.join(ROOT, p);   // symlinked vendor dirs (harness/vendor/ort, /sam2) resolve outside ROOT: the path check is on the requested path
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
    'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
}).on('error', (e) => {   // a server already on the port (e.g. an orphan from another tree) must not answer silently for this one
  console.error('scratch_server: port ' + PORT + ' unavailable (' + e.code + '); not serving ' + ROOT); process.exit(1);
}).listen(PORT, () => console.log('static server on http://localhost:' + PORT));
