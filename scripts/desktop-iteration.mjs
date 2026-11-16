/* global app */
// Only this repository's isolated profile. Capture baseline before replacing its bundle.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';

const phase = process.argv[2] ?? 'final', mode = process.argv[3] ?? 'preview', out = `artifacts/iteration-16-20/${phase}-${mode}`;
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert(page);
assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase());
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
const frames = (n = 6) => page.evaluate(n => new Promise(resolve => { const tick = () => --n ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick); }), n);
const report = { phase, cpu: os.cpus()[0].model, platform: os.platform(), host: await page.title(), scenarios: [], errors: [] };
report.installedManifest = JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/manifest.json', 'utf8'));
report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
page.on('pageerror', error => report.errors.push(String(error)));
try {
  await page.evaluate(async mode => {
    const plugin = app.plugins.plugins['margin-link'];
    Object.assign(plugin.preferences, { enabled: true, lines: 'always', lineStyle: 'elbow', lineWidth: 2, placementMode: 'free', cardShape: 'square', reduceMotion: true });
    await plugin.savePreferences(); app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const leaf = app.workspace.getLeavesOfType('markdown')[0];
    await leaf.setViewState({ type: 'markdown', state: { file: 'Connector Manual.md', mode, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, mode);
  await frames(15);
  await page.evaluate(() => {
    const plugin = app.plugins.plugins['margin-link'], [view] = [...plugin.overlays].find(([v]) => v.file?.path === 'Connector Manual.md');
    if (view.getMode() === 'source') {
      const at = view.editor.getValue().indexOf('Early Access'), pos = view.editor.offsetToPos(at);
      view.editor.scrollIntoView({ from: pos, to: pos }, true); return;
    }
    const link = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Early Access');
    assertBrowser(link, 'Rendered six-link paragraph required');
    const scroll = view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
    scroll.scrollTop += link.getBoundingClientRect().top - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
    function assertBrowser(value, message) { if (!value) throw Error(message); }
  });
  await frames(20);
  report.environment = await page.evaluate(() => ({ dpr: devicePixelRatio, theme: document.body.className, zoom: window.require('electron').webFrame.getZoomFactor(), refresh: screen.refreshRate ?? 'rAF sample below', plugin: app.plugins.plugins['margin-link'].manifest.version }));
  report.environment.plugin = report.installedManifest.version;
  const setup = async enabled => {
    await page.evaluate(async enabled => {
      if (!enabled) { await app.plugins.disablePlugin('margin-link'); return; }
      if (!app.plugins.plugins['margin-link']) await app.plugins.enablePlugin('margin-link');
      const plugin = app.plugins.plugins['margin-link'];
      Object.assign(plugin.preferences, { enabled, lines: enabled === 'numbers' ? 'numbers' : 'always' }); plugin.preferences.enabled = !!enabled;
      await plugin.savePreferences();
    }, enabled); await frames(15);
    await page.evaluate(() => {
      const plugin = app.plugins.plugins['margin-link'], view = app.workspace.getLeavesOfType('markdown')[0].view;
      const overlay = plugin?.overlays.get(view), bridge = [...plugin?.bridges ?? []].find(b => view.contentEl.contains(b.cm.dom));
      const scroller = view.getMode() === 'source' ? view.contentEl.querySelector('.cm-scroller') : view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
      if (overlay) overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      const counts = { render: 0, work: [], routes: 0, scans: 0, svgD: 0, saves: 0, markers: 0 };
      const restorers = [];
      const wrap = (obj, key, count, timing = false) => {
        if (typeof obj?.[key] !== 'function') return;
        const original = obj[key]; obj[key] = function (...args) {
          counts[count]++; const at = performance.now(); try { return original.apply(this, args); }
          finally { if (timing) counts.work.push(performance.now() - at); }
        }; restorers.push(() => { obj[key] = original; });
      };
      wrap(overlay, 'render', 'render', true); wrap(plugin, 'saveData', 'saves');
      const originalSet = SVGElement.prototype.setAttribute;
      SVGElement.prototype.setAttribute = function (name, value) { if (name === 'd' && this.closest('.margin-link-connectors')) counts.svgD++; return originalSet.call(this, name, value); };
      restorers.push(() => { SVGElement.prototype.setAttribute = originalSet; });
      const obstacle = overlay?.textObstacles, oldRevision = obstacle?.revision;
      const longTasks = [], observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
      observer.observe({ type: 'longtask', buffered: false });
      const base = scroller.scrollTop, samples = [];
      const first = overlay && [...overlay.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph');
      const link = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph');
      const sourceTop = () => {
        if (view.getMode() !== 'source') return link?.getBoundingClientRect().top;
        if (!first) return undefined;
        const occurrence = first.anchor.occurrence, from = occurrence.start + occurrence.raw.indexOf('|') + 1;
        return bridge.rangeRects(from, occurrence.end - 2).at(-1)?.top;
      };
      const offset = first && sourceTop() !== undefined ? first.shell.getBoundingClientRect().top - sourceTop() : null;
      window.marginIteration = { counts, samples, longTasks, base, scroller, scrollHeight: scroller.scrollHeight, overlay, oldRevision, offset, first, sourceTop, restore: () => { observer.disconnect(); restorers.forEach(f => f()); } };
    });
  };
  const measure = async (name, enabled) => {
    await setup(enabled);
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
    const result = await page.evaluate(async () => {
      const m = window.marginIteration;
      let previous; for (let i = 0; i < 150; i++) {
        await new Promise(resolve => requestAnimationFrame(now => {
          const target = m.base + Math.sin(i * Math.PI / 25) * 70;
          m.scroller.scrollTop = target;
          const drift = m.first?.shell.isConnected && m.sourceTop() !== undefined ? m.first.shell.getBoundingClientRect().top - m.sourceTop() - m.offset : null;
          m.samples.push({ at: now, frame: previous ? now - previous : null, scroll: m.scroller.scrollTop, drift }); previous = now; resolve();
        }));
      }
      m.scroller.scrollTop = m.base;
      const result = { counts: m.counts, samples: m.samples, longTasks: m.longTasks, scrollHeight: m.scrollHeight, scans: m.overlay ? m.overlay.textObstacles.revision - m.oldRevision : 0, diagnostics: m.overlay?.diagnostics ?? null };
      m.restore(); return result;
    });
    const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end'); const { stream } = await complete;
    let trace = ''; for (;;) { const read = await cdp.send('IO.read', { handle: stream }); trace += read.data; if (read.eof) break; }
    await cdp.send('IO.close', { handle: stream }); await writeFile(`${out}/${name}-trace.json`, trace);
    const traceEvents = JSON.parse(trace).traceEvents;
    result.traceLongTasks = traceEvents.filter(e => e.name === 'RunTask' && e.dur > 50000).map(e => ({ start: e.ts, duration: e.dur / 1000, thread: e.tid }));
    const percentile = (values, percent) => { const sorted = values.filter(v => v !== null).sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percent))] : null; };
    result.summary = { frames: result.samples.length, p50: percentile(result.samples.map(s => s.frame), .5), p95: percentile(result.samples.map(s => s.frame), .95), longestFrame: Math.max(...result.samples.map(s => s.frame ?? 0)), workP95: percentile(result.counts.work, .95), maxDrift: Math.max(...result.samples.map(s => Math.abs(s.drift ?? 0))), svgD: result.counts.svgD, scans: result.scans, saves: result.counts.saves };
    report.scenarios.push({ name, ...result }); console.log(name, result.summary);
  };
  await measure('plugin-disabled', false);
  await measure('always', true);
  if (phase !== 'baseline' && Number(report.environment.plugin.split('.').at(-1)) >= 19) await measure('numbers', 'numbers');
  await page.screenshot({ path: `${out}/scroll.png` });
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
