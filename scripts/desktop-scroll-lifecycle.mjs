/* global app */
// Bounded acceptance against this repository's isolated Obsidian only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const output = 'artifacts/iteration-16-20/scroll-lifecycle';
const report = { status: 'running', scenarios: [], errors: [] };
let browser, page, preferences, layouts, firstId, secondId;
await mkdir(output, { recursive: true });
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 10) => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), count);
const check = async (name, action) => {
  try { const details = await action(); report.scenarios.push({ name, passed: true, ...details }); console.log('PASS', name); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack }); console.log('FAIL', name, error.message); }
  await save();
};
const snapshot = id => page.evaluate(id => {
  const [view, overlay] = window.marginLifecycle.pair(id);
  return { mode: view.getMode(), scrollTop: window.marginLifecycle.scroller(id).scrollTop,
    cards: [...overlay.cards].map(([key, card]) => ({ key, label: card.anchor.occurrence.label, rect: card.shell.getBoundingClientRect().toJSON(), manual: card.shell.dataset.manual,
      record: app.plugins.plugins['margin-link'].layouts.get(view.file.path, card.anchor.layoutKey), connected: card.shell.isConnected })) };
}, id);
const stable = (before, after, except) => {
  let compared = 0;
  for (const card of before.cards.filter(card => card.key !== except)) {
    const current = after.cards.find(other => other.key === card.key); if (!current) continue;
    assert(Math.abs(current.rect.x - card.rect.x) <= 1 && Math.abs(current.rect.y - card.rect.y) <= 1, `${card.label}: independent card/pane moved`);
    assert.deepEqual(current.record, card.record); compared++;
  }
  assert(compared > 0); return compared;
};

try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('app://obsidian.md/')); assert(page); page.setDefaultTimeout(6000);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Refuse real Vaults');
  report.host = await page.title(); report.plugin = await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version);
  report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  page.on('pageerror', error => report.errors.push(String(error)));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
  firstId = await page.evaluate(async () => {
    app.setting?.close(); app.workspace.detachLeavesOfType('margin-link-settings'); app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const plugin = app.plugins.plugins['margin-link'];
    Object.assign(plugin.preferences, { enabled: true, lines: 'always', lineStyle: 'elbow', lineWidth: 2, placementMode: 'free', cardShape: 'square', reduceMotion: true }); await plugin.savePreferences();
    const leaves = app.workspace.getLeavesOfType('markdown'), leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    await leaf.setViewState({ type: 'markdown', state: { file: 'Connector Manual.md', mode: 'source', source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    window.marginLifecycle = {
      pair: id => [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id),
      scroller: id => { const [view, overlay] = window.marginLifecycle.pair(id); return view.getMode() === 'source' ? overlay.bridge().cm.scrollDOM : view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl; },
      center: id => {
        const [view] = window.marginLifecycle.pair(id);
        if (view.getMode() === 'source') { const at = view.editor.getValue().indexOf('Early Access'), pos = view.editor.offsetToPos(at); view.editor.scrollIntoView({ from: pos, to: pos }, true); }
        else { const scroll = window.marginLifecycle.scroller(id), link = [...view.contentEl.querySelectorAll('a.internal-link')].find(element => element.textContent === 'Early Access'); if (link) scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2; }
      }
    };
    return leaf.id;
  }); await frames(15);
  await page.evaluate(id => window.marginLifecycle.center(id), firstId); await frames(15);

  await check('native pointer free-card drag changes only its own placement', async () => {
    const before = await snapshot(firstId);
    const card = before.cards.find(card => card.label === 'Scene Graph' && card.connected); assert(card);
    const x = card.rect.x + card.rect.width / 2, y = card.rect.y + card.rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 65, { steps: 8 }); await page.mouse.up(); await frames(12);
    const after = await snapshot(firstId), moved = after.cards.find(other => other.key === card.key);
    assert.equal(moved.manual, 'true'); assert(Math.abs(moved.rect.y - card.rect.y) >= 30);
    return { unchangedNeighbors: stable(before, after, card.key), movement: moved.rect.y - card.rect.y };
  });

  await check('source and reading split panes scroll independently', async () => {
    secondId = await page.evaluate(async () => { const leaf = app.workspace.getLeaf('split'); await leaf.setViewState({ type: 'markdown', state: { file: 'Connector Manual.md', mode: 'preview' } }); return leaf.id; });
    await frames(20); await page.evaluate(ids => ids.forEach(id => window.marginLifecycle.center(id)), [firstId, secondId]); await frames(20);
    const sourceBefore = await snapshot(firstId), readingBefore = await snapshot(secondId);
    await page.evaluate(id => { window.marginLifecycle.scroller(id).scrollTop += 65; }, secondId); await frames(12);
    const unchangedSource = stable(sourceBefore, await snapshot(firstId));
    const readingAfter = await snapshot(secondId); assert(readingAfter.scrollTop !== readingBefore.scrollTop);
    await page.evaluate(id => { window.marginLifecycle.scroller(id).scrollTop += 45; }, firstId); await frames(12);
    const unchangedReading = stable(readingAfter, await snapshot(secondId));
    return { unchangedSource, unchangedReading, readingDelta: readingAfter.scrollTop - readingBefore.scrollTop };
  });

  await check('reading section refresh and retained-sizer host removal reconnect native cards', async () => {
    assert(secondId);
    await page.evaluate(id => { const [view] = window.marginLifecycle.pair(id); view.previewMode.rerender(true); }, secondId); await frames(20);
    const afterRefresh = await snapshot(secondId); assert(afterRefresh.cards.length && afterRefresh.cards.every(card => card.connected));
    const recovered = await page.evaluate(id => {
      const [, overlay] = window.marginLifecycle.pair(id), layer = overlay.decorations.element, parent = layer.parentElement;
      window.marginLifecycle.refreshProbe = { layer, parent, cards: [...overlay.cards.values()].map(card => card.shell) };
      layer.remove(); app.plugins.plugins['margin-link'].refresh(); return { parentRetained: parent.isConnected, removed: !layer.isConnected };
    }, secondId); assert(recovered.parentRetained && recovered.removed); await frames(12);
    const result = await page.evaluate(() => { const probe = window.marginLifecycle.refreshProbe; return { reattachedToSameSizer: probe.layer.parentElement === probe.parent, connectedCards: probe.cards.filter(card => card.isConnected).length, cards: probe.cards.length }; });
    assert(result.reattachedToSameSizer && result.connectedCards === result.cards && result.cards > 0); return result;
  });

  await check('settled source and reading panes schedule zero idle renders', async () => {
    await page.waitForTimeout(400); await frames(12);
    await page.evaluate(() => { for (const [, overlay] of app.plugins.plugins['margin-link'].overlays) overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] }; });
    await page.waitForTimeout(400);
    const diagnostics = await page.evaluate(() => [...app.plugins.plugins['margin-link'].overlays].map(([view, overlay]) => ({ mode: view.getMode(), ...overlay.diagnostics })));
    assert(diagnostics.length >= 2); for (const item of diagnostics) assert.equal(item.renders, 0, `${item.mode}: idle renders`); return { diagnostics };
  });

  await check('large scroll into a new virtualized region reports geometry costs separately', async () => {
    await page.evaluate(async ({ firstId, secondId }) => {
      if (secondId) app.workspace.getLeafById(secondId)?.detach();
      const leaf = app.workspace.getLeafById(firstId); await leaf.setViewState({ type: 'markdown', state: { file: 'Scroll Routing.md', mode: 'source', source: false } }); app.workspace.setActiveLeaf(leaf, { focus: true });
    }, { firstId, secondId }); secondId = undefined; await frames(20);
    await page.evaluate(id => { window.marginLifecycle.scroller(id).scrollTop = 0; }, firstId); await frames(15);
    const before = await page.evaluate(id => {
      const [, overlay] = window.marginLifecycle.pair(id), scroller = window.marginLifecycle.scroller(id);
      overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      const before = { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, height: scroller.clientHeight, obstacleRevision: overlay.textObstacles.revision, measuredTop: overlay.measuredTop, measuredBottom: overlay.measuredBottom };
      scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight; return before;
    }, firstId); await frames(25);
    const after = await page.evaluate(id => { const [, overlay] = window.marginLifecycle.pair(id); return { scrollTop: window.marginLifecycle.scroller(id).scrollTop, obstacleRevision: overlay.textObstacles.revision, diagnostics: overlay.diagnostics, measuredTop: overlay.measuredTop, measuredBottom: overlay.measuredBottom }; }, firstId);
    assert(after.scrollTop - before.scrollTop > before.height); assert(after.diagnostics.measurements > 0); assert(after.obstacleRevision > before.obstacleRevision);
    return { before, after, fullObstacleScans: after.obstacleRevision - before.obstacleRevision, classification: 'new-region; excluded from warm-cache budgets' };
  });

  await check('disabling the plugin unloads native layers and restores owned sizer positioning', async () => {
    const result = await page.evaluate(async () => {
      const plugin = app.plugins.plugins['margin-link'];
      const parents = [...plugin.overlays.values()].map(overlay => ({ parent: overlay.decorations.parent, owned: overlay.decorations.positioned, previous: overlay.decorations.previousPosition }));
      await app.plugins.disablePlugin('margin-link');
      return { nativeLayers: document.querySelectorAll('.margin-link-decoration-layer').length, fixedLayers: document.querySelectorAll('.margin-link-overlay').length,
        parents: parents.filter(item => item.parent?.isConnected).map(item => ({ owned: item.owned, previous: item.previous, current: item.parent.style.position })) };
    });
    assert.equal(result.nativeLayers, 0); assert.equal(result.fixedLayers, 0);
    for (const parent of result.parents.filter(parent => parent.owned)) assert.equal(parent.current, parent.previous);
    await page.evaluate(() => app.plugins.enablePlugin('margin-link')); await frames(20);
    assert(await page.evaluate(() => document.querySelectorAll('.margin-link-decoration-layer').length > 0)); return result;
  });
  report.status = report.scenarios.every(item => item.passed) && !report.errors.length ? 'passed' : 'failed'; if (report.status !== 'passed') process.exitCode = 1;
} catch (error) { report.status = page ? 'failed' : 'blocked'; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  if (page) await page.evaluate(async ({ preferences, layouts, secondId }) => {
    if (!app.plugins.plugins['margin-link']) await app.plugins.enablePlugin('margin-link');
    const plugin = app.plugins.plugins['margin-link']; if (secondId) app.workspace.getLeafById(secondId)?.detach();
    if (layouts) plugin.layouts.records = layouts; if (preferences) Object.assign(plugin.preferences, preferences); await plugin.savePreferences();
    delete window.marginLifecycle;
  }, { preferences, layouts, secondId }).catch(error => { report.restoreError = String(error); });
  await save(); await browser?.close(); console.log(`${report.status}: ${output}/results.json (${report.scenarios.filter(item => item.passed).length}/${report.scenarios.length})`);
}
