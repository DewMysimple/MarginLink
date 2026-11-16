/* global app */
// Read the reported note only to prepare an isolated reproduction. Never attach
// this script to a real Vault. Raw copied content remains outside Git delivery.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv.includes('baseline') ? 'baseline' : 'final';
const intro = process.argv.includes('--intro');
const widthArgument = process.argv.find(argument => argument.startsWith('--width='));
const requestedLineWidth = widthArgument ? Number(widthArgument.slice('--width='.length)) : undefined;
assert(requestedLineWidth === undefined || Number.isFinite(requestedLineWidth) && requestedLineWidth > 0 && requestedLineWidth <= 8, 'Invalid line width');
const output = `artifacts/route-quality/${phase}${intro ? '-intro' : ''}${requestedLineWidth === undefined ? '' : `-width-${requestedLineWidth}`}`;
const sourceVault = 'E:/Obsidian仓库/AnyTime';
const fixture = '详细分析/The road to Unreal Engine 6. Read about our plans and timeline.md';
const labels = intro ? ['glimpse', 'fellow', 'reinvented', 'evolving'] : ['Early Access', 'dives', 'Verse', 'Scene Graph', 'model-assisted', 'ship'];
const vault = path.resolve('test-vault');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, relative) => {
  const result = path.resolve(root, relative), rel = path.relative(path.resolve(root), result);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'Path must remain below its explicit Vault');
  return result;
};
await mkdir(output, { recursive: true });
const original = await readFile(within(sourceVault, fixture));
const originalSHA256 = digest(original);
const realData = JSON.parse(await readFile(within(sourceVault, '.obsidian/plugins/margin-link/data.json'), 'utf8'));
const selectedData = { schemaVersion: realData.schemaVersion, preferences: realData.preferences,
  layouts: realData.layouts.filter(record => record.source === fixture) };
if (process.argv.includes('--prepare')) {
  const relativeFiles = [fixture, ...new Set([...original.toString('utf8').matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(match => match[1]))];
  const copied = [];
  for (const relative of relativeFiles) {
    const from = within(sourceVault, relative), info = await stat(from);
    assert(info.isFile(), `Refuse non-file fixture: ${relative}`);
    const to = within(vault, relative); await mkdir(path.dirname(to), { recursive: true }); await copyFile(from, to);
    copied.push({ file: relative, bytes: info.size, sha256: digest(await readFile(from)) });
  }
  await writeFile(within(vault, '.obsidian/plugins/margin-link/data.json'), JSON.stringify(selectedData, null, 2));
  await copyFile(within(sourceVault, '.obsidian/appearance.json'), within(vault, '.obsidian/appearance.json'));
  await writeFile('artifacts/route-quality/fixture-receipt.json', JSON.stringify({ originalSHA256, copied }, null, 2));
  assert.equal(digest(await readFile(within(sourceVault, fixture))), originalSHA256);
  console.log(`Prepared ${copied.length} selected files in test-vault; formal note unchanged: ${originalSHA256}`);
  process.exit(0);
}

const report = { phase, section: intro ? 'intro' : 'closing', labels, requestedLineWidth: requestedLineWidth ?? null, status: 'running', fixtureSHA256: originalSHA256, scenarios: [], errors: [] };
let browser, page, preferences, layouts;
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (count = 8) => page.evaluate(count => new Promise(resolve => {
  const tick = () => --count ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick);
}), count);
const check = async (name, run) => {
  try { const detail = await run(); report.scenarios.push({ name, passed: true, ...detail }); console.log('PASS', name); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack, snapshot: error.snapshot }); console.log('FAIL', name, error.message); }
  await save();
};

try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('app://obsidian.md/'));
  assert(page); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => typeof app !== 'undefined' && !!app.plugins.plugins['margin-link']);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), vault.toLowerCase(), 'Refuse real Vaults');
  // The article contains a remote image and extension iframe. Neither is needed
  // for its local source geometry or native Wikilinks.
  await page.route(/^https?:\/\//, route => route.abort());
  page.on('pageerror', error => report.errors.push(String(error)));
  report.host = await page.title();
  report.manifest = JSON.parse(await readFile(within(vault, '.obsidian/plugins/margin-link/manifest.json'), 'utf8'));
  report.bundleSHA256 = digest(await readFile(within(vault, '.obsidian/plugins/margin-link/main.js')));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async ({ selectedData, fixture, requestedLineWidth }) => {
    const plugin = app.plugins.plugins['margin-link'];
    Object.assign(plugin.preferences, selectedData.preferences, { enabled: true, lines: 'always', reduceMotion: true });
    if (requestedLineWidth !== undefined) plugin.preferences.lineWidth = requestedLineWidth;
    plugin.layouts.records = selectedData.layouts;
    await plugin.savePreferences();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const leaves = app.workspace.getLeavesOfType('markdown'), leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: 'preview', source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, { selectedData, fixture, requestedLineWidth }); await frames(15);
  report.actualLineWidth = await page.evaluate(() => app.plugins.plugins['margin-link'].preferences.lineWidth);

  // Reuse independent native SVG path sampling, then add an exact primitive
  // turn counter. Shared path partition boundaries do not count as bends.
  const existing = await readFile('scripts/desktop-connectors-manual.mjs', 'utf8');
  const match = /window\.marginConnectorProbe = id => \{([\s\S]*?)\n {4}\};/.exec(existing); assert(match);
  const probe = `window.marginConnectorProbe = id => {${match[1]}\n};`
    .replaceAll("overlay.root.querySelectorAll('[data-relation][data-end]')", "overlay.decorations.canvas.querySelectorAll('[data-relation][data-end]')")
    .replaceAll('scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;', "scroller = source ? bridge.cm.scrollDOM : (view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl);")
    .replaceAll('.margin-link-overlay, .cm-gap', '.margin-link-overlay, .margin-link-decoration-layer, .cm-gap')
    // Blink serializes an SVG calc() width as "calc(2.5px)" even though it is
    // visibly painted. Resolve its native CSS numeric value, not parseFloat.
    .replaceAll('Number.parseFloat(css.strokeWidth)', "CSSNumericValue.parse(css.strokeWidth).to('px').value")
    .replaceAll('opacity: Number(css.opacity), width:', 'opacity: Number(css.opacity), display: css.display, visibility: css.visibility, rawStrokeWidth: css.strokeWidth, width:')
    .replaceAll('const collisions = [], padding = plugin.preferences.lineWidth / 2 + .15;', 'const collisions = [], padding = Math.max(plugin.preferences.lineWidth, ...parts.filter(Boolean).map(p => p.width)) / 2 + .15;')
    .replaceAll("visible: css.display !== 'none'", "visible: el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && css.display !== 'none'");
  await page.evaluate(probe);
  const open = async mode => {
    const id = await page.evaluate(async ({ fixture, mode }) => {
      const leaf = app.workspace.getLeavesOfType('markdown')[0];
      await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source: false } });
      app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
    }, { fixture, mode }); await frames(12);
    await page.evaluate(async ({ id, fixture, intro, label }) => {
      const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
      if (view.file.path !== fixture) throw Error('Wrong test fixture');
      if (view.getMode() === 'source') {
        const at = view.editor.getValue().lastIndexOf(label), pos = view.editor.offsetToPos(at);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
      } else {
        const scroll = view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
        scroll.scrollTop = intro ? 0 : scroll.scrollHeight;
        let link;
        for (let i = 0; i < 30; i++) {
          link = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === label);
          if (link) break;
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        if (!link) throw Error('Reading fixture link is not rendered');
        scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight * .56;
      }
      overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
    }, { id, fixture, intro, label: labels[0] }); await frames(15);
    if (intro) {
      // Keep saved placement records untouched. Centre the union by scrolling
      // only, and let the assertions distinguish genuine document-edge clipping.
      await page.evaluate(({ id, labels }) => {
        const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
        const scroll = view.getMode() === 'source' ? overlay.bridge().cm.scrollDOM : view.previewMode.containerEl.querySelector('.markdown-preview-view');
        const raw = scroll.getBoundingClientRect(), selected = [...overlay.cards.values()].filter(card => labels.includes(card.anchor.occurrence.label));
        const boxes = selected.flatMap(card => [card.shell.getBoundingClientRect(), ...card.anchor.fragments]);
        if (!boxes.length) return;
        const top = Math.min(...boxes.map(box => box.top)), bottom = Math.max(...boxes.map(box => box.bottom));
        scroll.scrollTop += (top + bottom) / 2 - (raw.top + scroll.clientTop + scroll.clientHeight / 2);
      }, { id, labels }); await frames(15);
    }
    return id;
  };
  const snapshot = async id => {
    const geometry = await page.evaluate(id => window.marginConnectorProbe(id), id);
    const extras = await page.evaluate(id => {
      const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
      const byID = new Map([...overlay.svg.querySelectorAll('path')].filter(el => el.dataset.logical !== 'true').map(el => [el.dataset.segment, el]));
      const parts = element => {
        if (!element) return [];
        const tokens = element.getAttribute('d')?.match(/[MLQC]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
        const values = [], matrix = element.getScreenCTM(); let from;
        const point = () => new DOMPoint(Number(tokens.shift()), Number(tokens.shift())).matrixTransform(matrix);
        while (tokens.length) {
          const command = tokens.shift();
          if (command === 'M') from = point();
          else if (command === 'L') { const to = point(); values.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, curved: false }); from = to; }
          else if (command === 'Q' || command === 'C') { point(); if (command === 'C') point(); const to = point(); values.push({ from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y }, curved: true }); from = to; }
          else throw Error(`Unexpected SVG command: ${command}`);
        }
        return values;
      };
      const routeQuality = [...overlay.cards].map(([key, card]) => {
        const references = JSON.parse(card.shell.dataset.routeSegments ?? '[]');
        const actual = references.flatMap(ref => {
          const list = parts(byID.get(typeof ref === 'string' ? ref : ref.id));
          return ref.reversed ? list.reverse().map(p => ({ ...p, from: p.to, to: p.from })) : list;
        });
        const straight = actual.filter(p => !p.curved && Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y) > .001);
        let bends = 0, nonorthogonal = 0;
        for (let i = 0; i < straight.length; i++) {
          const p = straight[i], dx = p.to.x - p.from.x, dy = p.to.y - p.from.y;
          if (Math.abs(dx) > .001 && Math.abs(dy) > .001) nonorthogonal++;
          if (!i) continue;
          const before = straight[i - 1], bx = before.to.x - before.from.x, by = before.to.y - before.from.y;
          if (Math.abs(bx * dy - by * dx) > .001 || bx * dx + by * dy < 0) bends++;
        }
        return { key, bends, nonorthogonal, primitives: actual.length, actual };
      });
      const body = view.getMode() === 'source' ? overlay.bridge().cm.contentDOM : view.contentEl.querySelector('.markdown-preview-sizer');
      const style = getComputedStyle(body);
      const boxes = [], walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), range = document.createRange();
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || node.parentElement?.closest('.margin-link-overlay,.margin-link-decoration-layer,.cm-gap,.cm-widgetBuffer')) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > .5 && rect.height > 0) boxes.push(rect.toJSON());
      }
      const sourceGaps = [...overlay.cards].map(([key, card]) => ({ key, label: card.anchor.occurrence.label,
        fragments: card.anchor.fragments.map(fragment => {
          const x = (fragment.left + fragment.right) / 2;
          const column = boxes.filter(box => box.left < x && box.right > x);
          const above = column.filter(box => box.bottom <= fragment.top + .01).sort((a, b) => b.bottom - a.bottom)[0];
          const below = column.filter(box => box.top >= fragment.bottom - .01).sort((a, b) => a.top - b.top)[0];
          return { x, left: fragment.left, right: fragment.right, top: fragment.top, bottom: fragment.bottom, gapAbove: above ? fragment.top - above.bottom : null, gapBelow: below ? below.top - fragment.bottom : null, above, below };
        }) }));
      return { diagnostics: overlay.diagnostics, routeQuality, sourceGaps, font: { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight }, contentWidth: body.getBoundingClientRect().width };
    }, id);
    geometry.cards = geometry.cards.map(card => ({ ...card, ...extras.routeQuality.find(q => q.key === card.key) }));
    delete extras.routeQuality;
    return { ...geometry, ...extras };
  };
  for (const size of [[1614, 838], [1536, 717]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false }); await frames(10);
    for (const mode of ['preview', 'source']) for (const style of ['straight', 'elbow']) {
      await page.evaluate(async style => { const p = app.plugins.plugins['margin-link']; p.preferences.lineStyle = style; await p.savePreferences(); }, style);
      const id = await open(mode), captured = await snapshot(id);
      await page.screenshot({ path: `${output}/${size[0]}-${size[1]}-${mode}-${style}.png` });
      await check(`${size.join('x')}/${mode}/${style}: ${labels.length} complete low-turn glyph-safe visible routes`, async () => {
        report.lastSnapshot = captured;
        const cards = captured.cards.filter(card => labels.includes(card.label)); assert.equal(cards.length, labels.length, `${labels.length} relevant cards required`);
        for (const card of cards) {
          assert(card.sourceVisible && card.fullyVisible, `${card.label}: fixture endpoints clipped`);
          assert.equal(card.routeState, 'complete', `${card.label}: full on-screen route must not fall back to continuation`);
          assert(card.route.complete, `${card.label}: incomplete ${card.routeState}`);
          assert(card.route.startError <= 1 && card.route.endError <= 1 && card.route.jointError <= 1, `${card.label}: visible SVG endpoint gap`);
          for (const point of card.actual.flatMap(primitive => [primitive.from, primitive.to])) assert(
            point.x >= captured.viewport.left - 1 && point.x <= captured.viewport.right + 1 &&
            point.y >= captured.viewport.top - 1 && point.y <= captured.viewport.bottom + 1,
            `${card.label}: actual SVG leaves the visible viewport`);
          assert(card.markers.every(marker => !marker.visible), `${card.label}: visible continuation badge remains beside a complete line`);
          assert.deepEqual(card.route.collisions, [], `${card.label}: stroke intersects text/card`);
          assert(card.bends <= (style === 'elbow' ? 5 : 4), `${card.label}: ${card.bends} bends`);
          if (style === 'elbow') assert.equal(card.nonorthogonal, 0, `${card.label}: nonorthogonal elbow`);
        }
        return { snapshot: captured };
      });
      // Save failed snapshots too, without coupling baseline evidence to assertions.
      report.scenarios.at(-1).snapshot ??= captured; delete report.lastSnapshot;
      if (requestedLineWidth !== undefined) await check(`${size.join('x')}/${mode}/${style}: all ${labels.length} highlighted strokes remain complete and glyph-safe`, async () => {
        const highlighted = []; let focused;
        try {
          for (const label of labels) {
            await page.evaluate(({ id, label }) => {
              const [, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([view]) => view.leaf.id === id);
              const card = [...overlay.cards.values()].find(card => card.anchor.occurrence.label === label);
              if (!card) throw Error(`Missing card: ${label}`);
              card.button.focus({ preventScroll: true });
            }, { id, label }); await frames(2);
            focused = await snapshot(id); const card = focused.cards.find(card => card.label === label);
            assert.equal(card.routeState, 'complete', `${label}: highlighted route fell back to continuation`);
            assert(card.route.complete && card.route.startError <= 1 && card.route.endError <= 1 && card.route.jointError <= 1, `${label}: highlighted route incomplete`);
            assert.deepEqual(card.route.collisions, [], `${label}: actual highlighted stroke intersects text/card`);
            const owned = focused.paths.filter(segment => segment.members.includes(card.key));
            const highlightedWidth = Math.max(...owned.map(segment => segment.width));
            assert(highlightedWidth >= requestedLineWidth + .49, `${label}: expected the actual +0.5px highlighted stroke`);
            assert(focused.cards.filter(card => labels.includes(card.label)).every(card => card.route.complete && card.routeState === 'complete'), 'Highlighting must keep all selected lines visible');
            highlighted.push({ label, highlightedWidth, bends: card.bends, route: card.route });
          }
        } catch (error) { error.snapshot = focused; throw error; }
        finally { await page.evaluate(() => document.activeElement?.blur()); await frames(2); }
        return { actualLineWidth: report.actualLineWidth, highlighted };
      });
      if (!intro && size[0] === 1614 && style === 'elbow') await check(`${mode}: warmed native scroll performs no re-route, d write or layout save`, async () => {
        // Explicitly visit the whole measured window before the assertion.
        // Reading's virtualized sections may settle after its initial screenshot.
        await page.evaluate(async id => {
          const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
          const scroll = view.getMode() === 'source' ? overlay.bridge().cm.scrollDOM : view.previewMode.containerEl.querySelector('.markdown-preview-view');
          const base = scroll.scrollTop;
          for (let i = 0; i < 24; i++) { scroll.scrollTop = base + Math.sin(i * Math.PI / 6) * 36; await new Promise(resolve => requestAnimationFrame(resolve)); }
          scroll.scrollTop = base;
        }, id); await frames(12);
        await page.evaluate(id => {
          const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([v]) => v.leaf.id === id);
          const scroll = view.getMode() === 'source' ? overlay.bridge().cm.scrollDOM : view.previewMode.containerEl.querySelector('.markdown-preview-view');
          window.marginRouteWarm = { overlay, scroll, base: scroll.scrollTop, counts: { d: 0, saves: 0 }, oldSet: SVGElement.prototype.setAttribute, oldSave: plugin.saveData };
          const state = window.marginRouteWarm;
          SVGElement.prototype.setAttribute = function (name, value) { if (name === 'd' && this.closest('.margin-link-connectors')) state.counts.d++; return state.oldSet.call(this, name, value); };
          plugin.saveData = function (...args) { state.counts.saves++; return state.oldSave.apply(this, args); };
          overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
        }, id);
        let result;
        try {
          result = await page.evaluate(async () => {
            const state = window.marginRouteWarm;
            for (let i = 0; i < 90; i++) { state.scroll.scrollTop = state.base + Math.sin(i * Math.PI / 15) * 36; await new Promise(resolve => requestAnimationFrame(resolve)); }
            state.scroll.scrollTop = state.base;
            const times = state.overlay.diagnostics.work.slice().sort((a, b) => a - b);
            return { counts: state.counts, diagnostics: { ...state.overlay.diagnostics, work: undefined }, workP95: times[Math.floor(times.length * .95)] ?? null };
          });
        } finally {
          await page.evaluate(() => { const state = window.marginRouteWarm; SVGElement.prototype.setAttribute = state.oldSet; app.plugins.plugins['margin-link'].saveData = state.oldSave; });
        }
        assert.equal(result.diagnostics.routes, 0); assert.equal(result.counts.d, 0); assert.equal(result.counts.saves, 0); return result;
      });
      await save();
    }
  }
  report.status = report.scenarios.every(scenario => scenario.passed) && !report.errors.length ? 'passed' : 'failed';
  if (phase === 'final' && report.status !== 'passed') process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  if (page) await page.evaluate(async ({ preferences, layouts }) => { const plugin = app.plugins.plugins['margin-link']; if (preferences) Object.assign(plugin.preferences, preferences); if (layouts) plugin.layouts.records = layouts; plugin.refresh(); await plugin.savePreferences(); }, { preferences, layouts }).catch(error => { report.restoreError = String(error); });
  report.finalFormalSHA256 = digest(await readFile(within(sourceVault, fixture)));
  assert.equal(report.finalFormalSHA256, originalSHA256, 'Formal note changed');
  await save(); await browser?.close();
  console.log(`${report.status}: ${output}/results.json (${report.scenarios.filter(s => s.passed).length}/${report.scenarios.length})`);
}
