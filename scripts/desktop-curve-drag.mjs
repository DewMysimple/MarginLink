/* global app */
// Actual pointer input, native SVG sampling and frame timings in the isolated
// Vault only. Run after desktop-route-quality.mjs --prepare and launch-test.ps1.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv.includes('baseline') ? 'baseline' : 'final';
const output = `artifacts/curve-drag/${phase}`;
const fixture = '详细分析/The road to Unreal Engine 6. Read about our plans and timeline.md';
const labels = ['Early Access', 'dives', 'Verse', 'Scene Graph', 'model-assisted', 'ship'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = hash(await readFile(path.join('E:/Obsidian仓库/AnyTime', fixture)));
const report = { phase, status: 'running', fixtureSHA256: original, scenarios: [], errors: [] };
let browser, page, preferences, layouts;
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 6) => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), count);
await mkdir(output, { recursive: true });
const check = async (name, run) => {
  try { const detail = await run(); report.scenarios.push({ name, passed: true, ...detail }); console.log('PASS', name); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack }); console.log('FAIL', name, error.message); }
  await save();
};
const probe = id => page.evaluate(id => window.marginConnectorProbe(id), id);
const assertGeometry = snapshot => {
  const selected = snapshot.cards.filter(card => labels.includes(card.label));
  assert.equal(selected.length, 6);
  for (const card of selected) {
    assert(card.sourceVisible && card.fullyVisible, `${card.label}: endpoint clipped`);
    if (card.routeState === 'continuation') {
      assert.equal(card.markers.filter(marker => marker.visible).length, 2, `${card.label}: unpaired continuation`);
    } else {
      assert.equal(card.routeState, 'complete', `${card.label}: unexpected route state`);
      assert(card.route.complete && card.route.startError <= 1 && card.route.endError <= 1 && card.route.jointError <= 1, `${card.label}: disconnected actual SVG route`);
      assert.deepEqual(card.route.collisions, [], `${card.label}: actual SVG stroke intersects text/card`);
    }
  }
  return selected.map(card => ({ label: card.label, routeState: card.routeState, startError: card.route.startError,
    endError: card.route.endError, jointError: card.route.jointError, collisions: card.route.collisions,
    maxTurn: card.route.maxTurn, startTangentError: card.route.startTangentError, endTangentError: card.route.endTangentError }));
};
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('app://obsidian.md/'));
  assert(page); page.setDefaultTimeout(20000);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.plugins?.plugins['margin-link']);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Refuse real Vaults');
  await page.route(/^https?:\/\//, route => route.abort());
  page.on('pageerror', error => report.errors.push(String(error)));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  report.bundleSHA256 = hash(await readFile('test-vault/.obsidian/plugins/margin-link/main.js'));
  report.manifest = JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/manifest.json', 'utf8'));
  report.runtimeVersion = await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version);
  assert.equal(report.runtimeVersion, report.manifest.version, 'Restart isolated Obsidian after replacing the release manifest');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  const existing = await readFile('scripts/desktop-connectors-manual.mjs', 'utf8');
  const match = /window\.marginConnectorProbe = id => \{([\s\S]*?)\n {4}\};/.exec(existing); assert(match);
  const nativeProbe = `window.marginConnectorProbe = id => {${match[1]}\n};`
    .replaceAll("overlay.root.querySelectorAll('[data-relation][data-end]')", "overlay.decorations.canvas.querySelectorAll('[data-relation][data-end]')")
    .replaceAll('scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;', "scroller = source ? bridge.cm.scrollDOM : (view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl);")
    .replaceAll('.margin-link-overlay, .cm-gap', '.margin-link-overlay, .margin-link-decoration-layer, .cm-gap')
    .replaceAll('Number.parseFloat(css.strokeWidth)', "CSSNumericValue.parse(css.strokeWidth).to('px').value")
    .replaceAll('const collisions = [], padding = plugin.preferences.lineWidth / 2 + .15;', 'const collisions = [], padding = Math.max(plugin.preferences.lineWidth, ...parts.filter(Boolean).map(p => p.width)) / 2 + .15;');
  await page.evaluate(nativeProbe);
  const open = async (mode, style, resetLayouts = true) => {
    const id = await page.evaluate(async ({ fixture, mode, style, layouts, resetLayouts }) => {
      const plugin = app.plugins.plugins['margin-link'];
      Object.assign(plugin.preferences, { enabled: true, lines: 'always', lineStyle: style, lineWidth: 1.5,
        placementMode: 'free', cardShape: 'square', cardSize: 'medium', reduceMotion: true });
      if (resetLayouts) plugin.layouts.records = layouts;
      await plugin.savePreferences();
      const leaves = app.workspace.getLeavesOfType('markdown'), leaf = leaves[0] ?? app.workspace.getLeaf(true);
      for (const other of leaves.slice(1)) other.detach();
      await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source: false } });
      app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
    }, { fixture, mode, style, layouts, resetLayouts }); await frames(12);
    await page.evaluate(async id => {
      const [view] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
      if (view.getMode() === 'source') {
        const at = view.editor.getValue().lastIndexOf('Early Access'), pos = view.editor.offsetToPos(at);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
      } else {
        const scroll = view.previewMode.containerEl.querySelector('.markdown-preview-view'); scroll.scrollTop = scroll.scrollHeight;
        let link;
        for (let i = 0; i < 30; i++) {
          link = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access');
          if (link) break; await new Promise(resolve => requestAnimationFrame(resolve));
        }
        if (!link) throw Error('Fixture link not rendered');
        scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight * .56;
      }
    }, id); await frames(15); return id;
  };
  const cases = ['preview', 'source'].flatMap(mode => ['straight', 'elbow', 'curve'].flatMap(style => ['ship', 'dives'].map(draggedLabel => ({ mode, style, draggedLabel }))));
  // Saved positions are user-controlled: inspect actual placement rather than
  // assuming a label is still on the same side as a historical screenshot.
  if (phase === 'final') for (const mode of ['preview', 'source']) cases.push({ mode, style: 'curve', draggedLabel: 'Scene Graph' });
  for (const { mode, style, draggedLabel } of cases) {
    const id = await open(mode, style);
    await check(`${mode}/${style}/${draggedLabel}: same 48-step pointer drag, cancel, independently sampled SVG`, async () => {
      const before = await probe(id), start = before.cards.find(card => card.label === draggedLabel); assert(start);
      const yDirection = draggedLabel === 'ship' ? -1 : 1;
      const beforeGeometry = assertGeometry(before);
      await page.mouse.move(start.rect.x + start.rect.width / 2, start.rect.y + start.rect.height / 2); await page.mouse.down();
      // Wrap the actual drag paint, since regular overlay render diagnostics do
      // not include synchronous work triggered directly by pointermove.
      await page.evaluate(id => {
        const plugin = app.plugins.plugins['margin-link'], [, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
        const state = window.marginCurveDrag = { overlay, oldPaint: overlay.paintConnectors, oldSave: plugin.saveData,
          paint: [], frames: [], lastFrame: performance.now(), saves: 0, moves: 0, active: true, longTasks: [] };
        overlay.paintConnectors = function (...args) {
          const start = performance.now(); try { return state.oldPaint.apply(this, args); }
          finally { state.paint.push(performance.now() - start); }
        };
        plugin.saveData = function (...args) { state.saves++; return state.oldSave.apply(this, args); };
        state.move = () => state.moves++; document.addEventListener('pointermove', state.move, true);
        state.observer = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(entry => entry.duration)));
        state.observer.observe({ entryTypes: ['longtask'] });
        const sample = timestamp => {
          if (!state.active) return; state.frames.push(timestamp - state.lastFrame); state.lastFrame = timestamp;
          state.raf = requestAnimationFrame(sample);
        }; state.raf = requestAnimationFrame(sample);
        overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      }, id);
      let timing;
      try {
        for (let step = 1; step <= 48; step++) {
          const t = step / 48;
          await page.mouse.move(start.rect.x + start.rect.width / 2 + 32 * Math.sin(t * Math.PI * 2),
            start.rect.y + start.rect.height / 2 + yDirection * 72 * Math.sin(t * Math.PI));
          await frames(1);
        }
        timing = await page.evaluate(() => {
          const state = window.marginCurveDrag; state.active = false; cancelAnimationFrame(state.raf); state.observer.disconnect();
          const summary = values => {
            const sorted = [...values].sort((a, b) => a - b);
            return { count: sorted.length, total: values.reduce((a, b) => a + b, 0), p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
              p95: sorted[Math.floor(sorted.length * .95)] ?? 0, max: sorted.at(-1) ?? 0, over16: values.filter(value => value > 16.7).length, over50: values.filter(value => value > 50).length };
          };
          return { paint: summary(state.paint), frames: summary(state.frames), longTasks: state.longTasks,
            saves: state.saves, moves: state.moves, diagnostics: { ...state.overlay.diagnostics, work: undefined }, rawPaint: state.paint };
        });
      } finally {
        await page.evaluate(() => {
          const state = window.marginCurveDrag; state.active = false; cancelAnimationFrame(state.raf); state.observer.disconnect();
          state.overlay.paintConnectors = state.oldPaint; app.plugins.plugins['margin-link'].saveData = state.oldSave;
          document.removeEventListener('pointermove', state.move, true);
        });
      }
      const checkpoints = [];
      let held;
      for (const t of [.25, .5, .75]) {
        await page.mouse.move(start.rect.x + start.rect.width / 2 + 32 * Math.sin(t * Math.PI * 2),
          start.rect.y + start.rect.height / 2 + yDirection * 72 * Math.sin(t * Math.PI));
        await frames(2); held = await probe(id);
        checkpoints.push({ t, geometry: assertGeometry(held) });
      }
      const dragged = held.cards.find(card => card.key === start.key);
      assert(Math.abs(dragged.rect.y - start.rect.y) > 40, 'Held geometry must show a truly moved card');
      assert(await page.evaluate(id => [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id)[1].cardDrag.dragging, id), 'Pointer gesture must remain active');
      assert(timing.moves >= 47, 'Actual pointer events must arrive'); assert.equal(timing.saves, 0, 'No save during pointermove');
      for (const card of before.cards.filter(card => card.key !== start.key)) {
        const other = held.cards.find(candidate => candidate.key === card.key); assert(other, `${card.label}: disappeared`);
        assert(Math.abs(other.rect.x - card.rect.x) <= 1 && Math.abs(other.rect.y - card.rect.y) <= 1, `${card.label}: moved during ship drag`);
      }
      await page.screenshot({ path: `${output}/${mode}-${style}-${draggedLabel}-held.png` });
      await page.keyboard.press('Escape'); await page.mouse.up(); await frames(8);
      const restored = await probe(id), finalGeometry = assertGeometry(restored), restoredCard = restored.cards.find(card => card.key === start.key);
      assert(Math.abs(start.rect.x - restoredCard.rect.x) <= 1 && Math.abs(start.rect.y - restoredCard.rect.y) <= 1, 'Escape restores exact starting placement');
      const afterLayouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()); assert.deepEqual(afterLayouts, layouts, 'Cancelled drag cannot save placement');
      return { draggedLabel, actualSide: start.side, timing, beforeGeometry, checkpoints, finalGeometry };
    });
  }
  if (phase === 'final') for (const mode of ['preview', 'source']) await check(`${mode}/curve: immediate pointerup uses release coordinates and placement survives plugin reload`, async () => {
    const id = await open(mode, 'curve'), before = await probe(id), start = before.cards.find(card => card.label === 'ship'); assert(start);
    const x = start.rect.x + start.rect.width / 2, y = start.rect.y + start.rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 16, y - 24);
    await page.mouse.move(x + 27, y - 47);
    // No frame wait between the last pointer event and release. The committed
    // position must use the latest actual input even when a preview is queued.
    await page.mouse.up(); await frames(10);
    const dropped = await probe(id), moved = dropped.cards.find(card => card.key === start.key);
    assert(Math.abs(moved.rect.x - start.rect.x - 27) <= 1 && Math.abs(moved.rect.y - start.rect.y + 47) <= 1, 'Immediate release must commit the last pointer position');
    const droppedGeometry = assertGeometry(dropped);
    const saved = await page.evaluate(async () => { const plugin = app.plugins.plugins['margin-link']; await plugin.flush(); return plugin.layouts.snapshot(); });
    assert.notDeepEqual(saved, layouts, 'Legal drop saves a UI placement');
    const disk = JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/data.json', 'utf8'));
    assert.deepEqual(disk.layouts, saved, 'Committed placement must reach the isolated data.json');
    await page.evaluate(async () => { await app.plugins.disablePlugin('margin-link'); await app.plugins.enablePlugin('margin-link'); }); await frames(12);
    const reopenedID = await open(mode, 'curve', false), reopened = await probe(reopenedID), restored = reopened.cards.find(card => card.label === 'ship');
    assert(Math.abs(restored.rect.x - moved.rect.x) <= 1 && Math.abs(restored.rect.y - moved.rect.y) <= 1, 'Plugin reload must restore saved placement without a jump');
    assert.deepEqual(await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()), saved);
    const reopenedGeometry = assertGeometry(reopened);
    return { droppedGeometry, reopenedGeometry, savedPlacementCount: saved.length };
  });
  report.status = report.scenarios.every(scenario => scenario.passed) && !report.errors.length ? 'passed' : 'failed';
  if (phase === 'final' && report.status !== 'passed') process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  if (page) {
    await page.keyboard.press('Escape').catch(() => {}); await page.mouse.up().catch(() => {});
    await page.evaluate(async ({ preferences, layouts }) => {
      const plugin = app.plugins.plugins['margin-link']; if (preferences) Object.assign(plugin.preferences, preferences);
      if (layouts) plugin.layouts.records = layouts; plugin.refresh(); await plugin.savePreferences();
    }, { preferences, layouts }).catch(error => { report.restoreError = String(error); });
  }
  report.finalFormalSHA256 = hash(await readFile(path.join('E:/Obsidian仓库/AnyTime', fixture)));
  assert.equal(report.finalFormalSHA256, original, 'Formal source note changed');
  await save(); await browser?.close();
  console.log(`${report.status}: ${output}/results.json (${report.scenarios.filter(scenario => scenario.passed).length}/${report.scenarios.length})`);
}
