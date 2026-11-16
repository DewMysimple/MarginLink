/* global app */
// Run against an isolated Obsidian: node scripts/desktop-scroll-routing.mjs [baseline|final] [--scroll-only]
// CDP defaults to 9223; MARGINLINK_CDP_URL can select the isolated launcher endpoint.
// Uses independent text Ranges and SVG screen transforms, never the layout engine's expected values.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const phase = process.argv[2] ?? 'final';
assert(['baseline', 'final'].includes(phase));
const strict = phase === 'final', scrollOnly = process.argv.includes('--scroll-only');
const fixture = 'Scroll Routing.md', directory = 'artifacts';
const reportPath = `${directory}/scroll-routing-${phase}${scrollOnly ? '-scroll' : ''}.json`;
const results = [], observations = [], errors = [];
let browser, page, originalPreferences, originalLayouts;
const report = { phase, scrollOnly, status: 'running', results, observations, errors };
const persistReport = async () => { await mkdir(directory, { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2)); };
const frames = async (count = 3) => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), count);
const check = async (name, fn) => {
  try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error), stack: error.stack }); await persistReport(); if (strict) throw error; console.log(`BASELINE ${name}: ${error.message}`); }
};
const configure = async values => {
  await page.evaluate(async values => { const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, values); await p.savePreferences(); }, values);
  await frames(4);
};
const open = async (mode, source = false, newLeaf = false) => {
  const id = await page.evaluate(async ({ fixture, mode, source, newLeaf }) => {
    const leaf = newLeaf ? app.workspace.getLeaf('split') : app.workspace.getLeavesOfType('markdown')[0] ?? app.workspace.getLeaf(true);
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source } });
    app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
  }, { fixture, mode, source, newLeaf });
  await page.waitForFunction(id => [...app.plugins.plugins['margin-link'].overlays].some(([view, overlay]) => view.leaf.id === id && overlay.cards.size > 0), id);
  await frames(8); return id;
};
const snapshot = id => page.evaluate(id => window.marginScrollProbe(id), id);
const center = async id => {
  await page.evaluate(id => {
    const pair = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
    const view = pair[0], bridge = [...app.plugins.plugins['margin-link'].bridges].find(b => view.contentEl.contains(b.cm.dom));
    const scroller = view.getMode() === 'source' ? bridge.cm.scrollDOM : view.previewMode.containerEl;
    if (bridge && view.getMode() === 'source') {
      const at = bridge.text.indexOf('Early Access');
      const position = view.editor.offsetToPos(at);
      view.editor.scrollIntoView({ from: position, to: position }, true);
    } else {
      const anchor = [...view.contentEl.querySelectorAll('a.internal-link')].find(a => a.textContent === 'Early Access');
      scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
    }
  }, id); await frames(6);
};
const scrollFrames = async (id, deltas) => page.evaluate(async ({ id, deltas }) => {
  const pair = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id), view = pair[0];
  const bridge = [...app.plugins.plugins['margin-link'].bridges].find(b => view.contentEl.contains(b.cm.dom));
  const scroller = view.getMode() === 'source' ? bridge.cm.scrollDOM : view.previewMode.containerEl;
  const records = [];
  for (const delta of deltas) {
    scroller.scrollTop += delta;
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    records.push(window.marginScrollProbe(id));
  }
  return records;
}, { id, deltas });
const assertStable = records => {
  const known = new Map(); let partial = 0, measured = 0;
  for (const frame of records) for (const card of frame.cards) {
    if (card.clipped === 'partial') partial++;
    if (!card.reference) continue;
    const previous = known.get(card.key), offset = card.centerY - card.reference.y;
    if (previous) {
      assert(Math.abs(offset - previous.offset) <= 1, `${card.label}: reference drift ${offset - previous.offset}px at scroll ${frame.scrollTop}`);
      assert.equal(card.side, previous.side, `${card.label}: switched side while scrolling`);
    } else known.set(card.key, { offset, side: card.side });
    measured++;
    assert(card.laneSafe, `${card.label}: overlaps body or another pane`);
    assert(!card.blocksOutsideClip, `${card.label}: clipped region intercepts a neighbouring control`);
  }
  assert(measured > 30, 'Insufficient independently measured card frames');
  assert(partial > 0, 'Trajectory never exercised partial card clipping');
  for (let i = 1; i < records.length; i++) {
    const before = records[i - 1], after = records[i];
    for (const side of ['left', 'right']) {
      const a = before.cards.filter(c => c.side === side).sort((a, b) => a.centerY - b.centerY).map(c => c.key);
      const b = after.cards.filter(c => c.side === side).sort((a, b) => a.centerY - b.centerY).map(c => c.key);
      const common = new Set(a.filter(k => b.includes(k)));
      assert.deepEqual(a.filter(k => common.has(k)), b.filter(k => common.has(k)), 'Same-side order changed during scroll');
    }
  }
};

try {
  await persistReport();
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 12000 });
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page, 'Isolated Obsidian is not running');
  await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace && app.plugins.plugins['margin-link']);
  assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault', 'Never run in a real Vault');
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Only this repository test-vault is authorized');
  assert(await page.evaluate(fixture => !!app.vault.getFileByPath(fixture), fixture), 'Missing isolated Scroll Routing.md fixture');
  report.host = await page.title(); report.plugin = JSON.parse(await readFile('manifest.json', 'utf8')).version;
  report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  page.on('pageerror', error => errors.push({ message: String(error), stack: error.stack }));
  originalPreferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  originalLayouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 950, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  await page.evaluate(() => {
    window.marginScrollProbe = id => {
      const plugin = app.plugins.plugins['margin-link'];
      const [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
      const host = view.contentEl, hostBox = host.getBoundingClientRect();
      const bridge = [...plugin.bridges].find(b => host.contains(b.cm.dom));
      const source = view.getMode() === 'source', content = source ? bridge.cm.contentDOM : view.previewMode.containerEl.querySelector('.markdown-preview-sizer');
      const scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;
      const scrollBox = scroller.getBoundingClientRect();
      const viewport = new DOMRect(scrollBox.left + scroller.clientLeft, scrollBox.top + scroller.clientTop, scroller.clientWidth, scroller.clientHeight);
      const body = content.getBoundingClientRect(), css = getComputedStyle(content);
      const bodyLeft = body.left + parseFloat(css.paddingLeft), bodyRight = body.right - parseFloat(css.paddingRight);
      const boxes = range => [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0);
      const referenceFor = occurrence => {
        try {
          const range = document.createRange();
          if (source) {
            const at = occurrence.raw.indexOf('|'), from = occurrence.start + (at >= 0 ? at + 1 : 2);
            const a = bridge.cm.domAtPos(from), b = bridge.cm.domAtPos(occurrence.end - 2);
            range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset);
            // CM can map an unrendered position to a neighbouring DOM boundary.
            if (!range.toString().includes(occurrence.label)) return null;
          } else {
            const links = [...host.querySelectorAll('a.internal-link')].filter(a => a.textContent === occurrence.label);
            const occurrences = [...overlay.cards.values()].filter(c => c.anchor.occurrence.label === occurrence.label).sort((a, b) => a.anchor.occurrence.start - b.anchor.occurrence.start);
            const index = occurrences.findIndex(c => c.anchor.occurrence.start === occurrence.start);
            const element = links[index]; if (!element) return null; range.selectNodeContents(element);
          }
          const rects = boxes(range); return rects.length ? { x: (rects.at(-1).left + rects.at(-1).right) / 2, y: rects.at(-1).bottom + 2, fragments: rects.map(r => r.toJSON()) } : null;
        } catch { return null; }
      };
      // Independent text-node Ranges cover ordinary body text, links, headings and code.
      const protectedText = [], walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, el = node.parentElement;
        if (!node.textContent.trim() || !el || el.closest('.margin-link-overlay, .cm-widgetBuffer, .cm-foldPlaceholder')) continue;
        const style = getComputedStyle(el); if (style.display === 'none' || style.visibility === 'hidden') continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of boxes(range)) if (rect.bottom > viewport.top && rect.top < viewport.bottom) protectedText.push(rect.toJSON());
      }
      const cards = [...overlay.cards].map(([key, card]) => {
        const rect = card.shell.getBoundingClientRect(), reference = referenceFor(card.anchor.occurrence);
        const visible = rect.bottom > viewport.top && rect.top < viewport.bottom;
        const clipped = !visible ? 'outside' : rect.top < viewport.top || rect.bottom > viewport.bottom ? 'partial' : 'inside';
        const path = card.path, matrix = path.getScreenCTM(), d = path.getAttribute('d');
        const route = { drawn: !!d, portError: null, collisions: [], endpointError: null };
        if (d && matrix) {
          const length = path.getTotalLength(), start = path.getPointAtLength(0).matrixTransform(matrix), end = path.getPointAtLength(length).matrixTransform(matrix);
          const mids = [[rect.left, rect.top + rect.height / 2], [rect.right, rect.top + rect.height / 2], [rect.left + rect.width / 2, rect.top], [rect.left + rect.width / 2, rect.bottom]];
          route.endpointError = Math.min(...mids.map(([x, y]) => Math.hypot(end.x - x, end.y - y)));
          if (reference) route.portError = Math.min(...reference.fragments.flatMap(r => [r.top, r.bottom].map(y => Math.hypot(start.x - (r.left + r.right) / 2, start.y - y))));
          const pad = plugin.preferences.lineWidth / 2 + 0.25;
          for (let distance = Math.max(4, pad + 2); distance < length; distance += 0.5) {
            const point = path.getPointAtLength(distance).matrixTransform(matrix);
            if (point.y < viewport.top || point.y > viewport.bottom) continue;
            if (protectedText.some(r => point.x > r.left - pad && point.x < r.right + pad && point.y > r.top - pad && point.y < r.bottom + pad)) { route.collisions.push({ distance, x: point.x, y: point.y }); break; }
          }
        }
        const outsidePoints = [[rect.left + rect.width / 2, Math.min(rect.bottom - 1, viewport.top - 1)], [rect.left + rect.width / 2, Math.max(rect.top + 1, viewport.bottom + 1)]];
        const blocksOutsideClip = outsidePoints.some(([x, y]) => y > rect.top && y < rect.bottom && (y < viewport.top || y > viewport.bottom) && card.shell.contains(document.elementFromPoint(x, y)));
        return { key, label: card.anchor.occurrence.label, target: card.anchor.occurrence.target, side: card.placement.side, manual: card.shell.dataset.manual, rect: rect.toJSON(), centerY: rect.top + rect.height / 2, reference, clipped, visible, blocksOutsideClip, laneSafe: rect.left >= Math.max(hostBox.left, viewport.left) - 1 && rect.right <= Math.min(hostBox.right, viewport.right) + 1 && (rect.right <= bodyLeft + 1 || rect.left >= bodyRight - 1), route };
      });
      return { time: performance.now(), scrollTop: scroller.scrollTop, viewport: viewport.toJSON(), rootClip: getComputedStyle(overlay.root).clipPath, cards };
    };
  });
  await configure({ enabled: true, lines: 'always', cardShape: 'square', cardSize: 'medium', lineStyle: 'elbow', lineWidth: 1.5, layout: 'balanced', reduceMotion: true });
  for (const [mode, source] of [['preview', false], ['source', false], ['source', true]]) {
    for (const placementMode of ['auto', 'free', 'snap']) await check(`${mode}/${source ? 'source' : 'rendered'}/${placementMode}: continuous relative scrolling and natural clipping`, async () => {
      await configure({ placementMode, layout: 'balanced' }); const id = await open(mode, source); await center(id);
      const saved = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
      const first = await snapshot(id), early = first.cards.find(c => c.label === 'Early Access'); assert(early?.reference);
      const distance = Math.max(20, Math.ceil((early.reference.y - first.viewport.top + 240) / 6));
      const deltas = [...Array(distance).fill(6), 480, -480, ...Array(distance).fill(-6)];
      const records = [first, ...await scrollFrames(id, deltas)]; observations.push({ mode, source, placementMode, records }); assertStable(records);
      assert.deepEqual(await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()), saved, 'Pure scroll wrote layout records');
      await page.screenshot({ path: `${directory}/scroll-${mode}-${source}-${placementMode}.png` });
    });
  }
  await check('manual card: drag, scroll across both edges, return and reopen without losing position', async () => {
    await configure({ placementMode: 'free', layout: 'balanced' }); const id = await open('source'); await center(id);
    const before = await snapshot(id), target = before.cards.find(c => c.label === 'dives'); assert(target?.visible);
    const x = target.rect.left + target.rect.width / 2, y = target.centerY;
    const dropY = Math.min(before.viewport.bottom - target.rect.height / 2 - 12, y + 110);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, dropY, { steps: 8 }); await page.mouse.up(); await frames(4);
    const placed = await snapshot(id), moved = placed.cards.find(c => c.key === target.key); assert.equal(moved.manual, 'true');
    const saved = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
    const records = [placed, ...await scrollFrames(id, [...Array(100).fill(6), 800, -800, ...Array(100).fill(-6)])];
    observations.push({ scenario: 'manual', records }); assertStable(records);
    assert.deepEqual(await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()), saved);
    await page.evaluate(async id => { const leaf = app.workspace.getLeafById(id); await leaf.openFile(app.vault.getFileByPath('Note A.md')); }, id);
    await open('source'); await center(id); const returned = (await snapshot(id)).cards.find(c => c.key === target.key);
    assert(Math.abs((returned.centerY - returned.reference.y) - (moved.centerY - moved.reference.y)) <= 1, 'Reopen changed saved relative offset');
  });
  await check('split panes: scroll one pane without moving the other', async () => {
    await configure({ placementMode: 'free' }); const first = await open('source'); await center(first); const second = await open('preview', false, true); await center(second);
    const before = await snapshot(first); await scrollFrames(second, Array(35).fill(5)); const after = await snapshot(first);
    for (const a of before.cards) { const b = after.cards.find(c => c.key === a.key); if (b) assert(Math.abs(a.centerY - b.centerY) <= 1, `${a.label}: other pane moved`); }
    await page.screenshot({ path: `${directory}/scroll-routing-split.png` });
    await page.evaluate(id => app.workspace.getLeafById(id).detach(), second);
  });
  if (!scrollOnly) for (const [mode, source] of [['preview', false], ['source', false], ['source', true]]) {
    for (const lineStyle of ['straight', 'elbow', 'curve']) for (const lineWidth of [1.5, 5]) for (const side of ['left', 'right']) await check(`${mode}/${source}/${lineStyle}/${lineWidth}/${side}: actual SVG avoids protected text`, async () => {
      await configure({ lineStyle, lineWidth, layout: side, placementMode: 'auto' }); const id = await open(mode, source); await center(id);
      const records = [await snapshot(id), ...await scrollFrames(id, [4, 4, 4, -4, -4, -4])];
      observations.push({ mode, source, lineStyle, lineWidth, side, records });
      const drawn = records[0].cards.filter(c => c.visible && c.route.drawn);
      assert(drawn.some(c => c.side === side), 'No complete connector on requested side in whitespace fixture');
      for (const frame of records) for (const card of frame.cards.filter(c => c.route.drawn)) {
        if (card.reference) assert(card.route.portError <= 1, `${card.label}: source is not upper/lower midpoint (${card.route.portError}px)`);
        assert(card.route.endpointError <= 1, `${card.label}: card endpoint mismatch`);
        assert.deepEqual(card.route.collisions, [], `${card.label}: actual SVG crosses independently measured readable text`);
      }
      await page.screenshot({ path: `${directory}/routing-${mode}-${source}-${lineStyle}-${lineWidth}-${side}.png` });
    });
  }
  assert.deepEqual(errors, []); report.status = results.some(r => !r.passed) ? 'baseline-failures' : 'passed';
} catch (error) {
  report.status = page ? 'failed' : 'blocked'; report.error = String(error); report.stack = error.stack; process.exitCode = 1;
} finally {
  if (page && originalLayouts) await page.evaluate(async records => { const p = app.plugins.plugins['margin-link']; p.layouts.records = records; p.refresh(); await p.flush(); }, originalLayouts).catch(error => { report.restoreLayoutsError = String(error); });
  if (page && originalPreferences) await configure(originalPreferences).catch(error => { report.restoreError = String(error); });
  if (page && originalLayouts) report.savedLayoutsUnchanged = JSON.stringify(await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()).catch(() => null)) === JSON.stringify(originalLayouts);
  await persistReport(); await browser?.close(); console.log(`${report.status}: ${reportPath}`);
}
