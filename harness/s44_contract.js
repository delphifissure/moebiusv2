// S44 / Sprint 24: headless verification of the depth-map input contract and of the consolidated bake defaults.
// No bake -- the contract runs on load, and the defaults are read straight off the panel plumbing, so this is seconds
// rather than minutes.
//   node harness/s44_contract.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..'), S = path.join(H, 's44');

// name -> [depth file, what the contract MUST say about it]
// Each row: [depth file, what it is, the phrases the contract MUST produce, the colour file]
const CASES = [
    ['ok16.png', 'the shipped DA3 16-bit map: the contract should pass it clean', [], 'color.png'],
    ['inverted16.png', 'the same map with the polarity flipped (far = white)', ['INVERTED'], 'color.png'],
    ['flat16.png', 'a constant map', ['flat'], 'color.png'],
    ['narrow16.png', 'the same scene compressed into a quarter of the range', ['% of the range'], 'color.png'],
    // 8 bits at 851 px is NOT a fold warning and must not be one: a133's threshold is ~1250 px, and at 851 one level is
    // 0.69 of the fold limit. The first version of this test expected a warning here and the contract was right.
    ['eight.png', 'the same scene at 8 bits, 851 px wide -- below a133 threshold, so clean', [], 'color.png'],
    ['eight_wide.png', 'the same scene at 8 bits, 1920 px wide -- one level is 1.55x the fold limit', ['fold limit'], 'color_wide.png'],
];

(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    let fails = 0;
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} try { srv.kill(); } catch (e) {} });

    for (const [file, what, must, colFile] of CASES) {
        fs.copyFileSync(path.join(S, colFile || 'color.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(S, file), path.join(H, 'defaultImgDepth.png'));
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
        await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        let rep = null;
        for (let t = 0; t < 40; t++) { rep = await page.evaluate(() => window._bgDepthContract || null).catch(() => null); if (rep) break; await new Promise(r => setTimeout(r, 500)); }
        console.log('\n== ' + file + ' -- ' + what);
        if (!rep) { console.log('   FAIL: the contract never ran'); fails++; await page.close(); continue; }
        const i = rep.info;
        console.log('   levels ' + i.levels + ', range ' + i.min.toFixed(4) + '..' + i.max.toFixed(4) +
                    ', quantum/fold ' + (i.quantum / i.foldLimit).toFixed(2) + ', bottom-top ' + i.bottomMinusTop.toFixed(3));
        for (const w of rep.warn) console.log('   warn: ' + w.slice(0, 150));
        const banner = await page.evaluate(() => !!document.getElementById('bgDepthContractBanner'));
        for (const need of must) {
            const hit = rep.warn.some(w => w.includes(need));
            console.log('   expect "' + need + '": ' + (hit ? 'yes' : 'NO -- FAIL')); if (!hit) fails++;
        }
        if (!must.length && rep.warn.length) { console.log('   expected no warning, got ' + rep.warn.length + ' -- FAIL'); fails++; }
        if (must.length && !banner) { console.log('   expected the visible banner, none in the DOM -- FAIL'); fails++; }
        if (!must.length && banner) { console.log('   a banner was shown for a clean map -- FAIL'); fails++; }
        await page.close();
    }

    // the consolidated defaults: a fresh profile (no localStorage) must arm the ceiling cut and the line despeckle
    fs.copyFileSync(path.join(S, 'color.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(S, 'ok16.png'), path.join(H, 'defaultImgDepth.png'));
    const ctx = await browser.newContext({ viewport: { width: 912, height: 513 } });
    const page2 = await ctx.newPage();
    await page2.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    await new Promise(r => setTimeout(r, 3000));
    const def = await page2.evaluate(() => ({ opts: window._bgPlateOptions || null, ceil: window._ceilCut || 0, desp: window._despeckleLines || 0,
                                              far: window._farRule || null, tear: window._tearLaw || null, tier: window._bandTierDeg,
                                              v3: localStorage.getItem('bgPlateOptions.v3'), v2: localStorage.getItem('bgPlateOptions.v2') }));
    console.log('\n== consolidated defaults on a fresh profile');
    console.log('   ' + JSON.stringify(def.opts));
    console.log('   _ceilCut ' + def.ceil + ', _despeckleLines ' + def.desp + ', _farRule ' + def.far + ', _tearLaw ' + def.tear + ', tier ' + def.tier);
    console.log('   storage key v3 ' + (def.v3 ? 'written' : 'absent') + ', legacy v2 ' + (def.v2 ? 'present (ignored)' : 'absent'));
    for (const [k, want] of [['ceil', 1], ['desp', 1]]) { if (def[k] !== want) { console.log('   FAIL: ' + k + ' is ' + def[k] + ', expected ' + want); fails++; } }
    if (!def.opts || def.opts.rules !== 'new') { console.log('   FAIL: rules is ' + (def.opts && def.opts.rules)); fails++; }

    // and a stale v2 set must NOT shadow the new default
    await ctx.addInitScript(() => { try { localStorage.setItem('bgPlateOptions.v2', JSON.stringify({ rules: 'cur', far: 'plane' })); } catch (e) {} });
    const page3 = await ctx.newPage();
    await page3.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    await new Promise(r => setTimeout(r, 3000));
    const st = await page3.evaluate(() => ({ rules: (window._bgPlateOptions || {}).rules, ceil: window._ceilCut || 0 }));
    console.log('   with a stale v2 set saved: rules ' + st.rules + ', _ceilCut ' + st.ceil + (st.rules === 'new' ? ' -- not shadowed' : ' -- FAIL, shadowed'));
    if (st.rules !== 'new') fails++;

    await browser.close(); try { srv.kill(); } catch (e) {}
    console.log('\n' + (fails ? fails + ' FAILURE(S)' : 'all checks passed'));
    process.exit(fails ? 1 : 0);
})();
