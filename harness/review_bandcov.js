// C5 quantification: which depth cliffs seed a band (step > bgBandStep=0.10)
// vs. which cliffs exist below the threshold; and how often the 28px grow cap
// truncates the parallax budget. Runs on a depth PNG via 2d canvas.
// Usage: node review_bandcov.js <depthPng> [W_for_lut]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const DEPTH = process.argv[2] || 'defaultImgDepth.png';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8099/blank.html', { waitUntil: 'domcontentloaded' });

  const res = await page.evaluate(async (DEPTH) => {
    const img = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = 'http://localhost:8099/' + DEPTH; });
    if (!img) return { err: 'no depth image' };
    const W = img.width, H = img.height, N = W * H;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, W, H).data;
    const d = new Float32Array(N); for (let i = 0; i < N; i++) d[i] = px[i * 4] / 255;

    // same LUT as bgDirectionalPlug (DELTA=0.12)
    const DELTA = 0.12, lut = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const nd = i / 1023; const t = Math.min(Math.max(nd / 0.5, 0), 1); const slo = 0.02 * (1 - (t * t * (3 - 2 * t)));
      const t2 = Math.min(Math.max((nd - 0.5) / 0.5, 0), 1); const shi = -0.04 * (t2 * t2 * (3 - 2 * t2)); const s = nd < 0.5 ? slo : shi; lut[i] = DELTA * s / (0.20 + s) * (W / 0.16); }
    const pxAt = v => lut[Math.min(1023, Math.max(0, (v * 1023) | 0))];

    // classify occluding-edge pixels by their max 4-neighbour drop
    const bins = { '0.04-0.06': 0, '0.06-0.08': 0, '0.08-0.10': 0, '>=0.10': 0 };
    const budgets = [];
    let edgePx = 0;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const i = y * W + xx;
      const nbs = [xx > 0 ? i - 1 : -1, xx < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      let drop = 0, far = 1e9;
      for (const j of nbs) { if (j < 0) continue; const dd = d[i] - d[j]; if (dd > drop) { drop = dd; } if (d[i] - d[j] > 0.10 && d[j] < far) far = d[j]; }
      if (drop <= 0.04) continue;
      edgePx++;
      if (drop < 0.06) bins['0.04-0.06']++;
      else if (drop < 0.08) bins['0.06-0.08']++;
      else if (drop < 0.10) bins['0.08-0.10']++;
      else { bins['>=0.10']++;
        const uncapped = Math.max(4, Math.ceil(Math.abs(pxAt(d[i]) - pxAt(far)))) + 2;
        budgets.push(uncapped);
      }
    }
    budgets.sort((a, b) => a - b);
    const q = (p) => budgets.length ? budgets[Math.min(budgets.length - 1, (p * budgets.length) | 0)] : 0;
    const capped = budgets.filter(b => b > 28).length;
    return { file: DEPTH, W, H, edgePx, bins,
      seedBudget: { n: budgets.length, p50: q(0.5), p90: q(0.9), max: budgets[budgets.length - 1] || 0,
                    hitCapFrac: budgets.length ? +(capped / budgets.length).toFixed(3) : 0 } };
  }, DEPTH);

  console.log(JSON.stringify(res, null, 2));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e); process.exit(1); });
