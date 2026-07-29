// Compare windowed vs fullscreen frames in the BROWSER (no pngjs here): decode
// both PNGs on a canvas and count differing pixels, split by whether the pixel
// is inside the projected aperture. Inside must be identical under a172;
// outside is expected to differ (page-white matte vs no matte at all).
const { chromium } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const D = process.argv[2];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  for (const deg of ['0deg', '25deg', '45deg']) {
    const a = 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'windowed_matte-on_crop0_' + deg + '.png')).toString('base64');
    const b = 'data:image/png;base64,' + fs.readFileSync(path.join(D, 'FULLSCREEN_matte-GONE_crop1_' + deg + '.png')).toString('base64');
    const r = await page.evaluate(async ([a, b]) => {
      const ld = (s) => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = s; });
      const [A, B] = await Promise.all([ld(a), ld(b)]);
      const g = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height); };
      const P = g(A), Q = g(B);
      // Split the differing pixels by whether the WINDOWED frame had the matte
      // there. If every difference sits on a matte pixel, the content is
      // untouched and only the surround changed -- which is the a172 claim.
      let diff = 0, tot = 0, maxd = 0, onMatte = 0, offMatte = 0, offMax = 0;
      for (let i = 0; i < P.data.length; i += 4) {
        const d = Math.abs(P.data[i] - Q.data[i]) + Math.abs(P.data[i+1] - Q.data[i+1]) + Math.abs(P.data[i+2] - Q.data[i+2]);
        tot++;
        if (d > 8) {
          diff++; if (d > maxd) maxd = d;
          // the matte is the page colour: near-white and flat
          const r = P.data[i], g2 = P.data[i+1], bl = P.data[i+2];
          const flatWhite = r > 230 && g2 > 230 && bl > 230;
          if (flatWhite) onMatte++; else { offMatte++; if (d > offMax) offMax = d; }
        }
      }
      return { diff, tot, maxd, onMatte, offMatte, offMax, w: P.width, h: P.height };
    }, [a, b]);
    console.log(deg + ': differing ' + r.diff + ' / ' + r.tot + ' (' + (100 * r.diff / r.tot).toFixed(2) +
                '%)  on the matte ' + r.onMatte + '  NOT on the matte ' + r.offMatte +
                ' (max delta there ' + r.offMax + ')');
  }
  await browser.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
