/* global app */
// Actual isolated Obsidian acceptance. Uses the existing independent SVG/text probe.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const output = 'artifacts/iteration-16-20/number-modes';
const fixture = 'Connector Manual.md', duplicateFixture = 'Number Duplicate Acceptance.md';
const labels = ['Early Access', 'dives', 'Verse', 'Scene Graph', 'model-assisted', 'ship'];
const modes = { always: '始终显示连线', hover: '悬停或聚焦时显示', none: '隐藏连线保留卡片', numbers: '仅显示编号' };
const report = { status: 'running', scenarios: [], errors: [], observations: [] };
let browser, page, preferences, layouts, theme;
await mkdir(output, { recursive: true });
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 8) => page.evaluate(count => new Promise(resolve => { const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), count);
const configure = async values => { await page.evaluate(async values => { const plugin = app.plugins.plugins['margin-link']; Object.assign(plugin.preferences, values); await plugin.savePreferences(); }, values); await frames(); };
const check = async (name, run) => {
  try { const details = await run(); report.scenarios.push({ name, passed: true, ...details }); console.log('PASS', name); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack }); console.log('FAIL', name, error.message); await page.screenshot({ path: `${output}/failure-${report.scenarios.length}.png` }).catch(() => {}); }
  finally { await page.evaluate(() => { app.setting?.close(); const plugin = app.plugins.plugins['margin-link']; for (const modal of [...plugin.dialogs]) modal.close(); app.workspace.detachLeavesOfType('margin-link-settings'); app.workspace.rightSplit.collapse(); }).catch(() => {}); }
  await save();
};
const open = async (mode = 'source', filename = fixture) => {
  const id = await page.evaluate(async ({ mode, filename }) => {
    const leaves = app.workspace.getLeavesOfType('markdown'), leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    await leaf.setViewState({ type: 'markdown', state: { file: filename, mode, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf.id;
  }, { mode, filename });
  await frames(10);
  await page.evaluate(async ({ id, filename }) => {
    const plugin = app.plugins.plugins['margin-link'], [view] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
    if (filename !== 'Connector Manual.md') return;
    if (view.getMode() === 'source') { const at = view.editor.getValue().indexOf('Early Access'), pos = view.editor.offsetToPos(at); view.editor.scrollIntoView({ from: pos, to: pos }, true); }
    else {
      const scroll = view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
      let link = [...scroll.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access');
      if (!link) scroll.scrollTop = scroll.scrollHeight * view.data.indexOf('Early Access') / view.data.length;
      for (let i = 0; i < 20 && !link; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); link = [...scroll.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access'); }
      if (!link) throw Error('Six-link paragraph has not rendered');
      scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
    }
  }, { id, filename }); await frames(12);
  await page.waitForFunction(({ id, filename }) => [...app.plugins.plugins['margin-link'].overlays].some(([view, overlay]) => view.leaf.id === id && view.file?.path === filename && overlay.cards.size >= (filename === 'Connector Manual.md' ? 6 : 3)), { id, filename });
  return id;
};
const arrange = async id => {
  await page.evaluate(({ id, labels }) => {
    const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
    const viewport = overlay.layoutInput.viewport, center = (viewport.top + viewport.bottom) / 2, lineHeight = overlay.layoutInput.lineHeight;
    const slots = { 'Scene Graph': ['left', -120], 'Early Access': ['left', 0], Verse: ['left', 120], dives: ['right', -120], 'model-assisted': ['right', 0], ship: ['right', 120] };
    const host = view.contentEl.getBoundingClientRect();
    for (const label of labels) {
      const card = [...overlay.cards.values()].find(card => card.anchor.occurrence.label === label);
      if (!card?.anchor.layoutKey) throw Error(`Missing unique layout identity ${label}`);
      const reference = card.anchor.rect.bottom + 2 - host.top;
      plugin.layouts.set(view.file.path, card.anchor.layoutKey, { side: slots[label][0], xNormalized: .45, yOffset: (center + slots[label][1] - reference) / lineHeight });
    }
    plugin.refresh();
  }, { id, labels }); await frames(10);
};
const probe = async id => {
  const snapshot = await page.evaluate(id => window.marginConnectorProbe(id), id);
  const extras = await page.evaluate(id => {
    const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
    const bridge = overlay.bridge(), source = view.getMode() === 'source';
    const scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
    const raw = scroller.getBoundingClientRect(), viewport = { left: raw.left + scroller.clientLeft, right: raw.left + scroller.clientLeft + scroller.clientWidth, top: raw.top + scroller.clientTop, bottom: raw.top + scroller.clientTop + scroller.clientHeight };
    const visible = element => { const r = element.getBoundingClientRect(), css = getComputedStyle(element); return !element.hidden && css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) > .01 && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.right > viewport.left && r.left < viewport.right && r.bottom > viewport.top && r.top < viewport.bottom; };
    return { mode: plugin.preferences.lines, source, scrollTop: scroller.scrollTop, diagnostics: overlay.diagnostics ? { ...overlay.diagnostics, work: undefined } : undefined, lineHeight: overlay.layoutInput.lineHeight,
      markers: [...overlay.cards].map(([key, card]) => ({ key, number: card.shell.dataset.number, reason: card.shell.dataset.routeReason, highlighted: card.button.classList.contains('margin-link-active'),
        markers: (card.continuation ?? []).map(marker => ({ end: marker.dataset.end, number: marker.dataset.number, text: marker.textContent, visible: visible(marker), tabIndex: marker.tabIndex, active: marker.classList.contains('margin-link-active'), rect: marker.getBoundingClientRect().toJSON() })) })),
      activeSource: [...view.contentEl.querySelectorAll('.margin-link-anchor-active')].map(el => el.textContent),
      actualSVGVisible: overlay.svg.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) };
  }, id);
  for (const card of snapshot.cards) Object.assign(card, extras.markers.find(marker => marker.key === card.key));
  return { ...snapshot, ...extras, markers: undefined };
};
const assertPairs = (snapshot, requireVisible = true) => {
  const cards = snapshot.cards.filter(card => labels.includes(card.label)); assert.equal(cards.length, 6);
  for (const card of cards) {
    assert.equal(card.markers.length, 2, `${card.label}: absent pair`); assert.deepEqual(card.markers.map(marker => marker.end).sort(), ['source', 'target']);
    assert(card.number && card.markers.every(marker => marker.number === card.number && marker.text === card.number), `${card.label}: mismatched pair`);
    if (requireVisible) assert(card.markers.every(marker => marker.visible), `${card.label}: one endpoint is invisible`);
  }
  assert.equal(new Set(cards.map(card => card.number)).size, 6); return cards;
};
const safeHeight = async enabled => {
  await page.evaluate(enabled => {
    document.getElementById('margin-number-acceptance-height')?.remove();
    if (enabled) { const style = document.createElement('style'); style.id = 'margin-number-acceptance-height'; style.textContent = '.markdown-source-view .cm-content,.markdown-source-view .cm-line,.markdown-preview-view p {line-height:32px!important}'; document.head.appendChild(style); }
    app.plugins.plugins['margin-link'].refresh();
  }, enabled); await frames(12);
};

try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('app://obsidian.md/')); assert(page); page.setDefaultTimeout(6000);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Refuse all real Vaults');
  report.host = await page.title(); report.plugin = await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version);
  report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  page.on('pageerror', error => report.errors.push(String(error)));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  theme = await page.evaluate(() => ({ light: document.body.classList.contains('theme-light'), dark: document.body.classList.contains('theme-dark') }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  const existing = await readFile('scripts/desktop-connectors-manual.mjs', 'utf8');
  const probeMatch = /window\.marginConnectorProbe = id => \{([\s\S]*?)\n {4}\};/.exec(existing); assert(probeMatch, 'Existing independent connector probe required');
  const browserProbe = `window.marginConnectorProbe = id => {${probeMatch[1]}\n};`
    .replaceAll("overlay.root.querySelectorAll('[data-relation][data-end]')", "overlay.decorations.canvas.querySelectorAll('[data-relation][data-end]')")
    .replaceAll('scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;', "scroller = source ? bridge.cm.scrollDOM : (view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl);")
    .replaceAll('.margin-link-overlay, .cm-gap', '.margin-link-overlay, .margin-link-decoration-layer, .cm-gap')
    .replaceAll("visible: css.display !== 'none'", "visible: el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && css.display !== 'none'");
  await page.evaluate(browserProbe);
  await configure({ enabled: true, lines: 'numbers', lineStyle: 'elbow', lineWidth: 2, placementMode: 'free', cardShape: 'square', cardSize: 'medium', reduceMotion: true, hoverFeedback: true });
  await safeHeight(false);

  for (const mode of ['source', 'preview']) await check(`${mode}: dense original has six exact source/card pairs in parse order`, async () => {
    await configure({ lines: 'numbers' }); const id = await open(mode); await arrange(id); const snapshot = await probe(id), cards = assertPairs(snapshot);
    const sorted = cards.slice().sort((a, b) => Number(a.key) - Number(b.key)); assert.deepEqual(sorted.map(card => card.number), ['1', '2', '3', '4', '5', '6']);
    await page.screenshot({ path: `${output}/dense-${mode}.png` }); return { snapshot };
  });
  for (const mode of ['source', 'preview']) await check(`${mode}: enabling numbers from disabled performs zero routing, SVG d writes and obstacle reads`, async () => {
    const id = await open(mode); await configure({ enabled: false, lines: 'numbers' });
    await page.evaluate(id => {
      const [, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
      const counts = { scans: 0, svgD: 0 }, originalRead = overlay.textObstacles.read, originalSet = SVGElement.prototype.setAttribute;
      overlay.textObstacles.read = function (...args) { counts.scans++; return originalRead.apply(this, args); };
      SVGElement.prototype.setAttribute = function (name, value) { if (name === 'd' && this.closest('.margin-link-connectors')) counts.svgD++; return originalSet.call(this, name, value); };
      overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      window.marginNumberCounts = { counts, restore: () => { overlay.textObstacles.read = originalRead; SVGElement.prototype.setAttribute = originalSet; } };
    }, id);
    try {
      await configure({ enabled: true }); const snapshot = await probe(id), counts = await page.evaluate(() => window.marginNumberCounts.counts);
      assertPairs(snapshot); assert.equal(snapshot.diagnostics.routes, 0); assert.equal(snapshot.diagnostics.svgWrites, 0); assert.equal(counts.svgD, 0); assert.equal(counts.scans, 0); return { counts, snapshot };
    } finally { await page.evaluate(() => window.marginNumberCounts.restore()); }
  });
  await check('all four modes switch without residual markers; line style and occurrence numbers remain stable', async () => {
    const id = await open('source'); await arrange(id); await configure({ lines: 'numbers', lineStyle: 'curve' }); const numbered = await probe(id), numbers = numbered.cards.map(card => [card.key, card.number]);
    const snapshots = [];
    for (const mode of ['none', 'always', 'hover', 'numbers', 'none', 'numbers']) {
      await page.mouse.move(10, 10); await page.evaluate(() => document.activeElement?.blur()); await configure({ lines: mode }); const snapshot = await probe(id); snapshots.push({ mode, snapshot });
      if (mode === 'none' || mode === 'hover') { assert(snapshot.cards.every(card => card.markers.every(marker => !marker.visible))); assert(!snapshot.actualSVGVisible || snapshot.paths.every(p => !p.visible)); }
      if (mode === 'numbers') { assertPairs(snapshot); assert(!snapshot.actualSVGVisible); assert.deepEqual(snapshot.cards.map(card => [card.key, card.number]), numbers); }
    }
    assert.equal(await page.evaluate(() => app.plugins.plugins['margin-link'].preferences.lineStyle), 'curve'); return { snapshots };
  });
  for (const color of ['light', 'dark']) await check(`${color}: keyboard focus highlights both number endpoints, the card and the original text`, async () => {
    await page.evaluate(color => { document.body.classList.toggle('theme-light', color === 'light'); document.body.classList.toggle('theme-dark', color === 'dark'); }, color);
    await configure({ lines: 'numbers' }); const id = await open('source'); await arrange(id); const before = await probe(id), card = before.cards.find(card => card.label === 'Scene Graph');
    const selector = `.margin-link-continuation[data-relation="${card.key}"][data-end="source"]`;
    await page.locator(selector).focus(); await frames(3); const focused = await probe(id), match = focused.cards.find(c => c.key === card.key);
    assert(match.highlighted && match.markers.every(marker => marker.active)); assert(focused.activeSource.some(text => text.includes('Scene Graph'))); assert.equal(await page.locator(selector).getAttribute('tabindex'), '0');
    await page.keyboard.press('Tab'); await frames(3); const active = await page.evaluate(() => ({ end: document.activeElement?.dataset.end, relation: document.activeElement?.dataset.relation }));
    assert.equal(active.relation, card.key); assert.equal(active.end, 'target'); await page.screenshot({ path: `${output}/keyboard-${color}.png` }); return { focused, active };
  });
  await check('a clipped source endpoint retains its visible target and unchanged occurrence number', async () => {
    await configure({ lines: 'numbers' }); const id = await open('source'); await arrange(id);
    await page.evaluate(id => { const p = app.plugins.plugins['margin-link'], [view, overlay] = [...p.overlays].find(([view]) => view.leaf.id === id); const card = [...overlay.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph'); p.layouts.set(view.file.path, card.anchor.layoutKey, { side: 'left', xNormalized: .4, yOffset: 8 }); }, id); await frames(8);
    const before = await probe(id), card = before.cards.find(card => card.label === 'Scene Graph'), source = card.markers.find(marker => marker.end === 'source');
    await page.evaluate(({ id, delta }) => { const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id); const scroll = view.getMode() === 'source' ? overlay.bridge().cm.scrollDOM : view.previewMode.containerEl; scroll.scrollTop += delta; }, { id, delta: source.rect.bottom - before.viewport.top + 3 }); await frames(5);
    const after = await probe(id), next = after.cards.find(c => c.key === card.key); assert(next); assert.equal(next.number, card.number); assert.equal(next.markers.find(marker => marker.end === 'source').visible, false); assert.equal(next.markers.find(marker => marker.end === 'target').visible, true); return { before, after };
  });
  await check('duplicate appearances have separate deterministic numbers across redraw, reading mode and reopen', async () => {
    await page.evaluate(async duplicateFixture => { const text = '# Repeated native links\n\nFirst [[Note A|same]] and second [[Note A|same]] beside [[Folder/Note A|neighbor]].\n'; const file = app.vault.getFileByPath(duplicateFixture); if (file) await app.vault.modify(file, text); else await app.vault.create(duplicateFixture, text); }, duplicateFixture);
    await configure({ lines: 'numbers' }); const id = await open('source', duplicateFixture); const capture = async () => (await probe(id)).cards.sort((a, b) => Number(a.key) - Number(b.key)).map(card => ({ key: card.key, number: card.number, label: card.label }));
    const before = await capture(); assert.deepEqual(before.map(card => card.number), ['1', '2', '3']); assert.equal(before.filter(card => card.label === 'same').length, 2);
    await page.evaluate(() => app.plugins.plugins['margin-link'].refresh()); await frames(); assert.deepEqual(await capture(), before);
    await open('preview', duplicateFixture); assert.deepEqual(await capture(), before);
    await open('source', fixture); await open('source', duplicateFixture); assert.deepEqual(await capture(), before); return { before, reopened: await capture() };
  });
  await check('both complete settings entries and quick controls expose the same four display choices', async () => {
    const readOptions = locator => locator.locator('option').evaluateAll(options => Object.fromEntries(options.map(option => [option.value, option.textContent])));
    await page.evaluate(() => app.plugins.plugins['margin-link'].openSettingsPanel()); await frames();
    const complete = page.locator('.margin-link-settings-view [data-margin-key="lines"] select:not(.is-measuring)'); assert.deepEqual(await readOptions(complete), modes);
    await complete.selectOption('numbers'); await frames(); assert.equal(await complete.inputValue(), 'numbers');
    await page.evaluate(() => { app.workspace.detachLeavesOfType('margin-link-settings'); app.workspace.rightSplit.collapse(); app.setting.open(); app.setting.openTabById('margin-link'); }); await frames();
    // Obsidian 1.15 can host native settings in its own document/window.
    await page.waitForFunction(() => !!app.setting.activeTab?.containerEl.querySelector('[data-margin-key="lines"] select:not(.is-measuring)'));
    const native = await page.evaluate(() => {
      const select = app.setting.activeTab.containerEl.querySelector('[data-margin-key="lines"] select:not(.is-measuring)');
      const options = Object.fromEntries([...select.options].map(option => [option.value, option.textContent]));
      select.value = 'none'; select.dispatchEvent(new select.ownerDocument.defaultView.Event('change', { bubbles: true }));
      return { options, connected: select.isConnected };
    }); assert.deepEqual(native.options, modes); assert(native.connected); await frames();
    await page.evaluate(() => app.setting.close()); await page.evaluate(() => app.commands.executeCommandById('margin-link:quick-controls')); await frames();
    const quick = page.locator('.margin-link-quick-controls .setting-item').filter({ has: page.getByText('连线显示', { exact: true }) }).locator('select:not(.is-measuring)'); assert.deepEqual(await readOptions(quick), modes); await quick.selectOption('numbers'); await frames();
    assert.equal(await page.evaluate(() => app.plugins.plugins['margin-link'].preferences.lines), 'numbers'); await page.keyboard.press('Escape'); return { options: modes };
  });
  for (const mode of ['source', 'preview']) await check(`${mode}: original dense connectors explicitly report a complete route or a paired continuation for every visible relation`, async () => {
    await safeHeight(false); await configure({ lines: 'always', lineStyle: 'elbow', lineWidth: 2 }); const id = await open(mode); await arrange(id); const snapshot = await probe(id);
    for (const card of snapshot.cards.filter(card => labels.includes(card.label))) {
      assert(card.fullyVisible && card.sourceVisible, `${card.label}: fixture endpoints must be visible`);
      if (!card.route.complete) { assert.equal(card.routeState, 'continuation'); assert.equal(card.reason, 'search-exhausted'); assert.equal(card.markers.filter(marker => marker.visible).length, 2, `${card.label}: missing paired continuation`); }
      else { assert.deepEqual(card.route.collisions, [], `${card.label}: glyph/card collision`); assert(card.route.startError <= 1 && card.route.endError <= 1); }
    }
    report.observations.push({ fixture: 'original-dense', mode, snapshot }); return { perRelation: snapshot.cards.map(card => ({ label: card.label, sourceVisible: card.sourceVisible, targetVisible: card.fullyVisible, state: card.routeState, reason: card.reason, complete: card.route.complete, segmentIDs: card.route.segmentIDs, markers: card.markers })) };
  });
  for (const mode of ['source', 'preview']) for (const style of ['straight', 'elbow', 'curve']) for (const width of [2, 5]) await check(`${mode}/${style}/${width}px: known-safe 32px rows yield six independently traced, glyph-safe routes`, async () => {
    await safeHeight(true); await configure({ lines: 'always', lineStyle: style, lineWidth: width }); const id = await open(mode); await arrange(id); const snapshot = await probe(id), cards = snapshot.cards.filter(card => labels.includes(card.label)); assert.equal(cards.length, 6);
    for (const card of cards) { assert(card.fullyVisible && card.sourceVisible, `${card.label}: endpoints clipped`); assert(card.route.complete, `${card.label}: incomplete ${card.routeState}`); assert(card.route.startError <= 1 && card.route.endError <= 1 && card.route.jointError <= 1); assert.deepEqual(card.route.collisions, [], `${card.label}: actual SVG stroke hits a glyph/card`); }
    report.observations.push({ fixture: 'safe-32px', mode, style, width, snapshot }); await page.screenshot({ path: `${output}/safe-${mode}-${style}-${width}.png` }); return { complete: cards.length, lineHeight: snapshot.lineHeight };
  });
  report.status = report.scenarios.every(scenario => scenario.passed) && !report.errors.length ? 'passed' : 'failed'; if (report.status !== 'passed') process.exitCode = 1;
} catch (error) { report.status = page ? 'failed' : 'blocked'; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  if (page) {
    await safeHeight(false).catch(() => {});
    await page.evaluate(({ preferences, layouts, theme }) => { const plugin = app.plugins.plugins['margin-link']; app.setting?.close(); for (const modal of [...plugin.dialogs]) modal.close(); app.workspace.detachLeavesOfType('margin-link-settings'); if (theme) { document.body.classList.toggle('theme-light', theme.light); document.body.classList.toggle('theme-dark', theme.dark); } if (layouts) plugin.layouts.records = layouts; if (preferences) Object.assign(plugin.preferences, preferences); plugin.refresh(); return plugin.savePreferences(); }, { preferences, layouts, theme }).catch(error => { report.restoreError = String(error); });
  }
  await save(); await browser?.close(); console.log(`${report.status}: ${output}/results.json (${report.scenarios.filter(scenario => scenario.passed).length}/${report.scenarios.length})`);
}
