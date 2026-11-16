/* global app */
// Isolated Obsidian only. Run node scripts/desktop-connectors-manual.mjs [baseline|final] [--through=11..15].
// Real browser SVG metrics handle M/L/Q/C (and future SVG commands); text is measured independently via Range.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const phase = process.argv.includes('baseline') ? 'baseline' : 'final';
const through = Number(process.argv.find(arg => arg.startsWith('--through='))?.split('=')[1] ?? 15);
assert(through >= 11 && through <= 15, '--through must be 11..15');
const fixture = 'Connector Manual.md', labels = ['Early Access', 'dives', 'Verse', 'Scene Graph', 'model-assisted', 'ship'];
const output = `artifacts/connectors-manual-${phase}-${through}`;
const report = { phase, through, status: 'running', scenariosPassed: 0, scenarios: [], observations: [], errors: [] };
let browser, page, preferences, layouts;
const save = async () => { await mkdir(output, { recursive: true }); await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); };
const frames = async (count = 4) => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : setTimeout(resolve, 0); requestAnimationFrame(next);
}), count);
const check = async (name, fn) => {
  try { await fn(); report.scenarios.push({ name, passed: true }); report.scenariosPassed++; console.log(`PASS ${name}`); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack }); await save(); if (phase === 'final') throw error; console.log(`BASELINE FAILURE ${name}: ${error.message}`); }
};
const configure = async values => { await page.evaluate(async values => { const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, values); await p.savePreferences(); }, values); await frames(); };
const open = async (mode = 'source', source = false, split = false) => {
  const id = await page.evaluate(async ({ fixture, mode, source, split }) => {
    const leaf = split ? app.workspace.getLeaf('split') : app.workspace.getLeavesOfType('markdown')[0] ?? app.workspace.getLeaf(true);
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source } }); app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
  }, { fixture, mode, source, split });
  // Centre the real source occurrence before waiting for cards. A virtualized
  // document can legitimately have no card DOM at its initial scroll position.
  await page.waitForFunction(({ id, fixture }) => {
    const pair = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
    if (!pair || pair[0].file?.path !== fixture) return false;
    const view = pair[0]; return (view.getMode() === 'source' ? view.editor.getValue() : view.data).startsWith('# Connector and manual-layout acceptance');
  }, { id, fixture });
  await page.evaluate(async id => {
    const [view] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
    const bridge = [...app.plugins.plugins['margin-link'].bridges].find(b => view.contentEl.contains(b.cm.dom));
    if (view.getMode() === 'source') { const at = bridge.text.indexOf('Early Access'); const pos = view.editor.offsetToPos(at); view.editor.scrollIntoView({ from: pos, to: pos }, true); }
    else {
      const scroller = view.previewMode.containerEl;
      let link = [...scroller.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access');
      if (!link) scroller.scrollTop = scroller.scrollHeight * view.data.indexOf('Early Access') / view.data.length;
      for (let i = 0; i < 12 && !link; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); link = [...scroller.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access'); }
      if (!link) throw Error('Reading section did not render the source occurrence');
      scroller.scrollTop += link.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
    }
  }, id);
  await page.waitForFunction(id => [...app.plugins.plugins['margin-link'].overlays].some(([v, o]) => v.leaf.id === id && o.contentAnchors.size >= 6), id);
  await frames(8); return id;
};
const probe = id => page.evaluate(id => window.marginConnectorProbe(id), id);
const arrange = async (id, shared = false) => {
  await page.evaluate(({ id, shared, labels, fixture }) => {
    const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([v]) => v.leaf.id === id);
    const viewport = overlay.layoutInput.viewport, center = (viewport.top + viewport.bottom) / 2, lineHeight = overlay.layoutInput.lineHeight;
    const slots = shared ? { 'Scene Graph': ['left', -140], 'Early Access': ['left', -30], Verse: ['left', 80], ship: ['right', -170], 'model-assisted': ['right', 0], dives: ['right', 180] }
      : { 'Scene Graph': ['left', -120], 'Early Access': ['left', 0], Verse: ['left', 120], dives: ['right', -120], 'model-assisted': ['right', 0], ship: ['right', 120] };
    for (const label of labels) {
      const card = [...overlay.cards.values()].find(c => c.anchor.occurrence.label === label), anchor = card?.anchor ?? [...overlay.contentAnchors.values()].find(a => a.occurrence.label === label);
      if (!anchor?.layoutKey) throw Error(`No unique layout key: ${label}`);
      const bridge = [...plugin.bridges].find(b => view.contentEl.contains(b.cm.dom)), scrollTop = view.getMode() === 'source' ? bridge.cm.scrollDOM.scrollTop : view.previewMode.containerEl.scrollTop;
      const reference = card ? anchor.rect.bottom + 2 - view.contentEl.getBoundingClientRect().top : anchor.rect.bottom + 2 - scrollTop;
      plugin.layouts.set(fixture, anchor.layoutKey, { side: slots[label][0], xNormalized: .45, yOffset: (center + slots[label][1] - reference) / lineHeight });
    }
    plugin.refresh();
  }, { id, shared, labels, fixture }); await frames(8);
};
const unchanged = (before, after, except) => {
  for (const card of before.cards.filter(c => c.key !== except)) {
    const other = after.cards.find(c => c.key === card.key); assert(other, `${card.label} disappeared`);
    assert(Math.abs(card.rect.x - other.rect.x) <= 1 && Math.abs(card.rect.y - other.rect.y) <= 1, `${card.label} moved during another card's gesture`);
    assert.equal(other.side, card.side, `${card.label} changed side`);
  }
};
const assertRoutes = (snapshot, requireSix = true) => {
  const cards = snapshot.cards.filter(c => labels.includes(c.label));
  if (requireSix) assert.equal(cards.length, 6, 'Fixture must expose all six cards');
  for (const card of cards) {
    assert(card.fullyVisible && card.sourceVisible, `${card.label}: both endpoints must be fully in frame`);
    assert(card.route.complete, `${card.label}: no independently traceable visible path (${card.routeState})`);
    assert(card.route.startError <= 1 && card.route.endError <= 1, `${card.label}: path endpoints do not meet actual text/card midpoints`);
    assert(card.route.jointError <= 1, `${card.label}: disconnected shared parts`);
    assert.deepEqual(card.route.collisions, [], `${card.label}: actual stroke crosses measured text or another card`);
  }
};

try {
  await save();
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')); assert(page, 'Isolated Obsidian is not running');
  await page.waitForFunction(() => typeof app !== 'undefined' && app.plugins?.plugins['margin-link']);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Refuse all real Vaults');
  assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
  assert(await page.evaluate(fixture => !!app.vault.getFileByPath(fixture), fixture), 'Missing isolated fixture');
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  report.host = await page.title(); report.plugin = JSON.parse(await readFile('manifest.json', 'utf8')).version;
  report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  page.on('pageerror', error => report.errors.push(String(error)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  await page.evaluate(() => {
    window.marginConnectorProbe = id => {
      const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([v]) => v.leaf.id === id);
      const host = view.contentEl, hostRect = host.getBoundingClientRect(), bridge = [...plugin.bridges].find(b => host.contains(b.cm.dom));
      const source = view.getMode() === 'source', scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;
      const content = source ? bridge.cm.contentDOM : scroller.querySelector('.markdown-preview-sizer');
      const raw = scroller.getBoundingClientRect(), viewport = new DOMRect(raw.left + scroller.clientLeft, raw.top + scroller.clientTop, scroller.clientWidth, scroller.clientHeight);
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), contains = (point, box, padding = 0) => point.x > box.left - padding && point.x < box.right + padding && point.y > box.top - padding && point.y < box.bottom + padding;
      const vec = (a, b) => { const length = dist(a, b); return length > 1e-5 ? { x: (b.x - a.x) / length, y: (b.y - a.y) / length } : { x: 0, y: 0 }; };
      const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y)));
      const inView = box => box.left >= viewport.left - 1 && box.right <= viewport.right + 1 && box.top >= viewport.top - 1 && box.bottom <= viewport.bottom + 1;
      const parse = value => { try { return JSON.parse(value ?? '[]'); } catch { return []; } };
      const glyphs = [], walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, el = node.parentElement; if (!node.textContent.trim() || el?.closest('.margin-link-overlay, .cm-gap, .cm-widgetBuffer')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > .5 && r.height > 0 && r.bottom > viewport.top && r.top < viewport.bottom) glyphs.push(r.toJSON());
      }
      const fragmentFor = card => {
        try {
          const range = document.createRange(), occurrence = card.anchor.occurrence;
          if (source) {
            const alias = occurrence.raw.indexOf('|'), from = occurrence.start + (alias >= 0 ? alias + 1 : 2), start = bridge.cm.domAtPos(from), end = bridge.cm.domAtPos(occurrence.end - 2);
            range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset); if (!range.toString().includes(occurrence.label)) return [];
          } else { const link = [...content.querySelectorAll('a.internal-link')].find(el => el.textContent === occurrence.label); if (!link) return []; range.selectNodeContents(link); }
          return [...range.getClientRects()].filter(r => r.width > .5 && r.height > 0).map(r => r.toJSON());
        } catch { return []; }
      };
      const paths = [...overlay.svg.querySelectorAll('path')].filter(el => el.dataset.logical !== 'true' && el.getAttribute('d')).map((el, index) => {
        const matrix = el.getScreenCTM(), length = el.getTotalLength(), css = getComputedStyle(el), step = .5;
        const samples = []; for (let at = 0; at < length; at += step) { const p = el.getPointAtLength(at).matrixTransform(matrix); samples.push({ x: p.x, y: p.y, at }); }
        const end = el.getPointAtLength(length).matrixTransform(matrix); samples.push({ x: end.x, y: end.y, at: length });
        let members = parse(el.dataset.members); if (!members.length) members = [...overlay.cards].filter(([, c]) => c.path === el).map(([key]) => key);
        return { id: el.dataset.segment || el.id || `legacy-${index}`, members, length, samples, d: el.getAttribute('d'), active: el.classList.contains('margin-link-active'), visible: css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) > .01 && Number.parseFloat(css.strokeWidth) > 0, opacity: Number(css.opacity), width: Number.parseFloat(css.strokeWidth) };
      });
      const byID = new Map(paths.map(p => [p.id, p]));
      const cards = [...overlay.cards].map(([key, card]) => {
        const rect = card.shell.getBoundingClientRect().toJSON(), fragments = fragmentFor(card), refs = parse(card.shell.dataset.routeSegments);
        const owned = paths.filter(p => p.members.includes(key));
        const parts = refs.length ? refs.map(ref => { const path = byID.get(typeof ref === 'string' ? ref : ref.id); return path && { ...path, samples: ref.reversed ? [...path.samples].reverse() : path.samples }; }) : owned;
        let jointError = 0;
        for (let i = 1; i < parts.length; i++) if (parts[i] && parts[i - 1]) jointError = Math.max(jointError, dist(parts[i - 1].samples.at(-1), parts[i].samples[0]));
        const points = parts.filter(Boolean).flatMap(p => p.samples), start = points[0], end = points.at(-1);
        const starts = fragments.flatMap(r => [{ x: (r.left + r.right) / 2, y: r.top, nx: 0, ny: -1 }, { x: (r.left + r.right) / 2, y: r.bottom, nx: 0, ny: 1 }]);
        const ends = [{ x: rect.left, y: rect.top + rect.height / 2, nx: 1, ny: 0 }, { x: rect.right, y: rect.top + rect.height / 2, nx: -1, ny: 0 }, { x: rect.left + rect.width / 2, y: rect.top, nx: 0, ny: 1 }, { x: rect.left + rect.width / 2, y: rect.bottom, nx: 0, ny: -1 }];
        const sourcePort = start && starts.sort((a, b) => dist(a, start) - dist(b, start))[0], targetPort = end && ends.sort((a, b) => dist(a, end) - dist(b, end))[0];
        const collisions = [], padding = plugin.preferences.lineWidth / 2 + .15;
        const otherCards = [...overlay.cards].filter(([id]) => id !== key).map(([, c]) => c.shell.getBoundingClientRect());
        let travelled = 0, previous;
        for (const p of points) {
          if (previous) travelled += dist(previous, p); previous = p;
          if (p.y < viewport.top || p.y > viewport.bottom) continue;
          if (travelled > padding + 1.5 && glyphs.some(box => contains(p, box, padding)) || otherCards.some(box => contains(p, box, padding))) { collisions.push({ x: p.x, y: p.y }); break; }
        }
        const directions = []; for (let i = 1; i < points.length; i++) if (dist(points[i - 1], points[i]) > .001) directions.push({ direction: vec(points[i - 1], points[i]), at: i });
        let maxTurn = 0, turningLength = 0, lastHardTurn = -1;
        for (let i = 1; i < directions.length; i++) { const turn = angle(directions[i - 1].direction, directions[i].direction); maxTurn = Math.max(maxTurn, turn); if (turn > .003) turningLength += .5; if (turn > .55) lastHardTurn = directions[i].at; }
        const totalLength = parts.filter(Boolean).reduce((sum, p) => sum + p.length, 0);
        let tail = totalLength; if (lastHardTurn >= 0) { tail = 0; for (let i = lastHardTurn + 1; i < points.length; i++) tail += dist(points[i - 1], points[i]); }
        const markers = [...overlay.root.querySelectorAll('[data-relation][data-end]')].filter(el => el.dataset.relation === key).map(el => ({ end: el.dataset.end, number: el.dataset.number, active: el.classList.contains('margin-link-active'), rect: el.getBoundingClientRect().toJSON(), safe: !glyphs.some(box => { const r = el.getBoundingClientRect(); return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top; }), visible: getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && Number(getComputedStyle(el).opacity) > .01 }));
        return { key, label: card.anchor.occurrence.label, side: card.placement.side, rect, routeState: card.shell.dataset.routeState, sourceVisible: !!fragments.length && fragments.every(inView), fullyVisible: inView(rect), referenceY: fragments.at(-1)?.bottom + 2, markers,
          route: { complete: !!points.length && parts.every(p => p?.visible) && jointError <= 1 && !!sourcePort && dist(start, sourcePort) <= 1 && dist(end, targetPort) <= 1, startError: sourcePort ? dist(start, sourcePort) : null, endError: targetPort ? dist(end, targetPort) : null, jointError, collisions, totalLength, tail, maxTurn, turningLength, startTangentError: sourcePort && directions.length ? angle(directions[0].direction, { x: sourcePort.nx, y: sourcePort.ny }) : null, endTangentError: targetPort && directions.length ? angle(directions.at(-1).direction, { x: targetPort.nx, y: targetPort.ny }) : null, shared: owned.some(p => p.members.length > 1), segmentIDs: parts.filter(Boolean).map(p => p.id) } };
      });
      const duplicates = [];
      for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) if (paths[i].d === paths[j].d && dist(paths[i].samples[0], paths[j].samples[0]) <= .1) duplicates.push([paths[i].id, paths[j].id]);
      return { scrollTop: scroller.scrollTop, viewport: viewport.toJSON(), host: hostRect.toJSON(), cards, paths: paths.map(({ samples, ...p }) => ({ ...p, from: samples[0], to: samples.at(-1) })), duplicatePaths: duplicates };
    };
  });
  await configure({ enabled: true, lines: 'always', placementMode: 'free', cardShape: 'square', cardSize: 'medium', reduceMotion: true });
  for (const [mode, source] of [['preview', false], ['source', false], ['source', true]]) for (const style of ['straight', 'elbow', 'curve']) for (const width of [2, 5]) await check(`${mode}/${source}/${style}/${width}: six independently visible complete relations`, async () => {
    await configure({ lineStyle: style, lineWidth: width }); const id = await open(mode, source); await arrange(id);
    const snapshot = await probe(id); report.observations.push({ scenario: 'six', mode, source, style, width, snapshot }); assertRoutes(snapshot);
    await page.screenshot({ path: `${output}/six-${mode}-${source}-${style}-${width}.png` });
  });
  if (through >= 11) await check('closed line gaps show numbered continuation pairs and recover after geometry returns', async () => {
    const id = await open('preview'); await arrange(id);
    await page.evaluate(id => { const [v] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id); const link = [...v.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'model-assisted'); const p = link.closest('p'); p.dataset.previousStyle = p.getAttribute('style') ?? ''; p.style.lineHeight = '6px'; }, id);
    try {
      await frames(6); const closed = await probe(id), continued = closed.cards.filter(c => c.routeState === 'continuation'); report.observations.push({ scenario: 'closed', snapshot: closed });
      assert(continued.length, 'Closed middle rows did not exercise continuation state');
      const numbers = [];
      for (const card of continued) {
        const pair = card.markers.filter(m => m.visible); assert.equal(pair.length, 2); assert.deepEqual(pair.map(m => m.end).sort(), ['source', 'target']); assert(pair[0].number && pair[0].number === pair[1].number); assert(pair.every(m => m.safe), 'Continuation covers readable text'); numbers.push(pair[0].number);
        await page.locator(`[data-relation="${card.key}"][data-end="source"]`).hover(); await frames();
        assert((await probe(id)).cards.find(c => c.key === card.key).markers.every(m => m.active), 'Source marker did not highlight both ends');
        await page.locator(`[data-relation="${card.key}"][data-end="target"]`).focus(); await frames();
        assert((await probe(id)).cards.find(c => c.key === card.key).markers.every(m => m.active), 'Target focus did not highlight both ends');
      }
      assert.equal(new Set(numbers).size, numbers.length, 'Different relations reused one continuation number');
    } finally {
      await page.evaluate(id => { const [v] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id); for (const p of v.contentEl.querySelectorAll('[data-previous-style]')) { p.setAttribute('style', p.dataset.previousStyle); delete p.dataset.previousStyle; } }, id);
    }
    await frames(6); assertRoutes(await probe(id));
  });
  if (through >= 12) await check('free corner drag, overlap, keyboard move, cancel and illegal release move only their target', async () => {
    await configure({ placementMode: 'free', lineStyle: 'elbow' }); const id = await open('source'); await arrange(id);
    let before = await probe(id), ship = before.cards.find(c => c.label === 'ship'); const dives = before.cards.find(c => c.label === 'dives'), verse = before.cards.find(c => c.label === 'Verse');
    const crossStart = { x: ship.rect.right - 6, y: ship.rect.top + 6 }, crossEnd = { x: verse.rect.right - 12, y: verse.rect.top + 12 };
    await page.mouse.move(crossStart.x, crossStart.y); await page.mouse.down();
    for (let step = 1; step <= 12; step++) { await page.mouse.move(crossStart.x + (crossEnd.x - crossStart.x) * step / 12, crossStart.y + (crossEnd.y - crossStart.y) * step / 12); await frames(1); const next = await probe(id); unchanged(before, next, ship.key); report.observations.push({ scenario: 'cross-side-frame', step, snapshot: next }); }
    await page.mouse.up(); await frames(1); const crossed = await probe(id); unchanged(before, crossed, ship.key); assert.equal(crossed.cards.find(c => c.key === ship.key).side, 'left'); before = crossed; ship = before.cards.find(c => c.label === 'ship');
    const saved = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
    const x = ship.rect.right - 6, y = ship.rect.top + 6, targetX = dives.rect.right - 12, targetY = dives.rect.top + 18;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let step = 1; step <= 16; step++) { await page.mouse.move(x + (targetX - x) * step / 16, y + (targetY - y) * step / 16); await frames(1); const next = await probe(id); unchanged(before, next, ship.key); report.observations.push({ scenario: 'drag-frame', step, snapshot: next }); }
    await page.mouse.up(); await frames(1); const placed = await probe(id); unchanged(before, placed, ship.key);
    const moved = placed.cards.find(c => c.key === ship.key), stillDives = placed.cards.find(c => c.key === dives.key);
    assert(moved.rect.left < stillDives.rect.right && moved.rect.right > stillDives.rect.left && moved.rect.top < stillDives.rect.bottom && moved.rect.bottom > stillDives.rect.top, 'Free drop refused intentional overlap');
    const after = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
    const changed = after.filter(record => JSON.stringify(saved.find(old => old.source === record.source && old.key === record.key)) !== JSON.stringify(record)); assert.equal(changed.length, 1, 'Drop wrote more than current record');
    const locator = page.locator('.margin-link-card-shell').filter({ has: page.locator('.margin-link-card-label', { hasText: /^ship$/ }) }).locator('button');
    await locator.focus(); await page.keyboard.press('ArrowDown'); await frames(); const keyed = await probe(id); unchanged(placed, keyed, ship.key);
    before = keyed; const current = before.cards.find(c => c.key === ship.key); await page.mouse.move(current.rect.right - 6, current.rect.top + 6); await page.mouse.down(); await page.mouse.move(current.rect.right - 20, current.rect.top + 45); await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
    const cancelled = await probe(id); for (const c of before.cards) { const now = cancelled.cards.find(x => x.key === c.key); assert(Math.abs(c.rect.x - now.rect.x) <= 1 && Math.abs(c.rect.y - now.rect.y) <= 1); }
    await page.mouse.move(current.rect.right - 6, current.rect.top + 6); await page.mouse.down(); await page.mouse.move((before.viewport.left + before.viewport.right) / 2, current.rect.top + 40); await page.mouse.up(); await frames(); unchanged(before, await probe(id));
    await page.evaluate(async id => { const leaf = app.workspace.getLeafById(id); await leaf.openFile(app.vault.getFileByPath('Note A.md')); }, id);
    await open('source'); const restored = await probe(id), restoredShip = restored.cards.find(c => c.label === 'ship');
    assert(Math.abs((restoredShip.rect.y + restoredShip.rect.height / 2 - restoredShip.referenceY) - (current.rect.y + current.rect.height / 2 - current.referenceY)) <= 1, 'Reopen changed saved target offset');
    await locator.focus(); await page.keyboard.press('Delete'); await frames(); unchanged(restored, await probe(id), ship.key);
  });
  if (through >= 13) for (const lineStyle of ['straight', 'elbow']) for (const lineWidth of [2, 5]) await check(`${lineStyle}/${lineWidth}: actual last turn has sufficient clean entry length`, async () => {
    await configure({ lineStyle, lineWidth }); const id = await open(); await arrange(id, true); const snapshot = await probe(id); assertRoutes(snapshot);
    for (const card of snapshot.cards) if (card.route.totalLength > 80) assert(card.route.tail >= Math.max(12, 3 * lineWidth) - 1, `${card.label}: last turn leaves ${card.route.tail}px tail`);
    report.observations.push({ scenario: 'tail', lineStyle, snapshot });
  });
  if (through >= 14) await check('smooth geometry has normal endpoint tangents and continuous visible turning', async () => {
    await configure({ lineStyle: 'curve', lineWidth: 2 }); const id = await open(); await arrange(id, true); const snapshot = await probe(id); assertRoutes(snapshot);
    for (const card of snapshot.cards) { assert(card.route.startTangentError < .12 && card.route.endTangentError < .12, `${card.label}: incorrect endpoint tangent`); assert(card.route.maxTurn < .4, `${card.label}: sharp internal turn`); }
    const dives = snapshot.cards.find(c => c.label === 'dives'); assert(dives.route.turningLength >= Math.min(30, dives.route.totalLength * .08), 'Only a tiny decorative curve was added');
    report.observations.push({ scenario: 'smooth', snapshot });
  });
  if (through >= 15) for (const lineStyle of ['straight', 'elbow', 'curve']) await check(`${lineStyle}: shared trunk drawn once with independent member traversal and highlight`, async () => {
    await configure({ lineStyle, lines: 'always' }); const id = await open(); await arrange(id, true); const snapshot = await probe(id); assertRoutes(snapshot);
    const ship = snapshot.cards.find(c => c.label === 'ship'), dives = snapshot.cards.find(c => c.label === 'dives');
    const shared = snapshot.paths.filter(p => p.members.includes(ship.key) && p.members.includes(dives.key));
    assert(shared.some(p => p.length >= 24 && Math.abs(p.from.x - p.to.x) <= 1), 'No measurable common vertical interval');
    assert.deepEqual(snapshot.duplicatePaths, [], 'Duplicate normal strokes overlap');
    const model = snapshot.cards.find(c => c.label === 'model-assisted'); assert(model.route.complete);
    await page.mouse.move(ship.rect.left + ship.rect.width / 2, ship.rect.top + ship.rect.height / 2); await frames();
    const hovered = await probe(id); for (const p of hovered.paths) assert.equal(p.active, p.members.includes(ship.key), 'Highlighted another relation branch');
    await configure({ lines: 'none' }); const hidden = await probe(id); assert(hidden.paths.every(p => !p.visible)); assert(hidden.cards.every(c => c.markers.every(m => !m.visible)));
    await configure({ lines: 'hover' }); await page.mouse.move(30, 30); await frames(); const idle = await probe(id); assert(idle.paths.every(p => !p.visible));
    await configure({ lines: 'always' }); await arrange(id); const separate = await probe(id); assert(separate.paths.every(p => new Set(p.members.map(key => separate.cards.find(c => c.key === key)?.side)).size <= 1), 'Shared opposite-side relations');
    report.observations.push({ scenario: 'shared', lineStyle, snapshot, hovered, hidden, separate });
    await page.screenshot({ path: `${output}/shared-${lineStyle}.png` });
  });
  if (through >= 15) await check('deleting one shared member removes its branches without orphan segments', async () => {
    await configure({ lineStyle: 'elbow', lines: 'always' }); const id = await open(); await arrange(id, true);
    const before = await probe(id), ship = before.cards.find(c => c.label === 'ship');
    const original = await page.evaluate(id => app.workspace.getLeafById(id).view.editor.getValue(), id);
    try {
      await page.evaluate(id => {
        const [view, overlay] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id), occurrence = [...overlay.cards.values()].find(c => c.anchor.occurrence.label === 'ship').anchor.occurrence;
        view.editor.replaceRange('ship', view.editor.offsetToPos(occurrence.start), view.editor.offsetToPos(occurrence.end));
      }, id);
      await frames(8); const after = await probe(id); assert.equal(after.cards.length, 5); assertRoutes(after, false); assert(after.paths.every(p => !p.members.includes(ship.key)), 'Deleted member remains in route membership'); assert(after.paths.every(p => p.members.length && p.members.every(k => after.cards.some(c => c.key === k))), 'Orphan or dangling segment'); report.observations.push({ scenario: 'delete-member', before, after });
    } finally { await page.evaluate(async ({ id, original }) => { const v = app.workspace.getLeafById(id).view; v.editor.setValue(original); await v.save(); }, { id, original }); await frames(8); }
  });
  await check('actual Electron zoom reflows note and rebuilds complete safe routes', async () => {
    const originalZoom = await page.evaluate(() => window.require('electron').webFrame.getZoomFactor());
    try {
      await page.evaluate(() => window.require('electron').webFrame.setZoomFactor(1.25)); await frames(8);
      await configure({ lines: 'always', lineStyle: 'elbow' }); const id = await open(); await arrange(id); const snapshot = await probe(id); assertRoutes(snapshot); report.observations.push({ scenario: 'zoom-125-percent', snapshot }); await page.screenshot({ path: `${output}/zoom-125.png` });
    } finally { await page.evaluate(factor => window.require('electron').webFrame.setZoomFactor(factor), originalZoom); await frames(8); }
  });
  if (through >= 12) await check('split panes and scrolling preserve independent card geometry', async () => {
    await configure({ lines: 'always', placementMode: 'free' }); const a = await open('source'); await arrange(a); const b = await open('preview', false, true); await arrange(b);
    const before = await probe(a), start = await probe(b), saved = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
    for (const delta of [10, 50, 100, 500, -500, -100, -50, -10]) { await page.evaluate(({ id, delta }) => { const [view] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id); view.previewMode.containerEl.scrollTop += delta; }, { id: b, delta }); await frames(1); unchanged(before, await probe(a)); const next = await probe(b); for (const card of next.cards) { const old = start.cards.find(c => c.key === card.key); if (old?.referenceY && card.referenceY) assert(Math.abs((card.rect.y + card.rect.height / 2 - card.referenceY) - (old.rect.y + old.rect.height / 2 - old.referenceY)) <= 1); } }
    assert.deepEqual(await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot()), saved, 'Pure scroll rewrote records');
    await page.evaluate(id => app.workspace.getLeafById(id).detach(), b);
  });
  assert.deepEqual(report.errors, []); report.status = report.scenarios.every(s => s.passed) ? 'passed' : 'baseline-failures';
} catch (error) { report.status = page ? 'failed' : 'blocked'; report.error = String(error); report.stack = error.stack; process.exitCode = 1; }
finally {
  if (page && layouts) await page.evaluate(async records => { const p = app.plugins.plugins['margin-link']; p.layouts.records = records; p.refresh(); await p.flush(); }, layouts).catch(error => { report.restoreLayoutsError = String(error); });
  if (page && preferences) await configure(preferences).catch(error => { report.restorePreferencesError = String(error); });
  await browser?.close(); await save(); console.log(`${report.status}: ${output}/results.json (${report.scenariosPassed} desktop scenarios passed)`);
}
