/* global app */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

// Run against a prepared Vault under test-vault/.v03-desktop with MarginLink installed.
// --fixture is Vault-relative. --bundle optionally installs a comparison build.
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option('phase') ?? 'baseline';
const fixture = option('fixture');
const heading = option('heading');
const bundle = option('bundle');
const mode = option('mode') ?? 'live';
const sidebar = option('sidebar') ?? 'settings';
const timingOnly = process.argv.includes('--timing-only');
const geometryOnly = process.argv.includes('--geometry-only');
const thresholdTiming = process.argv.includes('--threshold-timing');
const verifyRoutes = process.argv.includes('--verify-routes');
const verifyReattach = process.argv.includes('--verify-reattach');
const verifyReuse = process.argv.includes('--verify-reuse');
const pin = process.argv.includes('--pin');
const port = Number(option('port') ?? 9238);
const runs = Number(option('runs') ?? 3);
assert(fixture && !path.isAbsolute(fixture), 'Pass a Vault-relative --fixture');
assert(/^[\w-]+$/.test(phase) && Number.isInteger(runs) && runs > 0 && runs <= 10);
assert(['live', 'source', 'reading'].includes(mode) && ['settings', 'native'].includes(sidebar));
assert(!(timingOnly && geometryOnly));
assert(Number.isInteger(port) && port > 0 && port <= 65535);
assert(!pin || (geometryOnly && verifyRoutes));
assert(!verifyReattach || mode === 'reading');
assert(!verifyReuse || (geometryOnly && mode === 'reading'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const under = (directory, target) => {
  const relative = path.relative(directory, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const summarize = values => {
  const ordered = values.toSorted((a, b) => a - b);
  const percentile = fraction => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))] ?? null;
  return { n: ordered.length, p50: percentile(.5), p95: percentile(.95), max: ordered.at(-1) ?? null,
    over20: ordered.filter(value => value > 20).length, over50: ordered.filter(value => value > 50).length };
};
const makeTrajectory = (minimum, steps) => Array.from({ length: steps * 2 }, (_, index) =>
  Math.round(minimum * (index < steps ? (index + 1) / steps : (steps * 2 - index - 1) / steps)));
const timingOffsets = makeTrajectory(-166, 36);
const thresholdOffsets = makeTrajectory(-435, 32);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 12000 });
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('app://obsidian.md/'));
assert(page, 'No isolated Obsidian page');
page.setDefaultTimeout(25000);
const report = { phase, mode, sidebar, thresholdTiming, control: sidebar === 'native' ? 'plugin unloaded' : 'display off with plugin loaded', results: [], errors: [], runtime: [] };
const output = path.resolve('artifacts/divider-performance');
let pluginReady = false;
let preferences;
let layouts;
let ownerId;

const frames = count => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve();
  requestAnimationFrame(next);
}), count);
const handle = side => page.locator(`.workspace-split.mod-${side}-split > .workspace-leaf-resize-handle:visible, .workspace-split.mod-${side}-split > .workspace-resize-handle:visible`).first();
const handleCenter = async side => {
  const separator = handle(side);
  const box = await separator.boundingBox();
  assert(box?.height > 100, `No usable ${side} divider`);
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + Math.min(350, box.height / 2)) };
  assert(await separator.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), point),
    `The native ${side} divider is covered at the gesture start`);
  return point;
};
const drag = async (side, offsets, period, probe = false) => {
  const start = await handleCenter(side);
  await page.mouse.move(start.x, start.y);
  if (probe) await page.evaluate(() => window.marginDividerProbe.mark(true));
  await page.mouse.down();
  try {
    const began = performance.now();
    for (const [index, offset] of offsets.entries()) {
      await delay(Math.max(0, began + index * period - performance.now()));
      await page.mouse.move(start.x + offset, start.y);
    }
  } finally {
    await page.mouse.up();
    if (probe) await page.evaluate(() => window.marginDividerProbe.mark(false));
  }
};
const setDivider = async (side, x) => {
  const at = await handleCenter(side);
  if (Math.abs(x - at.x) > 2) await drag(side, [x - at.x], 16);
};
const setEnabled = enabled => page.evaluate(enabled => {
  const plugin = app.plugins.plugins['margin-link'];
  plugin.preferences.enabled = enabled;
  plugin.refresh();
}, enabled);
const setNativeControl = active => page.evaluate(async active => {
  if (active) await app.plugins.disablePluginAndSave('margin-link');
  else await app.plugins.enablePluginAndSave('margin-link');
}, active);
const installProbe = (geometry, reuse) => page.evaluate(({ geometry, ownerId, verifyRoutes, reuse }) => {
  const plugin = app.plugins.plugins['margin-link'];
  const view = app.workspace.getLeafById(ownerId).view;
  const overlay = plugin?.overlays.get(view);
  const host = view.contentEl;
  const editing = view.getMode() === 'source';
  const diagnostics = { renders: 0, measurements: 0, routes: 0, routeSearches: 0, svgWrites: 0, markerWrites: 0, groupRecomputes: 0, work: [] };
  if (overlay) overlay.diagnostics = diagnostics;
  const originalButtons = reuse ? new Map([...overlay.cards].map(([key, card]) => [key, card.button])) : undefined;
  const collapsed = new Set();
  const frameTimes = [], widths = [], longTasks = [], renderSpans = [], samples = [], restorers = [];
  let started = 0, ended = 0, lastWidth, frame = 0, saves = 0, widthChanges = 0;
  const state = window.marginDividerProbe = { stop, ownerId, mark: down => {
    if (down) started = performance.now();
    else ended = performance.now();
  } };
  const modelBefore = JSON.stringify(plugin?.layouts.snapshot());
  const sourceBefore = view.getMode() === 'source' ? view.editor.getValue() : view.data;
  if (plugin) {
    const oldSave = plugin.saveData;
    plugin.saveData = function (...args) { saves++; return oldSave.apply(this, args); };
    restorers.push(() => { plugin.saveData = oldSave; });
  }
  if (overlay) {
    const render = overlay.render;
    overlay.render = function (...args) {
      const start = performance.now();
      try { return render.apply(this, args); }
      finally { renderSpans.push([start, performance.now() - start]); }
    };
    restorers.push(() => { overlay.render = render; });
  }
  const resize = new ResizeObserver(([entry]) => {
    const width = entry.contentRect.width;
    if (lastWidth !== undefined && width !== lastWidth && started) {
      widthChanges++;
      widths.push([performance.now(), width]);
    }
    lastWidth = width;
  });
  resize.observe(host);
  restorers.push(() => resize.disconnect());
  const tasks = new PerformanceObserver(records => longTasks.push(...records.getEntries().map(entry => [entry.startTime, entry.duration])));
  tasks.observe({ entryTypes: ['longtask'] });
  restorers.push(() => tasks.disconnect());

  const checkGeometry = time => {
    if (window.marginDividerProbe !== state || !started) return;
    if (originalButtons) for (const [key, button] of originalButtons) if (!button.isConnected && !overlay.cards.has(key)) collapsed.add(key);
    const body = host.querySelector(editing ? '.cm-content' : '.markdown-preview-sizer');
    const scroller = host.querySelector(editing ? '.cm-scroller' : '.markdown-preview-view');
    if (!body || !scroller) {
      samples.push({ time, width: host.clientWidth, hidden: overlay.root.hidden, outside: 0, overlaps: 0, cards: [], routeErrors: [],
        empty: { nativeBodyMissing: !body, nativeScrollerMissing: !scroller } });
      return;
    }
    const rect = host.getBoundingClientRect(), content = body.getBoundingClientRect(), scroll = scroller.getBoundingClientRect();
    const css = getComputedStyle(body);
    const bodyLeft = content.left + parseFloat(css.paddingLeft), bodyRight = content.right - parseFloat(css.paddingRight);
    const cards = [...overlay.cards].flatMap(([key, card]) => {
      const r = card.button.getBoundingClientRect();
      return r.width && r.height && r.bottom > scroll.top + 1 && r.top < scroll.bottom - 1
        ? [{ key, side: card.placement.side, shape: card.shell.dataset.shape, left: r.left, right: r.right, top: r.top, bottom: r.bottom }]
        : [];
    });
    let overlaps = 0, outside = 0;
    for (const [index, card] of cards.entries()) {
      if (card.left < rect.left - 1 || card.right > rect.right + 1 ||
          (card.right > bodyLeft + 1 && card.left < bodyRight - 1)) outside++;
      for (const previous of cards.slice(0, index)) {
        if (Math.min(card.right, previous.right) - Math.max(card.left, previous.left) > 1 &&
            Math.min(card.bottom, previous.bottom) - Math.max(card.top, previous.top) > 1) overlaps++;
      }
    }
    const routeErrors = verifyRoutes ? cards.flatMap(card => {
      const binding = overlay.cards.get(card.key);
      const segments = JSON.parse(binding.shell.dataset.routeSegments ?? '[]');
      const last = segments.at(-1);
      const path = last && [...overlay.svg.querySelectorAll('path[data-segment]')].find(path => path.dataset.segment === last.id);
      const matrix = path?.getScreenCTM();
      if (!matrix || !path.getAttribute('d') || getComputedStyle(path).opacity === '0') return [];
      const point = path.getPointAtLength(last.reversed ? 0 : path.getTotalLength()).matrixTransform(matrix);
      const centerX = (card.left + card.right) / 2, centerY = (card.top + card.bottom) / 2;
      return [Math.min(...[[centerX, card.top], [centerX, card.bottom], [card.left, centerY], [card.right, centerY]]
        .map(([x, y]) => Math.hypot(x - point.x, y - point.y)))];
    }) : [];
    const empty = !cards.length && !editing ? {
      slots: overlay.cards.size, anchors: overlay.anchors.length, scrolled: scroller.scrollTop,
      nativeLinks: [...body.querySelectorAll('a.internal-link')].filter(element => {
        const r = element.getBoundingClientRect();
        return r.width && r.bottom > scroll.top + 1 && r.top < scroll.bottom - 1;
      }).length,
      height: content.height, decorationsAttached: overlay.decorations.element.isConnected
    } : undefined;
    samples.push({ time, width: rect.width, left: bodyLeft - rect.left, right: rect.right - bodyRight,
      hidden: overlay.root.hidden || overlay.decorations.element.hidden, outside, overlaps,
      cards: cards.map(card => [card.key, card.side, card.shape]), routeErrors, empty });
  };
  const tick = time => {
    if (started) frameTimes.push(time);
    if (geometry) setTimeout(() => checkGeometry(time), 0);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  function stop() {
    cancelAnimationFrame(frame);
    for (const restore of restorers) restore();
    if (overlay?.diagnostics === diagnostics) overlay.diagnostics = undefined;
    delete window.marginDividerProbe;
    const restored = originalButtons && [...collapsed].flatMap(key => {
      const button = overlay.cards.get(key)?.button;
      return button ? [button === originalButtons.get(key)] : [];
    });
    return { frameTimes, widths, widthChanges, started, ended, longTasks, renderSpans, samples, diagnostics, saves,
      reuse: restored && { collapsed: collapsed.size, restored: restored.length, reused: restored.filter(Boolean).length },
      layoutUnchanged: modelBefore === JSON.stringify(plugin?.layouts.snapshot()),
      sourceUnchanged: sourceBefore === (view.getMode() === 'source' ? view.editor.getValue() : view.data) };
  }
}, { ownerId, geometry, verifyRoutes, reuse });

try {
  const isolated = await realpath(path.resolve('test-vault/.v03-desktop'));
  await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace.layoutReady);
  const vault = await realpath(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert(under(isolated, vault), 'This runner only works on an isolated project test Vault');
  const source = await realpath(path.resolve(vault, fixture));
  const pluginDir = await realpath(path.join(vault, '.obsidian/plugins/margin-link'));
  assert(under(vault, source) && under(vault, pluginDir));
  report.fixtureSHA256 = digest(await readFile(source));
  await mkdir(output, { recursive: true });
  page.on('pageerror', error => report.errors.push(String(error)));
  await page.route(/^https?:\/\//, route => route.abort());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', event => report.runtime.push(event.exceptionDetails.text));

  const trust = page.locator('.modal').getByRole('button', { name: /trust|信任/i });
  if (await trust.isVisible()) await trust.click();
  await page.waitForFunction(() => !!app.plugins.plugins['margin-link']?.layouts);
  pluginReady = true;
  // The trust dialog can leave native settings open in either app window.
  await page.evaluate(() => app.setting?.close());
  await page.bringToFront();
  await page.keyboard.press('Escape');
  if (bundle) {
    const bundleDir = await realpath(path.resolve(bundle));
    await page.evaluate(() => app.plugins.disablePluginAndSave('margin-link'));
    try {
      for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(path.join(bundleDir, file), path.join(pluginDir, file));
    } finally { await page.evaluate(() => app.plugins.enablePluginAndSave('margin-link')); }
    await page.waitForFunction(() => !!app.plugins.plugins['margin-link']?.layouts);
  }
  report.bundleSHA256 = digest(await readFile(path.join(pluginDir, 'main.js')));
  report.host = await page.evaluate(() => ({ title: document.title.split(' - ').at(-1), chrome: process.versions.chrome, electron: process.versions.electron, dpr: devicePixelRatio }));
  ({ preferences, layouts } = await page.evaluate(() => {
    const plugin = app.plugins.plugins['margin-link'];
    return { preferences: { ...plugin.preferences }, layouts: plugin.layouts.snapshot() };
  }));
  report.preferences = Object.fromEntries(['placementMode', 'mergeReferences', 'lines', 'lineStyle', 'cardShape', 'edgePadding'].map(key => [key, preferences[key]]));
  if (verifyRoutes) {
    const linePrefs = { lines: pin ? 'hover' : 'always', mergeReferences: false, lineStyle: pin ? 'curve' : 'straight', cardShape: 'square' };
    await page.evaluate(linePrefs => {
      const plugin = app.plugins.plugins['margin-link'];
      Object.assign(plugin.preferences, linePrefs);
      plugin.refresh();
    }, linePrefs);
    Object.assign(report.preferences, linePrefs);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1020, deviceScaleFactor: 1, mobile: false });
  ownerId = await page.evaluate(async ({ fixture, mode }) => {
    const leaf = app.workspace.getLeavesOfType('markdown')[0] ?? app.workspace.getLeaf(false);
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: mode === 'reading' ? 'preview' : 'source', source: mode === 'source' } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    app.workspace.leftSplit.collapse();
    return leaf.id;
  }, { fixture, mode });
  await page.evaluate(async sidebar => {
    if (sidebar === 'settings') await app.plugins.plugins['margin-link'].openSettingsPanel();
    else {
      const leaf = app.workspace.getLeavesOfType('backlink')[0] ?? app.workspace.getRightLeaf(false);
      if (leaf.view.getViewType() !== 'backlink') await leaf.setViewState({ type: 'backlink' });
      app.workspace.revealLeaf(leaf);
    }
    await document.fonts.ready;
  }, sidebar);
  await handle('right').waitFor({ state: 'visible' });
  await frames(8);
  await setDivider('right', 1165);
  await page.evaluate(({ ownerId, heading, mode }) => {
    const view = app.workspace.getLeafById(ownerId).view;
    if (mode === 'reading') {
      const node = [...view.contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6')].find(el => heading && el.textContent.includes(heading));
      const scroll = view.contentEl.querySelector('.markdown-preview-view');
      if (node) node.scrollIntoView({ block: 'center' });
      else scroll.scrollTop = scroll.scrollHeight / 2;
      return;
    }
    const editor = view.editor, text = editor.getValue();
    const headings = text.matchAll(/^#{1,6}\s+(.+)$/gm);
    const rendered = value => value.replace(/\[\[([^\]]+)\]\]/g, (_, link) => link.split('|').at(-1)).toLowerCase();
    const offset = heading ? [...headings].find(match => rendered(match[1]).includes(heading.toLowerCase()))?.index : undefined;
    if (heading && offset === undefined) throw new Error('Expected heading not found in the fixture');
    const position = editor.offsetToPos(offset ?? Math.floor(text.length / 2));
    editor.setCursor(position);
    editor.scrollIntoView({ from: position, to: position }, true);
  }, { ownerId, heading, mode });
  await frames(12);
  await delay(400);
  report.initial = await page.evaluate(ownerId => {
    const plugin = app.plugins.plugins['margin-link'];
    const view = app.workspace.getLeafById(ownerId).view, overlay = plugin.overlays.get(view);
    const viewMode = view.getMode(), editing = viewMode === 'source';
    const scroll = view.contentEl.querySelector(editing ? '.cm-scroller' : '.markdown-preview-view');
    return { view: viewMode, live: editing && !!view.contentEl.querySelector('.is-live-preview'), width: view.contentEl.clientWidth,
      cards: overlay?.cards.size ?? 0, relations: overlay?.visibleRelations?.size ?? 0, scroll: scroll?.scrollTop,
      fonts: getComputedStyle(view.contentEl.querySelector(editing ? '.cm-content' : '.markdown-preview-sizer')).fontFamily };
  }, ownerId);
  assert(report.initial.cards > 0, 'Fixture did not render MarginLink cards');
  assert.equal(report.initial.view, mode === 'reading' ? 'preview' : 'source');
  assert.equal(report.initial.live, mode === 'live');
  if (verifyReattach) {
    report.reattach = await page.evaluate(ownerId => new Promise(resolve => {
      const plugin = app.plugins.plugins['margin-link'];
      const view = app.workspace.getLeafById(ownerId).view;
      const overlay = plugin.overlays.get(view);
      const layer = overlay.decorations.element, parent = layer.parentElement;
      const cards = [...overlay.cards].map(([key, card]) => [key, card.button]);
      requestAnimationFrame(() => {
        layer.remove();
        const detached = !layer.isConnected;
        queueMicrotask(() => resolve({
          detached, reattachedBeforeNextFrame: layer.parentElement === parent && layer.isConnected,
          cards: cards.length, sameCards: cards.every(([key, button]) => overlay.cards.get(key)?.button === button && button.isConnected)
        }));
      });
    }), ownerId);
    assert(report.reattach.detached && report.reattach.reattachedBeforeNextFrame && report.reattach.sameCards && report.reattach.cards > 0);
  }
  if (pin) {
    await page.evaluate(ownerId => {
      const p = app.plugins.plugins['margin-link'];
      const view = app.workspace.getLeafById(ownerId).view;
      const card = [...p.overlays.get(view).cards.values()].find(item => {
        const rect = item.button.getBoundingClientRect();
        return rect.width > 0 && rect.top > 100 && rect.bottom < innerHeight - 100;
      });
      if (!card) throw new Error('No visible card to pin');
      card.button.focus({ preventScroll: true });
    }, ownerId);
    await page.keyboard.press('p');
    await page.waitForFunction(ownerId => !!app.plugins.plugins['margin-link'].overlays.get(app.workspace.getLeafById(ownerId).view).pinned, ownerId);
    await frames(6);
  }

  const measure = async ({ name, side = 'right', offsets, period, geometry = false, reuse = false }) => {
    await installProbe(geometry, reuse);
    let data;
    try {
      await frames(4);
      await drag(side, offsets, period, true);
      await delay(380);
      await frames(4);
    } finally { data = await page.evaluate(() => window.marginDividerProbe.stop()); }
    const times = data.frameTimes.filter(time => time >= data.started && time <= data.ended);
    const intervals = times.slice(1).map((time, index) => time - times[index]);
    const widths = data.widths.map(([, width]) => width);
    const timing = summarize(intervals);
    const releasePhase = spans => summarize(spans.filter(([start, duration]) =>
      start < data.ended + 380 && start + duration > data.ended).map(([, duration]) => duration));
    const cardCount = data.samples.map(sample => sample.cards.length);
    const narrowest = data.samples.reduce((narrow, sample) => !narrow || sample.width < narrow.width ? sample : narrow, undefined);
    const firstCardKeys = data.samples[0]?.cards.map(([key]) => key).sort().join();
    const shapeSequence = verifyRoutes && report.initial.cards === 1
      ? data.samples.map(sample => sample.cards[0]?.[2] ?? 'hidden').filter((shape, index, sequence) => index === 0 || shape !== sequence[index - 1])
      : undefined;
    const trial = { name, widthRange: [Math.min(...widths), Math.max(...widths)], widthChanges: data.widthChanges,
      elapsed: data.ended - data.started, sentMoves: offsets.length, frames: timing,
      releaseGap: data.frameTimes.find(time => time > data.ended) - data.ended,
      renders: summarize(data.diagnostics.work), counts: { ...data.diagnostics, work: undefined },
      longTasks: summarize(data.longTasks.filter(([time, duration]) => time <= data.ended && time + duration >= data.started).map(([, duration]) => duration)),
      release: { renders: releasePhase(data.renderSpans), longTasks: releasePhase(data.longTasks) },
      saves: data.saves, layoutUnchanged: data.layoutUnchanged, sourceUnchanged: data.sourceUnchanged, reuse: data.reuse,
      geometry: geometry ? { samples: data.samples.length, minVisible: Math.min(...cardCount), maxVisible: Math.max(...cardCount),
        sameVisibleCards: data.samples.every(sample => sample.cards.map(([key]) => key).sort().join() === firstCardKeys),
        narrowest: narrowest && { width: narrowest.width, leftSpace: narrowest.left, rightSpace: narrowest.right, visibleCards: narrowest.cards.length },
        hidden: data.samples.filter(sample => sample.hidden).length,
        outside: data.samples.reduce((n, sample) => n + sample.outside, 0),
        overlaps: data.samples.reduce((n, sample) => n + sample.overlaps, 0),
        shapeSequence,
        emptyWithVisibleNativeLinks: data.samples.filter(sample => sample.empty?.nativeLinks).length,
        emptyAtUsableWidth: data.samples.filter(sample => !sample.cards.length && sample.left > 60 && sample.right > 60)
          .map(sample => ({ width: sample.width, ...sample.empty })),
        routeErrors: summarize(data.samples.flatMap(sample => sample.routeErrors)) } : undefined };
    report.results.push(trial);
    await writeFile(path.join(output, `${phase}-${name}.json`), JSON.stringify(data, null, 2));
    console.log(JSON.stringify(trial));
    assert(data.ended > data.started && widths.length > 5 && trial.widthRange[1] - trial.widthRange[0] > 40, 'Gesture did not sufficiently resize the note');
    assert.equal(trial.saves, 0, 'Divider gesture wrote plugin data');
    assert(trial.layoutUnchanged && trial.sourceUnchanged, 'Divider gesture changed source or saved layout');
    return trial;
  };
  if (!geometryOnly) {
    for (let run = 1; run <= runs; run++) {
      for (const enabled of (run % 2 ? [true, false] : [false, true])) {
        if (sidebar === 'settings') await setEnabled(enabled);
        else if (enabled !== await page.evaluate(() => !!app.plugins.plugins['margin-link'])) await setNativeControl(!enabled);
        await setDivider('right', 1165);
        await frames(8);
        await delay(220);
        await measure({ name: `timing-${enabled ? 'enabled' : 'off'}-${run}`,
          offsets: thresholdTiming ? thresholdOffsets : timingOffsets, period: thresholdTiming ? 23 : 16 });
      }
    }
  }
  if (!timingOnly) {
    if (!await page.evaluate(() => !!app.plugins.plugins['margin-link'])) await setNativeControl(false);
    await setEnabled(true);
    await setDivider('right', 1165);
    await frames(8);
    const normal = await measure({ name: 'geometry-roomy', offsets: timingOffsets, period: 23, geometry: true });
    const threshold = await measure({ name: 'geometry-threshold', offsets: thresholdOffsets, period: 23, geometry: true, reuse: verifyReuse });
    for (const trial of [normal, threshold]) {
      assert(trial.geometry.samples > 10);
      assert.equal(trial.geometry.hidden, 0, 'Whole layer disappeared');
      if (phase !== 'baseline') {
        assert.equal(trial.geometry.outside, 0, 'A visible card covered the body or crossed the host');
        assert.equal(trial.geometry.overlaps, 0, 'Visible cards overlapped');
      }
      if (verifyRoutes) {
        assert(trial.geometry.routeErrors.n > 10, 'Visible SVG route was not exercised');
        assert(trial.geometry.routeErrors.max <= 1, 'Visible SVG route missed its current card endpoint');
      }
    }
    assert(normal.geometry.minVisible > 0, 'Roomy gesture lost all cards');
    assert(threshold.geometry.narrowest.visibleCards < threshold.geometry.maxVisible, 'Threshold sweep did not reduce visible cards');
    if (verifyReuse) assert(threshold.reuse.reused > 0 && threshold.reuse.reused === threshold.reuse.restored,
      'A restored card was replaced during the same divider gesture');
    if (threshold.geometry.shapeSequence) {
      assert.deepEqual(threshold.geometry.shapeSequence, ['square', 'icon', 'hidden', 'icon', 'square']);
    }
  }
  report.fixtureUnchanged = report.fixtureSHA256 === digest(await readFile(source));
  assert(report.fixtureUnchanged);
  assert.deepEqual(report.errors, [], 'Unexpected page errors');
  assert.deepEqual(report.runtime, [], 'Unexpected renderer exceptions');
} finally {
  if (pluginReady) await page.evaluate(async ({ preferences, layouts }) => {
    window.marginDividerProbe?.stop();
    if (!app.plugins.plugins['margin-link']) await app.plugins.enablePluginAndSave('margin-link');
    const plugin = app.plugins.plugins['margin-link'];
    if (preferences) Object.assign(plugin.preferences, preferences);
    if (layouts) plugin.layouts.records = layouts;
    plugin.refresh();
    await plugin.flush();
  }, { preferences, layouts }).catch(error => { report.restoreError = String(error); });
  await writeFile(path.join(output, `${phase}-summary.json`), JSON.stringify(report, null, 2));
  await browser.close();
}
