/* global app */
// Native wheel performance and independent frame geometry, restricted to the
// repository test Vault. Formal files are read only to prepare selected copies.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv.find(value => value.startsWith('--phase='))?.slice(8) ?? 'baseline';
assert(/^[\w-]+$/.test(phase));
const output = `artifacts/scroll-performance/${phase}`;
const sourceVault = 'E:/Obsidian仓库/AnyTime';
const fixture = '详细分析/The road to Unreal Engine 6. Read about our plans and timeline.md';
const vault = path.resolve('test-vault');
const digest = data => createHash('sha256').update(data).digest('hex');
const within = (root, relative) => {
  const target = path.resolve(root, relative), rel = path.relative(path.resolve(root), target);
  assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel)); return target;
};
const sourceBytes = await readFile(within(sourceVault, fixture));
const sourceHash = digest(sourceBytes);
await mkdir(output, { recursive: true });

if (process.argv.includes('--prepare')) {
  const backup = 'artifacts/scroll-performance/config-before'; await mkdir(backup, { recursive: true });
  const configs = ['app.json', 'appearance.json', 'community-plugins.json', 'core-plugins.json', 'workspace.json', 'plugins/margin-link/data.json'];
  const receipts = [];
  for (const relative of configs) {
    const source = within(vault, `.obsidian/${relative}`), destination = `${backup}/${relative.replaceAll('/', '__')}`;
    try { await copyFile(source, destination, 1); receipts.push({ relative, sha256: digest(await readFile(source)) }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const targets = [...new Set([...sourceBytes.toString('utf8').matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map(match => match[1]))];
  const copied = [];
  for (const target of [fixture, ...targets]) {
    let relative = target, from = within(sourceVault, relative);
    try { await stat(from); } catch {
      relative = `详细分析/Vocabulary/${target}`; from = within(sourceVault, relative);
    }
    assert((await stat(from)).isFile());
    const to = within(vault, relative); await mkdir(path.dirname(to), { recursive: true });
    // Never overwrite an unrelated existing fixture.
    try { await copyFile(from, to, 1); } catch (error) {
      if (error.code !== 'EEXIST' || digest(await readFile(to)) !== digest(await readFile(from))) throw error;
    }
    copied.push({ relative, sha256: digest(await readFile(from)) });
  }
  const data = JSON.parse(await readFile(within(sourceVault, '.obsidian/plugins/margin-link/data.json'), 'utf8'));
  const selected = { schemaVersion: data.schemaVersion, preferences: data.preferences, layouts: data.layouts.filter(record => record.source === fixture) };
  await writeFile(within(vault, '.obsidian/plugins/margin-link/data.json'), JSON.stringify(selected, null, 2));
  await copyFile(within(sourceVault, '.obsidian/appearance.json'), within(vault, '.obsidian/appearance.json'));
  for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(`dist/margin-link/${file}`, within(vault, `.obsidian/plugins/margin-link/${file}`));
  await writeFile('artifacts/scroll-performance/fixture-receipt.json', JSON.stringify({ formalHash: sourceHash, copied, configs: receipts, preferences: selected.preferences }, null, 2));
  assert.equal(digest(await readFile(within(sourceVault, fixture))), sourceHash);
  console.log(`Prepared ${copied.length} selected files; formal note read-only SHA256 ${sourceHash}`);
  process.exit(0);
}

const verify = process.argv.includes('--verify');
const report = { phase, status: 'running', sourceHash, verificationRequested: verify, scenarios: [], errors: [] };
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
let browser, page, preferences, layouts;
const frames = count => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), count);
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, total: values.reduce((a, b) => a + b, 0), p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
    p95: sorted[Math.floor(sorted.length * .95)] ?? 0, max: sorted.at(-1) ?? 0, over20: values.filter(v => v > 20).length, over50: values.filter(v => v > 50).length };
};
const probeSource = await readFile('scripts/desktop-connectors-manual.mjs', 'utf8');
const nativeBody = /window\.marginConnectorProbe = id => \{([\s\S]*?)\n {4}\};/.exec(probeSource); assert(nativeBody);
const nativeProbe = `window.marginConnectorProbe = id => {${nativeBody[1]}\n};`
  .replaceAll("overlay.root.querySelectorAll('[data-relation][data-end]')", "overlay.decorations.canvas.querySelectorAll('[data-relation][data-end]')")
  .replaceAll('scroller = source ? bridge.cm.scrollDOM : view.previewMode.containerEl;', "scroller = source ? bridge.cm.scrollDOM : (view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl);")
  .replaceAll('.margin-link-overlay, .cm-gap', '.margin-link-overlay, .margin-link-decoration-layer, .cm-gap')
  .replaceAll('Number.parseFloat(css.strokeWidth)', "CSSNumericValue.parse(css.strokeWidth).to('px').value")
  .replaceAll('const collisions = [], padding = plugin.preferences.lineWidth / 2 + .15;', 'const collisions = [], padding = Math.max(plugin.preferences.lineWidth, ...parts.filter(Boolean).map(p => p.width)) / 2 + .15;');
try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9225', { timeout: 12000 });
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('app://obsidian.md/'));
  assert(page); page.setDefaultTimeout(20000);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.plugins?.plugins['margin-link']?.layouts && app.workspace.layoutReady);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), vault.toLowerCase());
  await page.route(/^https?:\/\//, route => route.abort());
  page.on('pageerror', error => report.errors.push({ message: String(error), stack: error.stack }));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  report.preferences = preferences;
  report.manifest = JSON.parse(await readFile(within(vault, '.obsidian/plugins/margin-link/manifest.json'), 'utf8'));
  report.bundleSHA256 = digest(await readFile(within(vault, '.obsidian/plugins/margin-link/main.js')));
  report.fixtureSHA256 = digest(await readFile(within(vault, fixture)));
  report.runtime = await page.evaluate(() => ({ title: document.title, plugin: app.plugins.plugins['margin-link'].manifest.version, chrome: process.versions.chrome, electron: process.versions.electron }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1614, height: 838, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  const cases = ['preview', 'source'].flatMap(mode => [
    ...['straight', 'elbow', 'curve'].map(style => ({ mode, style, lines: 'always', hovered: false })),
    { mode, style: 'curve', lines: 'hover', hovered: false }, { mode, style: 'curve', lines: 'hover', hovered: true }
  ]);
  const only = process.argv.find(value => value.startsWith('--only='))?.slice(7);
  for (const { mode, style, lines, hovered } of cases.filter(c => !only || `${c.mode}/${c.style}/${c.lines}/${c.hovered}`.includes(only))) {
    const name = `${mode}-${style}-${lines}-${hovered ? 'hovered' : 'rest'}`;
    const scenario = { mode, style, lines, hovered, passed: false }; report.scenarios.push(scenario);
    try {
      if (process.argv.includes('--cold')) {
        await page.reload();
        await page.waitForFunction(() => typeof app !== 'undefined' && app.plugins?.plugins['margin-link']?.layouts && app.workspace.layoutReady);
      }
      await page.evaluate(nativeProbe);
      const id = await page.evaluate(async ({ fixture, mode, style, lines, preferences, layouts }) => {
        const p = app.plugins.plugins['margin-link'];
        Object.assign(p.preferences, preferences, { enabled: true, lines, lineStyle: style }); p.layouts.records = layouts;
        await p.savePreferences();
        const leaves = app.workspace.getLeavesOfType('markdown'), leaf = leaves[0] ?? app.workspace.getLeaf(true);
        for (const other of leaves.slice(1)) other.detach();
        await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source: false } });
        app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
      }, { fixture, mode, style, lines, preferences, layouts }); await frames(15);
      await page.evaluate(async id => {
        const [v] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
        if (v.getMode() === 'source') {
          const at = v.editor.getValue().lastIndexOf('Scene Graph'), pos = v.editor.offsetToPos(at); v.editor.scrollIntoView({ from: pos, to: pos }, true);
        } else {
          const s = v.previewMode.containerEl.querySelector('.markdown-preview-view') ?? v.previewMode.containerEl; s.scrollTop = s.scrollHeight;
          let link;
          for (let i = 0; i < 30; i++) { link = [...v.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph'); if (link) break; await new Promise(resolve => requestAnimationFrame(resolve)); }
          if (!link) throw Error('Source section not rendered'); s.scrollTop += link.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight * .56;
        }
      }, id); await frames(15);
      scenario.ready = await page.evaluate(async id => {
        await document.fonts.ready;
        const p = app.plugins.plugins['margin-link'], [v, o] = [...p.overlays].find(([v]) => v.leaf.id === id), b = o.bridge();
        const s = v.getMode() === 'source' ? b.cm.scrollDOM : v.previewMode.containerEl.querySelector('.markdown-preview-view') ?? v.previewMode.containerEl;
        const started = performance.now(); let previous = '', since = started, stable = 0;
        return await new Promise((resolve, reject) => {
          const sample = () => {
            let native;
            const card = [...o.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph');
            if (card) try {
              if (v.getMode() === 'source') {
                const a = card.anchor.occurrence, range = document.createRange(), from = b.cm.domAtPos(a.start + a.raw.indexOf('|') + 1), to = b.cm.domAtPos(a.end - 2);
                range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset);
                if (range.toString() === a.label) native = range.getBoundingClientRect();
              } else native = [...v.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph')?.getBoundingClientRect();
            } catch { /* Wait for native virtualization to finish. */ }
            const rect = card?.shell.getBoundingClientRect(), now = performance.now();
            const signature = rect?.width && native?.width ? [s.scrollTop, rect.x, rect.y, rect.width, rect.height, native.x, native.y, native.width, native.height].join(':') : '';
            if (signature && signature === previous && document.fonts.status === 'loaded') stable++;
            else { previous = signature; since = now; stable = 0; }
            if (stable >= 4 && now - since >= 200) resolve({ elapsed: now - started, stableFrames: stable });
            else if (now - started > 5000) reject(Error('Native source/card geometry did not settle before the wheel gesture'));
            else requestAnimationFrame(sample);
          }; requestAnimationFrame(sample);
        });
      }, id);
      const mouse = await page.evaluate(({ id, hovered }) => {
        const p = app.plugins.plugins['margin-link'], [v, o] = [...p.overlays].find(([v]) => v.leaf.id === id), b = o.bridge();
        const s = v.getMode() === 'source' ? b.cm.scrollDOM : v.previewMode.containerEl.querySelector('.markdown-preview-view') ?? v.previewMode.containerEl;
        const box = s.getBoundingClientRect();
        const state = window.marginScrollPerformance = { o, v, b, s, active: true, frames: [], times: {}, originals: [], pending: new Set(), mutations: 0, saves: 0, longTasks: [], scrollEvents: [], scrollendEvents: [], paints: [] };
        const wrap = (object, key, name = key) => {
          if (!object || typeof object[key] !== 'function') return;
          const original = object[key]; state.originals.push(() => object[key] = original);
          object[key] = function (...args) { const start = performance.now(), beforeSignature = o.batchSignature;
            if (name === 'paintConnectors') state.currentCacheLookups = [];
            const before = name === 'paintConnectors' ? [...o.batch?.relations ?? []].map(([key, relation]) => [key, relation.fingerprint]) : undefined;
            try { return original.apply(this, args); } finally {
            const duration = performance.now() - start; (state.times[name] ??= []).push(duration);
            if (name === 'paintConnectors') state.paints.push({ start, duration, cards: o.cards.size, relations: o.batch?.relations.size, obstacles: o.obstacles.length, revision: o.geometryRevision, highlighted: o.highlighted,
              scrolling: o.scrolling, before, after: [...o.batch?.relations ?? []].map(([key, relation]) => [key, relation.fingerprint]) });
            if (name === 'paintConnectors') state.paints.at(-1).phase = beforeSignature === o.batchSignature ? 'cached' : o.scrolling ? 'scroll-validation-or-required-solve' : 'quiet-optimization';
            if (name === 'paintConnectors') Object.assign(state.paints.at(-1), {
              routeCacheSize: o.routeCache?.size,
              cacheHits: state.currentCacheLookups.length,
              // A new solve always creates a new PortChoice. Exact translation
              // retains the cached choice object, proving actual hint reuse.
              cacheReused: state.currentCacheLookups.filter(({ key, value }) => o.batch?.relations.get(key)?.connector.choice === value.connector.choice).map(({ key }) => key)
            });
          } };
        };
        wrap(o, 'render'); wrap(o, 'paintConnectors'); wrap(o, 'updateContinuations'); wrap(o.textObstacles, 'read', 'textObstacles'); wrap(p.reading, 'anchors', 'readingAnchors'); wrap(b, 'anchors', 'editorAnchors');
        if (o.routeCache) {
          const get = o.routeCache.get;
          o.routeCache.get = function (key) { const value = get.call(this, key); if (value && state.currentCacheLookups) state.currentCacheLookups.push({ key, value }); return value; };
          state.originals.push(() => o.routeCache.get = get);
        }
        const oldSave = p.saveData; p.saveData = function (...args) { state.saves++; return oldSave.apply(this, args); }; state.originals.push(() => p.saveData = oldSave);
        state.observer = new MutationObserver(records => state.mutations += records.length); state.observer.observe(o.decorations.element, { attributes: true, childList: true, subtree: true });
        state.tasks = new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))); state.tasks.observe({ entryTypes: ['longtask'] });
        const onScroll = () => state.scrollEvents.push(performance.now()), onScrollend = () => state.scrollendEvents.push(performance.now());
        s.addEventListener('scroll', onScroll); s.addEventListener('scrollend', onScrollend);
        state.originals.push(() => { s.removeEventListener('scroll', onScroll); s.removeEventListener('scrollend', onScrollend); });
        o.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
        const geometry = () => {
          const card = [...o.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph');
          let reference;
          if (card) try {
            const occurrence = card.anchor.occurrence, range = document.createRange();
            if (v.getMode() === 'source') {
              const start = occurrence.start + occurrence.raw.indexOf('|') + 1, end = occurrence.end - 2;
              const a = b.cm.domAtPos(start), z = b.cm.domAtPos(end); range.setStart(a.node, a.offset); range.setEnd(z.node, z.offset);
              if (range.toString() === occurrence.label) reference = [...range.getClientRects()].at(-1)?.bottom;
            } else {
              const link = [...v.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph'); if (link) reference = link.getBoundingClientRect().bottom;
            }
          } catch { /* Virtualized text is explicitly recorded as unavailable. */ }
          const cardRect = card?.shell.getBoundingClientRect(), scrollRect = s.getBoundingClientRect();
          const visible = !!cardRect?.width && card.shell.checkVisibility({ checkVisibilityCSS: true }) &&
            cardRect.bottom > scrollRect.top && cardRect.top < scrollRect.bottom && reference > scrollRect.top && reference < scrollRect.bottom;
          return { scrollTop: s.scrollTop, cardTop: cardRect?.top, reference, visible, cardCount: o.cards.size, routes: o.diagnostics.routes, measurements: o.diagnostics.measurements, revision: o.geometryRevision, highlighted: o.highlighted, routeCacheSize: o.routeCache?.size };
        };
        const sample = timestamp => {
          if (!state.active) return;
          const row = { timestamp, ...geometry() }; state.frames.push(row);
          // CM and overlay may both write later in the same animation frame.
          // Retain the early sample, and separately observe the post-rAF task.
          const timer = setTimeout(() => { state.pending.delete(timer); if (state.active) row.postGeometry = geometry(); }, 0); state.pending.add(timer);
          state.raf = requestAnimationFrame(sample);
        }; state.raf = requestAnimationFrame(sample);
        state.stop = () => { state.active = false; cancelAnimationFrame(state.raf); for (const timer of state.pending) clearTimeout(timer); state.pending.clear(); state.observer.disconnect(); state.tasks.disconnect(); state.originals.reverse().forEach(restore => restore()); };
        const card = [...o.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph'), cardBox = card?.shell.getBoundingClientRect();
        return { x: hovered && cardBox ? cardBox.left + cardBox.width / 2 : box.left + box.width * .55,
          y: hovered && cardBox ? cardBox.top + cardBox.height / 2 : box.top + box.height * .45,
          start: s.scrollTop, max: s.scrollHeight - s.clientHeight, cards: o.cards.size, nativeScrollend: 'onscrollend' in s };
      }, { id, hovered });
      assert(mouse.cards >= 6, 'Missing expected linked cards');
      await page.mouse.move(mouse.x, mouse.y);
      let compositor;
      if (process.argv.includes('--compositor')) {
        const geometry = await page.evaluate(() => {
          const { o, v, b } = window.marginScrollPerformance;
          const card = [...o.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph');
          let body;
          if (v.getMode() === 'source') {
            const a = card.anchor.occurrence, range = document.createRange(), from = b.cm.domAtPos(a.start + a.raw.indexOf('|') + 1), to = b.cm.domAtPos(a.end - 2);
            range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset); body = range.getBoundingClientRect().toJSON();
          } else body = [...v.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph').getBoundingClientRect().toJSON();
          return { body, card: card.button.querySelector('.margin-link-card-label').getBoundingClientRect().toJSON(), dpr: devicePixelRatio };
        });
        const directory = `${output}/${name}-compositor`; await mkdir(directory, { recursive: true });
        const shots = [{ data: (await page.screenshot()).toString('base64'), timestamp: Date.now() / 1000 }];
        const receive = event => { shots.push({ data: event.data, timestamp: event.metadata.timestamp }); void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); };
        cdp.on('Page.screencastFrame', receive);
        await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1614, maxHeight: 838, everyNthFrame: 1 });
        compositor = async () => {
          await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', receive);
          for (let index = 0; index < shots.length; index++) await writeFile(`${directory}/${String(index).padStart(4, '0')}.png`, Buffer.from(shots[index].data, 'base64'));
          await writeFile(`${directory}/geometry.json`, JSON.stringify({ ...geometry, frames: shots.map(({ timestamp }, index) => ({ index, timestamp })) }, null, 2));
          return { directory, frames: shots.length };
        };
      }
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
      try {
        // Repeated small wheel packets exercise scroll fast paths; larger
        // reverse sweeps cross virtualization/measurement coverage boundaries.
        const deltas = process.argv.includes('--deep-returns')
          ? Array.from({ length: 2 }, () => [...Array(24).fill(-90), ...Array(24).fill(90)]).flat()
          : [...Array(36).fill(-32), ...Array(36).fill(32), ...Array(24).fill(-90), ...Array(24).fill(90)];
        for (const delta of deltas) {
          await page.mouse.wheel(0, delta); await page.waitForTimeout(12);
        }
        await page.evaluate(() => window.marginScrollPerformance.wheelEnded = performance.now());
        await page.waitForTimeout(450); await frames(4);
      } finally {
        const profile = await cdp.send('Profiler.stop'); await cdp.send('Profiler.disable');
        await writeFile(`${output}/${name}.cpuprofile`, JSON.stringify(profile.profile));
        if (compositor) scenario.compositor = await compositor();
      }
      const data = await page.evaluate(() => {
        const state = window.marginScrollPerformance; state.stop();
        return { frames: state.frames, times: state.times, mutations: state.mutations, saves: state.saves, longTasks: state.longTasks, diagnostics: state.o.diagnostics,
          scrollEvents: state.scrollEvents, scrollendEvents: state.scrollendEvents, paints: state.paints, wheelEnded: state.wheelEnded };
      });
      await writeFile(`${output}/${name}-frames.json`, JSON.stringify(data, null, 2));
      const intervals = data.frames.slice(1).map((f, i) => f.timestamp - data.frames[i].timestamp);
      const rawReferences = data.frames.filter(f => f.visible && Number.isFinite(f.cardTop) && Number.isFinite(f.reference));
      const rawOffsets = rawReferences.map(f => f.cardTop - f.reference);
      const references = data.frames.map(f => f.postGeometry).filter(f => f?.visible && Number.isFinite(f.cardTop) && Number.isFinite(f.reference));
      const offsets = references.map(f => f.cardTop - f.reference);
      const returning = []; let absent = false;
      for (const paint of data.paints) {
        if (paint.relations === 0) absent = true;
        else if (absent && paint.relations > 0) { returning.push({ time: paint.start, duration: paint.duration, relations: paint.relations, routeCacheSize: paint.routeCacheSize, cacheHits: paint.cacheHits, cacheReused: paint.cacheReused }); absent = false; }
      }
      Object.assign(scenario, { executionCompleted: true, mouse, frames: summary(intervals), timings: Object.fromEntries(Object.entries(data.times).map(([k, v]) => [k, summary(v)])),
        mutations: data.mutations, saves: data.saves, longTasks: data.longTasks, diagnostics: { ...data.diagnostics, work: summary(data.diagnostics.work) },
        scrollEvents: data.scrollEvents.length, scrollendEvents: data.scrollendEvents.length,
        paintRelationCounts: [...new Set(data.paints.map(p => p.relations))], paintCardCounts: [...new Set(data.paints.map(p => p.cards))],
        offscreenReturns: returning,
        stoppedPaint: summary(data.paints.filter(p => p.start > data.wheelEnded).map(p => p.duration)),
        paintPhases: Object.fromEntries(['cached', 'scroll-validation-or-required-solve', 'quiet-optimization'].map(phase => [phase, summary(data.paints.filter(p => p.phase === phase).map(p => p.duration))])),
        geometry: { method: 'post-animation-frame task; early rAF observations retained separately', frames: references.length, relativeOffsetRange: offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null,
          earlyRafRange: rawOffsets.length ? Math.max(...rawOffsets) - Math.min(...rawOffsets) : null },
        scrollRange: [Math.min(...data.frames.map(f => f.scrollTop)), Math.max(...data.frames.map(f => f.scrollTop))] });
      if (verify) {
        assert(references.length > 50, 'Insufficient frames with independently visible source/card');
        assert(scenario.geometry.relativeOffsetRange <= 1, 'Visible card drifted relative to its independently measured native source');
      }
      if (process.argv.includes('--geometry') && lines === 'always') {
        const checkpoints = [];
        for (const delta of [0, -120, 240, -120]) {
          if (delta) await page.mouse.wheel(0, delta); await frames(5);
          const snapshot = await page.evaluate(id => window.marginConnectorProbe(id), id);
          const visible = snapshot.cards.filter(c => c.rect.width && c.sourceVisible && c.fullyVisible);
          for (const card of visible) {
            if (card.routeState === 'continuation') {
              const pair = card.markers.filter(m => m.visible); assert.equal(pair.length, 2, `${card.label}: missing numbered continuation pair`);
              assert(pair.every(m => m.safe), `${card.label}: continuation covers readable text`);
            } else {
              assert.equal(card.routeState, 'complete', `${card.label}: missing route for visible endpoints`);
              assert(card.route.complete, `${card.label}: native SVG endpoints/joints disconnected`);
              assert.deepEqual(card.route.collisions, [], `${card.label}: native SVG intersects readable text/card`);
            }
          }
          assert(visible.length >= 3, 'Geometry checkpoint lacks independent visible relations');
          checkpoints.push({ delta, visible: visible.map(c => ({ label: c.label, state: c.routeState, route: c.route, markers: c.markers })) });
        }
        scenario.checkpoints = checkpoints;
      }
      if (verify) {
        assert(scenario.timings.render.max < 50, `Plugin render long task: ${scenario.timings.render.max}`);
        assert(scenario.timings.render.p95 <= 16.7, `Plugin render p95 exceeded frame budget: ${scenario.timings.render.p95}`);
        assert.equal(data.saves, 0, 'Scrolling wrote layout data');
        if (process.argv.includes('--deep-returns')) { assert(returning.length >= 2, 'Trajectory did not leave all relations offscreen twice'); assert(returning.every(r => r.cacheReused.length > 0), 'Returned relation did not reuse a validated cached route'); }
        scenario.passed = true;
      }
      await page.screenshot({ path: `${output}/${name}.png` });
      console.log(`${name} render p95 ${scenario.timings.render?.p95}, max ${scenario.timings.render?.max}, routes ${scenario.diagnostics.routes}, frames>50 ${scenario.frames.over50}`);
    } catch (error) { Object.assign(scenario, { passed: false, error: String(error), stack: error.stack }); process.exitCode = 1; }
    finally { await page.evaluate(() => window.marginScrollPerformance?.stop?.()).catch(() => {}); }
    await save();
  }
  report.status = report.scenarios.every(s => s.executionCompleted && !s.error && (!verify || s.passed)) && !report.errors.length ? verify ? 'passed' : 'measured' : 'failed';
} catch (error) { Object.assign(report, { status: 'failed', error: String(error), stack: error.stack }); process.exitCode = 1; }
finally {
  if (page && preferences) await page.evaluate(async ({ preferences, layouts }) => { window.marginScrollPerformance?.stop?.(); const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, preferences); p.layouts.records = layouts; await p.savePreferences(); await p.flush(); }, { preferences, layouts }).catch(error => report.restoreError = String(error));
  report.formalHashAfter = digest(await readFile(within(sourceVault, fixture)));
  report.formalUnchangedDuringRun = report.formalHashAfter === sourceHash;
  await save(); await browser?.close(); console.log(`${report.status}: ${output}/results.json`);
}
