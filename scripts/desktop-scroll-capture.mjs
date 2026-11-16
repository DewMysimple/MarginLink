/* global app */
// Capture Chromium's compositor output under native wheel input, independently
// of the DOM-frame probe. Use analyze-compositor.py on the resulting directory.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = process.argv[2] ?? 'final', mode = process.argv[3] ?? 'source';
const out = `artifacts/iteration-16-20/capture-${phase}-${mode}`;
await mkdir(out, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase());
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
const frames = (n = 12) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
const shots = [];
try {
  await page.evaluate(async mode => {
    const plugin = app.plugins.plugins['margin-link'];
    Object.assign(plugin.preferences, { enabled: true, lines: 'always', lineStyle: 'elbow', reduceMotion: true }); await plugin.savePreferences();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const leaf = app.workspace.getLeavesOfType('markdown')[0];
    await leaf.setViewState({ type: 'markdown', state: { file: 'Connector Manual.md', mode, source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    if (mode === 'source') {
      const at = leaf.view.editor.getValue().indexOf('Scene Graph'), pos = leaf.view.editor.offsetToPos(at);
      leaf.view.editor.scrollIntoView({ from: pos, to: pos }, true);
    }
  }, mode); await frames(20);
  if (mode === 'preview') {
    await page.evaluate(() => {
      const view = app.workspace.getLeavesOfType('markdown')[0].view;
      const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view') ?? view.previewMode.containerEl;
      const link = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph');
      scroller.scrollTop += link.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
    }); await frames();
  }
  const geometry = await page.evaluate(() => {
    const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([v]) => v.file?.path === 'Connector Manual.md');
    const card = [...overlay.cards.values()].find(c => c.anchor.occurrence.label === 'Scene Graph');
    const label = card.button.querySelector('.margin-link-card-label').getBoundingClientRect().toJSON();
    let body;
    if (view.getMode() === 'source') {
      const bridge = overlay.bridge(), occurrence = card.anchor.occurrence;
      body = bridge.rangeRects(occurrence.start + occurrence.raw.indexOf('|') + 1, occurrence.end - 2).at(-1).toJSON();
    } else body = [...view.contentEl.querySelectorAll('a.internal-link')].find(el => el.textContent === 'Scene Graph').getBoundingClientRect().toJSON();
    return { card: label, body, plugin: plugin.manifest.version, host: document.title, dpr: devicePixelRatio, zoom: window.require('electron').webFrame.getZoomFactor() };
  });
  cdp.on('Page.screencastFrame', event => {
    shots.push({ data: event.data, timestamp: event.metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1800, maxHeight: 1100, everyNthFrame: 1 });
  // Trigger an initial actual compositor frame before the first wheel input.
  await page.mouse.move(1200, 550); await frames(10);
  for (const delta of [90, 90, -110, -110, 80, 80, -100, -100, 100, 60, -60, -20]) {
    await page.mouse.wheel(0, delta); await page.waitForTimeout(40);
  }
  await page.waitForTimeout(150); await cdp.send('Page.stopScreencast');
  for (let i = 0; i < shots.length; i++) await writeFile(`${out}/${String(i).padStart(4, '0')}.png`, Buffer.from(shots[i].data, 'base64'));
  await writeFile(`${out}/geometry.json`, JSON.stringify({ ...geometry, frames: shots.map(({ timestamp }, index) => ({ index, timestamp })) }, null, 2));
  console.log(`${out}: ${shots.length} compositor frames`);
} finally { await browser.close(); }
