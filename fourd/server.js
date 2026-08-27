// 4DAnyone PoC — static server. ROOT is the repo root so the page can reach
// /harness/vendor/three.min.js and /fourd/data/*. Port 8098 on purpose: 8099
// is the shared scratch server and harness runs against it are SERIAL.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 8098;
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4',
  '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/fourd/fourd.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream',
    'Cache-Control': 'no-store' });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, () => console.log('fourd server on http://localhost:' + PORT));
