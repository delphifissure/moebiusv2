const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();
const httpsPort = 3000;
const httpPort = 3001;
const host = '0.0.0.0';

// S70: the one-click "Paint holes" button talks to the paint server (harness/paint_server.py, which runs
// sd_return.py). /paint/<path> is forwarded to PAINT_URL/<path> so the page reaches it same-origin, on http
// here and on https from the iPad (a direct http call from an https page would be blocked as mixed content).
const PAINT_URL = new URL(process.env.PAINT_URL || 'http://127.0.0.1:8765');
app.use('/paint', (req, res) => {
  const up = http.request({ host: PAINT_URL.hostname, port: PAINT_URL.port || 80, method: req.method,
    path: req.url, headers: { 'content-type': req.headers['content-type'] || 'application/octet-stream',
      ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] } : {}) } }, (r) => {
    res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store' });
    r.pipe(res);
  });
  up.on('error', (e) => { if (!res.headersSent) res.status(502).json({ error: 'paint server not reachable at ' + PAINT_URL.href + ' (' + e.code + '): start it with  python3 harness/paint_server.py' }); });
  req.pipe(up);
});

// This one line handles serving all your static files.
// Cache-Control: no-store on dev assets: with stable filenames (moebius.js),
// the browser must never serve a stale copy — the on-page badge + this header
// together make "which build am I running" a solved problem.
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (/\.(js|html|css)$/.test(filePath)) {
      res.set('Cache-Control', 'no-store');
    }
  }
}));

// You only need a route for your main HTML page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'moebius.html'));
});

// --- HTTP: use this on the Mac ---------------------------------------------
// localhost over plain HTTP is a "secure context" in browsers, so webcam
// (getUserMedia) works — and there is no certificate, so nothing gets flagged
// and WebGL texture uploads from same-origin images are never blocked.
//
// WHY THIS EXISTS: a self-signed HTTPS cert that the browser doesn't trust
// causes Chrome to mark every subresource as "loaded with certificate errors"
// once you click through the warning. Those resources fail the CORS
// same-origin check, and WebGL throws:
//   SecurityError: texImage2D ... contains cross-origin data
// even for images served from your own origin. Plain HTTP on localhost
// avoids the entire class of problem for local development.
http.createServer(app).listen(httpPort, host, () => {
  console.log(`HTTP  (use on this Mac):  http://localhost:${httpPort}`);
});

// --- HTTPS: use this from the iPad over LAN ---------------------------------
// getUserMedia on a non-localhost IP requires HTTPS. For the cert-error taint
// not to bite on the iPad too, the certificate must be TRUSTED by the device.
// Recommended: mkcert (https://github.com/FiloSottile/mkcert)
//   brew install mkcert
//   mkcert -install
//   mkcert localhost 192.168.x.x        <- your Mac's LAN IP
//   (rename the generated files to key.pem / cert.pem, or update paths below)
// Then install mkcert's root CA on the iPad once:
//   AirDrop the rootCA.pem (location: `mkcert -CAROOT`), install the profile,
//   and enable full trust in Settings > General > About > Certificate Trust.
// After that: no warning to click through, no flagged resources, no taint.
try {
  const options = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
  };
  https.createServer(options, app).listen(httpsPort, host, () => {
    console.log(`HTTPS (use on the iPad):  https://YOUR_MAC_IP:${httpsPort}`);
  });
} catch (e) {
  console.warn(`HTTPS disabled (couldn't read key.pem/cert.pem): ${e.message}`);
  console.warn('HTTP server is still running for local development.');
}