// Minimal static file server for headless testing.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8099;
const ROOT = __dirname;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.png':'image/png', '.jpg':'image/jpeg', '.mp4':'video/mp4', '.xml':'application/xml',
  '.json':'application/json', '.npz':'application/octet-stream', '.csv':'text/csv' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/moebius.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
    'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log('static server on http://localhost:' + PORT));
