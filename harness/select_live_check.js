// S70 item 5: which S6 plate selects still change anything under the default hole depth (source)? Bake the default, then
// each non-default value of each select alone, and compare a hash of what the bake hands on (plate depth, plate colour,
// band, plate 2, the source depth after load-time edits). Same hash = the select is inert in source mode.
//   [COLOR= DEPTH=] [PORT=8133] node harness/select_live_check.js     -> harness/out_select_live.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8133);
const ARMS = [['base', {}], ['base-again', {}],
    ['fill=mirror', { bgPlateFillSel: 'mirror' }], ['fill=membrane', { bgPlateFillSel: 'membrane' }],
    ['margin=off', { bgPlateMarginSel: 'off' }], ['margin=picture', { bgPlateMarginSel: 'picture' }], ['margin=window', { bgPlateMarginSel: 'window' }],
    ['faces=on', { bgPlateFacesSel: 'on' }], ['band=all', { bgPlateBandSel: 'all' }], ['sky=on', { bgPlateSkySel: 'on' }],
    ['seams=torn', { bgPlateSeamSel: 'torn' }], ['seams=all', { bgPlateSeamSel: 'all' }], ['join=on', { bgPlateJoinSel: 'on' }],
    ['rules=cur', { bgPlateRulesSel: 'cur' }], ['rules=ceil', { bgPlateRulesSel: 'ceil' }],
    ['ramps=safe', { bgPlateRampSel: 'safe' }], ['ramps=strong', { bgPlateRampSel: 'strong' }], ['pinholes=filled', { bgPlatePinSel: 'filled' }]];
(async () => {
    if (process.env.COLOR) { fs.copyFileSync(path.resolve(WT, process.env.COLOR), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH), path.join(H, 'defaultImgDepth.png'));
        process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} }); }
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    // ONLY=name,name,... runs just those arms; REUSE_BASE=<json> takes the base from an earlier run (same picture)
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    const out = process.env.REUSE_BASE ? { base: JSON.parse(fs.readFileSync(process.env.REUSE_BASE, 'utf8')).base } : {};
    for (const [name, sel] of ARMS) {
        if (out[name] || (only && name !== 'base' && !only.includes(name))) continue;
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
        await page.evaluate((sel) => { try { localStorage.clear(); } catch (e) {}
            for (const [id, v] of Object.entries(Object.assign({ bgPlateHoleSel: 'source' }, sel))) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }
            document.getElementById('bgLayerBuildBtn').click(); }, sel);
        for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbSourceHole && !window._qbSourceHoleBusy)) break; await new Promise(r => setTimeout(r, 500)); }
        await new Promise(r => setTimeout(r, 1000));
        out[name] = await page.evaluate(() => {
            const h = (a) => { if (!a) return 'none'; let x = 2166136261 >>> 0; const f = (a instanceof Float32Array) ? a : null;
                for (let i = 0; i < a.length; i++) { const v = f ? Math.round(f[i] * 65535) : a[i]; x ^= v & 0xffff; x = Math.imul(x, 16777619) >>> 0; x ^= v >>> 16; x = Math.imul(x, 16777619) >>> 0; } return a.length + ':' + x.toString(16); };
            const cnt = (a) => { if (!a) return null; let n = 0; for (let i = 0; i < a.length; i++) if (a[i]) n++; return n; };
            return { opts: window._bgPlateOptions, plate: h(window._qbPlateF), colour: h(window._qbPlateColor), band: h(window._qbDisocc), bandN: cnt(window._qbDisocc),
                     plate2: h(window._qbPlate2Has), plate2N: cnt(window._qbPlate2Has), dQ: h(window._qbDQ), margin: window._qbMargin ? JSON.stringify(window._qbMargin).slice(0, 80) : null,
                     sky: h(window._qbSkyColor), tier: h(window._qbBandTier) };
        });
        const b = out.base, r = out[name]; r.same = name === 'base' ? null : ['plate', 'colour', 'band', 'plate2', 'dQ', 'sky', 'tier'].filter(k => r[k] === b[k]).length === 7;
        r.differs = name === 'base' ? null : ['plate', 'colour', 'band', 'plate2', 'dQ', 'sky', 'tier', 'margin'].filter(k => r[k] !== b[k]);
        console.log(name, r.same ? 'INERT' : 'changes ' + (r.differs || []).join(','), 'band', r.bandN);
        fs.writeFileSync(path.join(H, 'out_select_live.json'), JSON.stringify(out, null, 1));
        await page.close();
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
