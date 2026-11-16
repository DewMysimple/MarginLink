/* global app */
// The isolated Obsidian must be launched with scripts/launch-test.ps1 (CDP 9223).
// Baseline and final share the same real pointer trajectories and independent
// pixel expectations; observations include hidden/missing cards on every frame.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { copyFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const phase = process.argv[2] ?? 'final';
assert(['baseline', 'final'].includes(phase));
const strict = phase === 'final', prefix = `artifacts/stability-${phase}`;
const scenarioFilter = process.env.MARGINLINK_STABILITY_SCENARIO;
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert(page, 'Isolated Obsidian missing');
await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace);
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault', 'Never run in a real vault');
assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Only the repository test-vault is authorized');
const cdp = await page.context().newCDPSession(page);
const errors = [], runtime = [], results = [], observations = {};
page.on('pageerror', e => errors.push({ message: String(e), stack: e.stack }));
await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', e => runtime.push(e.exceptionDetails));
await mkdir('artifacts', { recursive: true });
const report = async () => writeFile(`${prefix}${scenarioFilter ? '-focused' : ''}.json`, JSON.stringify({ phase, scenarioFilter: scenarioFilter ?? null, host: await page.title(), bundleSHA256: createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex'), results, observations, errors, runtime }, null, 2));
const check = async (name, run) => { if (scenarioFilter && !name.includes(scenarioFilter)) return; try { await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (e) { results.push({ name, passed: false, error: String(e), stack: e.stack }); await report(); if (strict) throw e; console.log(`BASELINE ${name}: ${e.message}`); } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const frames = async (count = 3) => page.evaluate(count => new Promise(resolve => { const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), count);
const viewport = async (width = 1920, height = 1000) => { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await frames(4); };
const plugin = () => page.evaluate(() => ({ preferences: app.plugins.plugins['margin-link'].preferences, layouts: app.plugins.plugins['margin-link'].layouts.snapshot() }));
const panel = () => page.locator('.margin-link-settings-view');
const ribbon = () => page.locator('.side-dock-ribbon-action[aria-label="打开 MarginLink 设置"]');
const openPanel = async () => { await ribbon().click(); await panel().waitFor({ state: 'visible' }); await wait(300); await frames(4); };
const closePanel = async () => { await page.evaluate(() => { for (const l of app.workspace.getLeavesOfType('margin-link-settings')) l.detach(); app.workspace.rightSplit.collapse(); }); await wait(250); await frames(4); };
const dropdown = key => panel().locator(`[data-margin-key="${key}"] select:not(.is-measuring)`);
const measureSettings = () => panel().evaluate(el => ({ width: el.getBoundingClientRect().width, heading: el.querySelector('h2')?.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, selects: [...el.querySelectorAll('select:not(.is-measuring)')].map(s => { const c = getComputedStyle(s), r = s.getBoundingClientRect(), text = s.selectedOptions[0]?.textContent, measure = document.createElement('canvas').getContext('2d'); measure.font = `${c.fontWeight} ${c.fontSize} ${c.fontFamily}`; return { key: s.closest('[data-margin-key]')?.dataset.marginKey, value: s.value, selectedIndex: s.selectedIndex, text, width: r.width, inlineWidth: s.style.width, fittedWidth: s.style.getPropertyValue('--dropdown-fitted-width'), color: c.color, background: c.backgroundColor, textWidth: measure.measureText(text).width, available: r.width - parseFloat(c.paddingLeft) - parseFloat(c.paddingRight) - parseFloat(c.borderLeftWidth) - parseFloat(c.borderRightWidth), controlWidth: s.parentElement.getBoundingClientRect().width, labelWidth: s.closest('.setting-item').querySelector('.setting-item-info').getBoundingClientRect().width, rowWidth: s.closest('.setting-item').getBoundingClientRect().width }; }) }));
const configure = async values => { await openPanel(); for (const [key, value] of Object.entries(values)) { if (typeof value === 'boolean') { const current = (await plugin()).preferences[key]; if (current !== value) { await panel().locator(`[data-margin-key="${key}"] .checkbox-container`).focus(); await page.keyboard.press('Space'); } assert.equal((await plugin()).preferences[key], value); } else await dropdown(key).selectOption(value); } await closePanel(); };
const source = 'Stability Card.md', hoverSource = 'Stability Hover.md';
const fixture = '# Interaction stability\n\nA visible anchor to [[Folder/Note A|dives]] remains here.\n';
const hoverFixture = '# Hover matrix\n\n[[References/stages.html|Early Access]]\n\n[[Note A]]\n\n[[Board.canvas|Canvas]]\n\n[[Missing target]]\n\n[[不存在/附件/失效页面.html#标题|Missing HTML]]\n\n[[Note A#Discussion|Heading]]\n\n[[Note A#^block|Block]]\n\n[[Stability 长中文文件名称用于确认提示保留完整文件名.md|长中文别名]]\n';
const open = async (path = source, mode = 'source') => { await page.evaluate(async ({ path, mode }) => { let l = app.workspace.getLeavesOfType('markdown')[0]; if (!l) l = app.workspace.getLeaf(true); await l.setViewState({ type: 'markdown', state: { file: path, mode, source: false } }); app.workspace.setActiveLeaf(l, { focus: true }); if (mode === 'source') l.view.editor.focus(); }, { path, mode }); await page.waitForSelector('.margin-link-host .margin-link-card'); await frames(8); };
const card = () => page.locator('.margin-link-host .margin-link-card').filter({ hasText: 'dives' }).first();
const host = () => page.locator('.margin-link-host').filter({ has: page.locator('.margin-link-card-label', { hasText: 'dives' }) }).first();
const snapshot = () => card().evaluate(e => ({ rect: e.getBoundingClientRect().toJSON(), shape: e.parentElement.dataset.shape, manual: e.parentElement.dataset.manual, visibility: getComputedStyle(e).visibility, line: e.closest('.margin-link-overlay').querySelector('.margin-link-connector')?.getAttribute('d') }));
const same = (a, b, tolerance = 1) => { for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(a.rect[key] - b.rect[key]) <= tolerance, `${key}: ${a.rect[key]} != ${b.rect[key]}`); assert.equal(a.shape, b.shape); };
const hashes = async () => { const paths = await page.evaluate(() => app.vault.getMarkdownFiles().map(f => f.path).sort()); return Object.fromEntries(await Promise.all(paths.map(async p => [p, createHash('sha256').update(await readFile(`test-vault/${p}`)).digest('hex')]))); };
const persist = async () => page.evaluate(async () => { for (const l of app.workspace.getLeavesOfType('markdown')) await l.view.save(); await app.workspace.requestSaveLayout().run(); });
const command = async query => { await page.keyboard.press('Control+p'); await page.locator('.prompt-input').fill(query); await page.keyboard.press('Enter'); };
const settings = async tab => {
  await page.keyboard.press('Control+,');
  for (let i = 0; i < 100; i++) {
    for (const p of browser.contexts().flatMap(c => c.pages())) if (!p.isClosed() && await p.locator('.vertical-tab-nav-item').first().isVisible()) {
      await p.locator('.vertical-tab-nav-item').filter({ hasText: tab }).first().click(); await frames(3); return p;
    }
    await wait(40);
  }
  throw new Error('Native settings missing');
};
const closeSettings = async owner => { await owner.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); if (owner === page) await page.keyboard.press('Escape'); else { const closed = owner.waitForEvent('close'); await owner.locator('.titlebar-button.mod-close').click(); await closed; await page.bringToFront(); } };
const reloadData = async value => {
  await closePanel(); await persist();
  // Disable natively before writing only the isolated plugin's test config.
  await page.evaluate(async () => app.plugins.disablePluginAndSave('margin-link'));
  const path = 'test-vault/.obsidian/plugins/margin-link/data.json';
  if (value === undefined) await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; }); else await writeFile(path, JSON.stringify(value));
  await page.evaluate(async () => app.plugins.enablePluginAndSave('margin-link'));
  await page.waitForSelector('.margin-link-card'); await frames(4);
};
const nativeScreenshot = async (path, show = false) => {
  // launch-test deliberately starts hidden; show only this isolated process.
  if (show) {
    execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class MarginLinkTestWindow { public delegate bool EnumProc(IntPtr h,IntPtr p); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint id); [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); public static void Show(uint id) { EnumWindows((h,p)=>{uint own;GetWindowThreadProcessId(h,out own);if(own==id){var s=new StringBuilder(512);GetWindowText(h,s,512);if(s.ToString().Contains("test-vault")){ShowWindow(h,3);SetForegroundWindow(h);}}return true;},IntPtr.Zero); }}'; $isolated = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Obsidian.exe' -and $_.CommandLine -like '*MarginLink*test-profile*' -and $_.CommandLine -notlike '*--type=*' }; foreach ($entry in $isolated) { [MarginLinkTestWindow]::Show($entry.ProcessId); }`]);
    await page.bringToFront(); await wait(100);
  }
  // This is a system capture, including native Chromium title bubbles/popups.
  execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $captureBounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $captureBitmap = New-Object System.Drawing.Bitmap $captureBounds.Width,$captureBounds.Height; $captureGraphics = [System.Drawing.Graphics]::FromImage($captureBitmap); $captureGraphics.CopyFromScreen($captureBounds.Location,[System.Drawing.Point]::Empty,$captureBounds.Size); $captureBitmap.Save('${path.replaceAll("'", "''")}',[System.Drawing.Imaging.ImageFormat]::Png); $captureGraphics.Dispose(); $captureBitmap.Dispose()`]);
};
const point = async (side = 'right', y = 500) => host().evaluate((el, { side, y }) => { const h = el.getBoundingClientRect(), c = el.querySelector('.cm-content'), r = c.getBoundingClientRect(), s = getComputedStyle(c), left = r.left + parseFloat(s.paddingLeft), right = r.right - parseFloat(s.paddingRight); return { x: side === 'left' ? (h.left + left) / 2 : (right + h.right) / 2, y: h.top + y }; }, { side, y });
const centerDrop = async (side = 'right', y = 500) => { const b = await card().boundingBox(), p = await point(side, y); if (Math.hypot(b.x + b.width / 2 - p.x, b.y + b.height / 2 - p.y) < 5) return; await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(p.x, p.y, { steps: 6 }); await page.mouse.up(); await frames(4); };

// Frame sampler runs continuously while the mouse remains down. It does not wait
// for stable geometry and never skips an invisible overlay.
const startSampling = async () => page.evaluate(() => {
  const host = [...document.querySelectorAll('.margin-link-host')].find(h => h.textContent.includes('dives'));
  const initial = host.querySelector('.margin-link-card'); window.stabilityFrames = []; window.stabilitySampling = true;
  const sample = time => {
    if (!window.stabilitySampling) return;
    const card = [...host.querySelectorAll('.margin-link-card')].find(c => c.textContent.includes('dives')), overlay = host.querySelector('.margin-link-overlay'), content = host.querySelector('.cm-content'), line = overlay?.querySelector('.margin-link-connector');
    const h = host.getBoundingClientRect(), c = content.getBoundingClientRect(), s = getComputedStyle(content), r = card?.getBoundingClientRect(), d = line?.getAttribute('d'), n = d?.match(/-?\d+(?:\.\d+)?/g)?.map(Number), end = n?.slice(-2), side = r && r.left < h.left + h.width / 2 ? 'left' : 'right';
    const body = { left: c.left + parseFloat(s.paddingLeft), right: c.right - parseFloat(s.paddingRight) }, scroller = host.querySelector('.cm-scroller').getBoundingClientRect();
    const anchor = [...host.querySelectorAll('.cm-line')].find(e => e.textContent.includes('dives'))?.getBoundingClientRect();
    const anchorVisible = !!anchor && anchor.top >= scroller.top && anchor.bottom <= scroller.bottom;
    const availableRight = Math.min(h.right, scroller.right) - 8 - body.right - 16;
    const visibility = overlay ? getComputedStyle(overlay).visibility : 'missing';
    window.stabilityFrames.push({ time, host: { left: h.left, right: h.right, width: h.width }, body, scroller: scroller.toJSON(), anchor: anchor?.toJSON(), anchorVisible, availableRight, hiddenReason: visibility === 'hidden' ? 'whole-layer' : !anchorVisible ? 'anchor-outside-viewport' : !card && availableRight < 36 ? 'insufficient-space' : !card ? 'unexplained-missing' : null, rect: r?.toJSON(), shape: card?.parentElement.dataset.shape, sameNode: card === initial, visibility, missing: !card, overlayHidden: !overlay || overlay.hidden || visibility === 'hidden' || getComputedStyle(overlay).display === 'none', cardHidden: !card || getComputedStyle(card).visibility === 'hidden', lineOpacity: line ? +getComputedStyle(line).opacity : 0, endpointError: r && end ? [end[0] + h.left - (side === 'left' ? r.right : r.left), end[1] + h.top - (r.top + r.height / 2)] : null, safe: !!r && r.left >= h.left - 1 || false });
    const record = window.stabilityFrames.at(-1); record.safe = !!r && r.left >= h.left - 1 && r.right <= h.right + 1 && r.top >= scroller.top - 1 && r.bottom <= scroller.bottom + 1 && (r.right <= body.left + 1 || r.left >= body.right - 1);
    requestAnimationFrame(time => setTimeout(() => sample(time), 0));
  }; requestAnimationFrame(time => setTimeout(() => sample(time), 0));
});
const stopSampling = async () => page.evaluate(() => { window.stabilitySampling = false; return window.stabilityFrames; });
const separator = async side => {
  const candidates = page.locator(`.workspace-split.mod-${side}-split > .workspace-leaf-resize-handle, .workspace-split.mod-${side}-split > .workspace-resize-handle`);
  for (const e of await candidates.all()) if (await e.isVisible()) return e;
  const all = await page.locator('.workspace-leaf-resize-handle, .workspace-resize-handle').evaluateAll(es => es.map(e => ({ cls: e.className, parent: e.parentElement.className, rect: e.getBoundingClientRect().toJSON() })));
  throw new Error(`No ${side} divider: ${JSON.stringify(all)}`);
};
const dragDivider = async (side, offsets, pause = 24) => {
  const handle = await separator(side), b = await handle.boundingBox(), start = b.x + b.width / 2, y = b.y + Math.min(350, b.height / 2);
  await page.mouse.move(start, y); await page.mouse.down(); await startSampling();
  for (const dx of offsets) { await page.mouse.move(start + dx, y); await wait(pause); }
  await page.mouse.up(); await frames(3); return stopSampling();
};

try {
  const baselineDirectory = process.env.MARGINLINK_STABILITY_BASELINE_DIR;
  if (strict || baselineDirectory) {
    await page.evaluate(async () => app.plugins.disablePluginAndSave('margin-link'));
    for (const file of ['main.js', 'styles.css', 'manifest.json']) await copyFile(baselineDirectory ? `${baselineDirectory}/${file}` : file, `test-vault/.obsidian/plugins/margin-link/${file}`);
    await page.evaluate(async () => app.plugins.enablePluginAndSave('margin-link'));
    await page.waitForSelector('.margin-link-overlay');
  }
  await nativeScreenshot(`${prefix}-setup-system.png`, true);
  await viewport(1920);
  await page.keyboard.press('Escape');
  await page.evaluate(async ({ source, fixture, hoverSource, hoverFixture }) => {
    for (const l of app.workspace.getLeavesOfType('markdown').slice(1)) l.detach();
    for (const [path, text] of [[source, fixture], [hoverSource, hoverFixture], ['Stability 长中文文件名称用于确认提示保留完整文件名.md', '# 中文目标\n']]) { const f = app.vault.getFileByPath(path); if (f) await app.vault.modify(f, text); else await app.vault.create(path, text); }
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
  }, { source, fixture, hoverSource, hoverFixture });
  await open(); await configure({ placementMode: 'free', cardShape: 'square', lines: 'always', lineStyle: 'straight' });
  await centerDrop('right', 430); await persist();
  const beforeHashes = await hashes();

  await check('real right divider: continuous slow/fast/pause/reverse has no unjustified hidden frames', async () => {
    await openPanel();
    const saved = (await plugin()).layouts;
    const frames = await dragDivider('right', [0, -4, -8, -12, -16, -20, -20, -20, -20, -24, -28, -80, -30, -16, -4, 0], 36);
    observations.rightDivider = { frames, hiddenFrames: frames.filter(f => f.overlayHidden || f.cardHidden || f.missing).length };
    assert(Math.max(...frames.map(f => f.host.width)) - Math.min(...frames.map(f => f.host.width)) > 40, 'Real divider must change actual Markdown width');
    assert(frames.length > 20); assert.equal(observations.rightDivider.hiddenFrames, 0);
    for (const f of frames) { assert(f.anchorVisible); assert(f.safe); assert(f.endpointError.every(n => Math.abs(n) <= 1)); assert(f.lineOpacity > 0); assert(f.sameNode); }
    assert.deepEqual((await plugin()).layouts, saved);
    await closePanel();
  });
  await closePanel(); await open();
  await check('real left divider: visible anchors/cards/lines stay synchronized', async () => {
    await page.evaluate(() => app.workspace.leftSplit.expand()); await wait(300); await frames(4);
    const saved = (await plugin()).layouts;
    const sequence = await dragDivider('left', [0, 4, 8, 12, 16, 16, 16, 20, 60, 24, 8, 0], 32);
    observations.leftDivider = { frames: sequence, hiddenFrames: sequence.filter(f => f.overlayHidden || f.cardHidden || f.missing).length };
    assert(Math.max(...sequence.map(f => f.host.width)) - Math.min(...sequence.map(f => f.host.width)) > 30, 'Real left divider must change actual Markdown width');
    assert(sequence.length > 15); assert.equal(observations.leftDivider.hiddenFrames, 0);
    sequence.forEach(f => { assert(f.anchorVisible); assert(f.safe); assert(f.endpointError.every(n => Math.abs(n) <= 1)); assert(f.lineOpacity > 0); assert(f.sameNode); }); assert.deepEqual((await plugin()).layouts, saved);
    await page.evaluate(() => app.workspace.leftSplit.collapse()); await frames(15);
  });
  await page.evaluate(() => app.workspace.leftSplit.collapse()); await closePanel(); await open();

  await check('monotonic real divider crosses square/icon/hidden once and restores unchanged layout', async () => {
    await configure({ cardShape: 'square', placementMode: 'free', lines: 'always' }); await centerDrop('right', 430); await openPanel();
    const initial = await snapshot(), saved = (await plugin()).layouts;
    const offsets = [...Array.from({ length: 45 }, (_, i) => -i * 20), ...Array.from({ length: 45 }, (_, i) => -880 + i * 20)];
    const sequence = await dragDivider('right', offsets, 20);
    const transitions = sequence.map(f => f.missing ? 'hidden' : f.shape).filter((v, i, all) => !i || v !== all[i - 1]);
    observations.spaceThreshold = { frames: sequence, transitions };
    assert.deepEqual(transitions, ['square', 'icon', 'hidden', 'icon', 'square']);
    for (const f of sequence) { assert(!f.overlayHidden); if (!f.missing) { assert(f.safe); assert(f.endpointError.every(n => Math.abs(n) <= 1)); } else assert.equal(f.lineOpacity, 0); }
    assert.deepEqual((await plugin()).layouts, saved); same(await snapshot(), initial); await closePanel();
  });
  await closePanel(); await open();

  await check('independent grab-point expectation: first threshold frame, continuous movement, final release, reopen', async () => {
    observations.grabPoints = [];
    for (const shape of ['square', 'horizontal', 'icon']) {
      await configure({ cardShape: shape, placementMode: 'free' }); await centerDrop('right', 420);
      for (const part of ['top-right', 'bottom-left', 'top-left', 'bottom-right', 'center', 'icon', 'text']) {
        await centerDrop('right', 420);
        const initial = await snapshot(), r = initial.rect;
        let start = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        if (part.includes('right')) start.x = r.right - 6; if (part.includes('left')) start.x = r.left + 6;
        if (part.includes('top')) start.y = r.top + 6; if (part.includes('bottom')) start.y = r.bottom - 6;
        if (part === 'icon' || (part === 'text' && shape !== 'icon')) { const child = await card().locator(part === 'icon' ? '.margin-link-card-icon' : '.margin-link-card-label').boundingBox(); if (child?.width && child.height) start = { x: child.x + child.width / 2, y: child.y + child.height / 2 }; }
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        await page.mouse.move(start.x + 2, start.y + 1); await frames(1); same(await snapshot(), initial);
        await page.mouse.move(start.x + 8, start.y + 12); await frames(1); const first = await snapshot();
        const expected = { x: r.x + 8, y: r.y + 12 };
        const record = { shape, part, actualPart: shape === 'icon' && part === 'text' ? 'center (compact cards have no visible text)' : part, start, initial, first, expected, firstError: [first.rect.x - expected.x, first.rect.y - expected.y] }; observations.grabPoints.push(record);
        if (strict) record.firstError.forEach(n => assert(Math.abs(n) <= 1, `${shape}/${part} first frame error ${record.firstError}`));
        await page.mouse.move(start.x + 12, start.y + 26); await frames(1); const continuous = await snapshot();
        if (strict) { assert(Math.abs(continuous.rect.x - r.x - 12) <= 1); assert(Math.abs(continuous.rect.y - r.y - 26) <= 1); }
        await page.mouse.up(); await frames(3); const released = await snapshot(); same(released, continuous);
        assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), source);
        await open('Remediation B.md'); await open(); same(await snapshot(), released);
      }
    }
    if (!strict) assert(observations.grabPoints.every(v => v.firstError.every(n => Math.abs(n) <= 1)), 'Baseline recentered noncentral grab points');
  });

  await check('long hover: filename and file type only, one visible tooltip, child areas and system capture', async () => {
    await configure({ cardShape: 'square' }); await open(hoverSource); await page.mouse.move(50, 50); await wait(250);
    observations.tooltips = [];
    const html = page.locator('.margin-link-host .margin-link-card').filter({ hasText: 'Early Access' });
    for (const part of ['icon', 'title', 'blank']) {
      const element = part === 'icon' ? html.locator('.margin-link-card-icon') : part === 'title' ? html.locator('.margin-link-card-label') : html;
      if (part === 'blank') { const r = await html.boundingBox(); await page.mouse.move(r.x + r.width - 5, r.y + 5); } else await element.hover();
      await wait(1700);
      const observation = await html.evaluate(e => ({ part: '', attributes: [...e.attributes].map(a => [a.name, a.value]), visibleTooltips: [...document.querySelectorAll('[role=tooltip], .tooltip, .margin-link-tooltip')].filter(t => { const s = getComputedStyle(t), r = t.getBoundingClientRect(); return r.width && r.height && s.display !== 'none' && s.visibility !== 'hidden'; }).map(t => ({ text: t.textContent, cls: t.className })) })); observation.part = part; observations.tooltips.push(observation);
      await page.screenshot({ path: `${prefix}-hover-${part}.png` });
      if (part === 'title') await nativeScreenshot(`${prefix}-hover-system.png`);
      if (strict) { assert(!await html.getAttribute('title')); assert.equal(observation.visibleTooltips.length, 1); assert.equal(observation.visibleTooltips[0].text, 'stages.html · HTML 文件'); }
      await page.mouse.move(50, 50); await wait(700);
      if (strict) assert.equal(await page.locator('.margin-link-tooltip:visible').count(), 0);
    }
    if (!strict) assert(!await html.getAttribute('title'), 'Baseline contains native title diagnostics plus Obsidian aria tooltip');
    if (strict) {
      observations.tooltipMatrix = [];
      for (const [label, expected] of [['Early Access', 'stages.html · HTML 文件'], ['Note A', 'Note A.md · Markdown 文件'], ['Canvas', 'Board.canvas · Canvas 文件'], ['Missing target', 'Missing target · 类型未知'], ['Missing HTML', '失效页面.html · HTML 文件'], ['Heading', 'Note A.md · Markdown 文件'], ['Block', 'Note A.md · Markdown 文件'], ['长中文别名', 'Stability 长中文文件名称用于确认提示保留完整文件名.md · Markdown 文件']]) {
        const item = page.locator('.margin-link-host .margin-link-card').filter({ has: page.locator('.margin-link-card-label', { hasText: new RegExp(`^${label}$`) }) }); await item.hover(); await wait(750);
        const texts = await page.locator('.margin-link-tooltip:visible').allTextContents(); observations.tooltipMatrix.push({ label, texts }); assert.deepEqual(texts, [expected]); assert(!await item.getAttribute('title')); assert(!await item.getAttribute('aria-label'));
      }
      await open(); assert.equal(await page.locator('.margin-link-tooltip:visible').count(), 0);
    }
    await open();
  });
  await open();

  if (strict) await check('silent drag with boundaries on/off, legal/invalid/back, snap/cross-side and cancellation', async () => {
    observations.silentDragging = [];
    for (const dragHints of [true, false]) for (const mode of ['free', 'snap']) {
      await configure({ cardShape: 'square', placementMode: mode, dragHints }); await centerDrop('right', 420);
      const initial = await snapshot(), saved = (await plugin()).layouts, b = initial.rect;
      await card().hover(); await wait(800); await page.mouse.move(b.right - 6, b.top + 6); await page.mouse.down();
      for (const [side, y] of [['right', 460], ['left', 480], ['body', 430], ['right', 440]]) {
        const p = side === 'body' ? await host().locator('.cm-content').evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 200 }; }) : await point(side, y);
        await page.mouse.move(p.x, p.y, { steps: 8 }); await frames(2);
        const state = await page.evaluate(() => ({ file: app.workspace.getLeavesOfType('markdown')[0].view.file.path, overlayClass: document.querySelector('.margin-link-overlay')?.className, tooltip: [...document.querySelectorAll('.margin-link-tooltip')].filter(e => getComputedStyle(e).visibility !== 'hidden').length, ghost: document.querySelectorAll('.margin-link-position-ghost').length, forbidden: [...document.querySelectorAll('body *')].filter(e => e.childElementCount === 0 && /放下保存位置|已对齐并避让|无可用位置 · 松手恢复|放到正文两侧空白/.test(e.textContent)).map(e => e.textContent), boundaryVisible: [...document.querySelectorAll('.margin-link-position-band')].some(e => getComputedStyle(e).display !== 'none') }));
        observations.silentDragging.push({ dragHints, mode, side, ...state }); assert.equal(state.tooltip, 0); assert.equal(state.ghost, 0); assert.deepEqual(state.forbidden, []); assert.equal(state.boundaryVisible, dragHints);
      }
      await page.keyboard.press('Escape'); await page.mouse.up(); await frames(3); same(await snapshot(), initial); assert.deepEqual((await plugin()).layouts, saved);
    }
    await configure({ placementMode: 'free', dragHints: true });
  });

  if (strict) await check('independent constrained rectangles: cross-side grab ratio, free boundary and finite snap correction', async () => {
    observations.constrainedDrops = [];
    for (const kind of ['cross-left', 'right-boundary', 'snap-right']) {
      await configure({ placementMode: kind === 'snap-right' ? 'snap' : 'free', cardShape: 'square' }); await centerDrop('right', 420);
      const before = await snapshot(), r = before.rect;
      const geometry = await host().evaluate((el, side) => { const h = el.getBoundingClientRect(), body = el.querySelector('.cm-content'), c = body.getBoundingClientRect(), s = getComputedStyle(body), scroll = el.querySelector('.cm-scroller').getBoundingClientRect(), p = app.plugins.plugins['margin-link'].preferences; return { left: side === 'left' ? Math.max(h.left, scroll.left) + 8 : c.right - parseFloat(s.paddingRight) + p.edgePadding, right: side === 'left' ? c.left + parseFloat(s.paddingLeft) - p.edgePadding : Math.min(h.right, scroll.right) - 8, top: Math.max(h.top, scroll.top) + 8, bottom: Math.min(h.bottom, scroll.bottom) - 8, grid: p.snapGrid }; }, kind === 'cross-left' ? 'left' : 'right');
      const raw = { x: kind === 'right-boundary' ? geometry.right - 1 : (geometry.left + geometry.right) / 2 + 7, y: geometry.top + 430 };
      const start = { x: r.right - 6, y: r.top + 6 }, u = (start.x - r.left) / r.width, v = (start.y - r.top) / r.height;
      let x = raw.x - u * 84, y = raw.y - v * 84;
      if (kind === 'snap-right') { x = geometry.left + Math.round((x - geometry.left) / geometry.grid) * geometry.grid; y = geometry.top + Math.round((y - geometry.top) / geometry.grid) * geometry.grid; }
      x = Math.max(geometry.left, Math.min(geometry.right - 84, x)); y = Math.max(geometry.top, Math.min(geometry.bottom - 84, y));
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(raw.x, raw.y, { steps: 5 }); await frames(1);
      const preview = await snapshot(); assert(Math.abs(preview.rect.x - x) <= 1); assert(Math.abs(preview.rect.y - y) <= 1); await page.mouse.up(); await frames(3); same(await snapshot(), preview);
      observations.constrainedDrops.push({ kind, before, start, rawPointer: raw, geometry, expected: { x, y, width: 84, height: 84 }, actual: preview });
    }
    await configure({ placementMode: 'free' });
  });

  await check('sidebar native dropdown collapsed text width and precise heading', async () => {
    await closePanel(); await ribbon().click(); await panel().waitFor({ state: 'visible' }); observations.firstCollapsedOpen = await measureSettings(); await wait(300); observations.expandedStable = await measureSettings(); observations.dropdowns = [];
    const handle = await separator('right');
    for (const width of [260, 360, 600]) {
      const b = await handle.boundingBox(), panelRect = await panel().boundingBox(), delta = panelRect.width - width;
      await page.mouse.move(b.x + b.width / 2, b.y + 250); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + delta, b.y + 250, { steps: 8 }); await page.mouse.up(); await frames(10);
      await dropdown('lines').selectOption('hover');
      const state = await measureSettings();
      observations.dropdowns.push({ requestedWidth: width, ...state });
      await page.screenshot({ path: `${prefix}-settings-${width}.png` });
      if (strict) { assert.equal(state.heading, 'MarginLink'); assert(state.scrollWidth <= state.clientWidth + 1); state.selects.forEach(s => assert(s.available >= s.textWidth - 1, `${s.key}: ${s.available}px available for ${s.textWidth}px text`)); }
    }
    if (!strict) assert(observations.dropdowns.every(s => s.selects.every(d => d.available >= d.textWidth - 1)), 'Baseline dropdown values are selected but width cannot paint text');
    await closePanel(); await openPanel(); observations.reopenedSettings = await measureSettings(); assert.equal(await dropdown('lines').inputValue(), 'hover'); await closePanel();
  });
  await closePanel(); await open();
  if (strict) await check('new install, flat/nested legacy preferences, missing/invalid per-field fallback and reset preserve Markdown/layout', async () => {
    observations.defaults = [];
    const cases = [
      { name: 'no data', value: undefined, expected: { lines: 'always', placementMode: 'free', cardShape: 'square' } },
      { name: 'flat valid legacy', value: { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' }, expected: { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' } },
      { name: 'nested valid legacy', value: { schemaVersion: 2, preferences: { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' }, layouts: [] }, expected: { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' } },
      { name: 'missing field', value: { schemaVersion: 2, preferences: { lines: 'none', cardShape: 'horizontal' } }, expected: { lines: 'none', placementMode: 'free', cardShape: 'horizontal' } },
      { name: 'invalid fields', value: { schemaVersion: 2, preferences: { lines: 'invalid', placementMode: 4, cardShape: null, layout: 'left' } }, expected: { lines: 'always', placementMode: 'free', cardShape: 'square' } }
    ];
    for (const c of cases) {
      await reloadData(c.value); const actual = (await plugin()).preferences;
      for (const [key, value] of Object.entries(c.expected)) assert.equal(actual[key], value);
      await openPanel(); const texts = {};
      for (const key of ['lines', 'placementMode', 'cardShape']) texts[key] = await dropdown(key).evaluate(e => e.selectedOptions[0].textContent);
      assert.equal(await panel().locator('h2').textContent(), 'MarginLink'); await closePanel();
      if (c.name === 'no data') { const r = await snapshot(); assert.equal(r.rect.width, r.rect.height); await page.mouse.move(50, 50); await wait(150); assert(await host().locator('.margin-link-connector').evaluate(e => +getComputedStyle(e).opacity > 0)); await centerDrop('right', 500); assert.equal((await snapshot()).manual, 'true'); }
      observations.defaults.push({ name: c.name, expected: c.expected, actual, texts });
    }
    await reloadData(undefined); await centerDrop('right', 470); const saved = (await plugin()).layouts; assert.equal(saved.length, 1);
    await configure({ lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' }); await openPanel();
    await panel().getByRole('button', { name: '恢复默认', exact: true }).click(); await page.locator('.margin-link-confirm').getByRole('button', { name: '确认', exact: true }).click(); await frames(3);
    for (const [key, value] of Object.entries({ lines: 'always', placementMode: 'free', cardShape: 'square' })) assert.equal(await dropdown(key).inputValue(), value);
    assert.deepEqual((await plugin()).layouts, saved); assert.equal(await panel().locator('.margin-link-settings-preview .margin-link-card-shell').getAttribute('data-shape'), 'square');
    await closePanel(); assert.equal((await snapshot()).manual, 'true'); await persist(); await wait(450); await page.reload(); await page.waitForSelector('.margin-link-card'); await frames(8);
    assert.deepEqual((await plugin()).layouts, saved); assert.equal((await plugin()).preferences.lines, 'always'); assert.equal((await snapshot()).shape, 'square');
    observations.reset = { savedPositionsPreserved: true, normalReload: true, actual: await plugin() };
  });

  if (strict) await check('native settings shares heading/keyboard dropdown/slider/toggle; sidebar dark and light values remain readable', async () => {
    let owner = await settings(/^MarginLink$/); const form = owner.locator('.margin-link-settings'); assert.equal(await form.locator('h2').textContent(), 'MarginLink');
    const select = form.locator('[data-margin-key="lineStyle"] select:not(.is-measuring)'); await select.focus(); await owner.keyboard.press('ArrowDown'); await owner.keyboard.press('Enter');
    const selected = await select.evaluate(e => ({ value: e.value, text: e.selectedOptions[0].textContent, width: e.getBoundingClientRect().width })); assert(selected.width > 80);
    const range = form.locator('[data-margin-key="lineWidth"] input[type=range]'); await range.focus(); await owner.keyboard.press('ArrowRight'); assert.equal(await range.inputValue(), '2');
    const toggle = form.locator('[data-margin-key="cardBorder"] .checkbox-container'); await toggle.focus(); await owner.keyboard.press('Space'); assert.equal((await plugin()).preferences.cardBorder, false); await owner.keyboard.press('Space'); await closeSettings(owner);
    await openPanel(); assert.equal(await dropdown('lineStyle').inputValue(), selected.value); assert.equal(await panel().locator('[data-margin-key="lineWidth"] input[type=range]').inputValue(), '2'); await closePanel();
    observations.themes = [];
    for (const [theme, cls] of [['moonstone', 'theme-light'], ['obsidian', 'theme-dark']]) {
      owner = await settings(/^(Appearance|外观)$/); await owner.locator('.setting-item').filter({ hasText: /Base color scheme|基础颜色/ }).locator('select:not(.is-measuring)').first().selectOption(theme); await closeSettings(owner); await page.waitForSelector(`body.${cls}`);
      await openPanel(); await dropdown('lines').selectOption('hover');
      const state = await dropdown('lines').evaluate(e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return { text: e.selectedOptions[0].textContent, width: r.width, color: s.color, background: s.backgroundColor }; }); observations.themes.push({ theme, ...state }); assert(state.width > 140); await panel().evaluate(e => e.scrollTop = 0); await page.screenshot({ path: `${prefix}-settings-${cls}.png` }); await closePanel();
    }
    await configure({ lines: 'always', lineStyle: 'straight' });
  });

  if (strict) await check('rapid divider to upper-corner drag, release, click-open and native Back preserves placement', async () => {
    await open(); await configure({ placementMode: 'free', cardShape: 'square' }); await centerDrop('right', 470); await openPanel();
    const h = await separator('right'), b = await h.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + 250); await page.mouse.down(); await page.mouse.move(b.x - 20, b.y + 250, { steps: 4 }); await page.mouse.up();
    const r = (await snapshot()).rect; await page.mouse.move(r.right - 6, r.top + 6); await page.mouse.down(); await page.mouse.move(r.right + 2, r.top + 18); await page.mouse.up(); await frames(2);
    assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), source);
    const placed = await snapshot(); assert(Math.abs(placed.rect.x - r.x - 8) <= 1); assert(Math.abs(placed.rect.y - r.y - 12) <= 1);
    await card().click(); await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path === 'Folder/Note A.md');
    const name = await page.evaluate(() => app.commands.commands['app:go-back'].name); await command(name); await card().waitFor(); await frames(5); same(await snapshot(), placed); await closePanel();
    observations.rapidSequence = { passed: true, before: r, after: placed };
  });

  if (strict) await check('idle render queue stops; panel reopens and disabling pending tooltip leaves no UI or queued frames', async () => {
    await open(); await page.mouse.move(20, 20); await wait(350);
    const listeners = await page.evaluate(() => app.plugins.plugins['margin-link'].listeners.size);
    for (let i = 0; i < 3; i++) { await openPanel(); await closePanel(); }
    assert.equal(await page.evaluate(() => app.plugins.plugins['margin-link'].listeners.size), listeners);
    await page.mouse.move(20, 20); await wait(350);
    observations.idle = await page.evaluate(async () => {
      const overlays = [...app.plugins.plugins['margin-link'].overlays.values()], originals = overlays.map(o => o.render); let renders = 0;
      overlays.forEach((o, i) => { o.render = function(...args) { renders++; return originals[i].apply(this, args); }; });
      try { await new Promise(resolve => setTimeout(resolve, 800)); return { renders, queuedFrames: overlays.map(o => o.frame), overlayCount: overlays.length }; }
      finally { overlays.forEach((o, i) => o.render = originals[i]); }
    });
    assert.equal(observations.idle.renders, 0); assert(observations.idle.queuedFrames.every(f => f === 0));
    await card().hover(); await wait(150); await page.evaluate(async () => app.plugins.disablePluginAndSave('margin-link')); await wait(800);
    assert.equal(await page.locator('.margin-link-overlay,.margin-link-host,.margin-link-tooltip,.margin-link-position-band,.margin-link-card-dragging,.margin-link-anchor-active').count(), 0);
    observations.unload = { pendingTooltipCancelled: true, residueCount: 0 };
    await page.evaluate(async () => app.plugins.enablePluginAndSave('margin-link')); await card().waitFor(); await frames(4);
  });
  await persist(); observations.markdownHashesUnchanged = JSON.stringify(await hashes()) === JSON.stringify(beforeHashes); assert(observations.markdownHashesUnchanged);
  if (strict) { assert.deepEqual(errors, []); assert.deepEqual(runtime, []); }
  await report();
} finally { await page.mouse.up().catch(() => {}); await report(); await browser.close(); }
