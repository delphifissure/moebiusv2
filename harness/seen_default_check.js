// S70: the emergence test is on by default in the real bake (the worker path), and window._seenMode = 'poses' turns it off.
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = 8135;
(async () => {
    fs.copyFileSync(path.join(WT, 'depth_da3mono16.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const out = {};
    for (const mode of [undefined, 'poses']) {
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
        await page.evaluate((m) => { try { localStorage.clear(); } catch (e) {} if (m) window._seenMode = m; const el = document.getElementById('bgPlateHoleSel'); el.value = 'source'; el.dispatchEvent(new Event('change')); document.getElementById('bgLayerBuildBtn').click(); }, mode);
        for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbSourceHole && !window._qbSourceHoleBusy)) break; await new Promise(r => setTimeout(r, 500)); }
        out[mode || 'default'] = await page.evaluate(() => { const st = window._qbSourceHole; let n = 0; const h = window._qbSrcHole; for (let i = 0; i < h.length; i++) n += h[i] ? 1 : 0;
            return { where: st.where, seen: st.seen || (st.stats && st.stats.seen) || null, exact: st.seenExact || (st.stats && st.stats.seenExact) || null, hole: n }; });
        console.log(mode || 'default', JSON.stringify(out[mode || 'default']).slice(0, 400)); await page.close();
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
