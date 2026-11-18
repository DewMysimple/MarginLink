/* global app */
// Run against a fresh launch-navigation-test.ps1 window. Each invocation
// keeps its own raw measurements, including failed assertions.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { checkNavigationLifetime } from './desktop-navigation-lifecycle.mjs';

const baseline = process.argv.includes('--baseline');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
const rawDir = 'artifacts/navigation';
await mkdir(rawDir, { recursive: true });
const report = { phase: baseline ? 'baseline' : 'candidate', scenarios: [], errors: [] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const frames = (n = 12) => page.evaluate(n => new Promise(resolve => {
  const tick = () => --n ? requestAnimationFrame(tick) : resolve();
  requestAnimationFrame(tick);
}), n);
const mode = async (name, file = 'Navigation.md') => {
  await page.evaluate(async ({ name, file }) => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    await app.workspace.activeLeaf.setViewState({ type: 'markdown', state: { file, mode: name === 'reading' ? 'preview' : 'source', source: name === 'source' } });
  }, { name, file });
  await page.waitForFunction(() => app.workspace.activeLeaf.view.contentEl.querySelectorAll('.margin-link-card').length === 5, undefined, {timeout: 6000}).catch(async error => {
    const state = await page.evaluate(() => { const view = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(view);
      return { mode: view.getMode(), cards: o.cards.size, dom: view.contentEl.querySelectorAll('.margin-link-card').length, layer: o.decorations.element.isConnected, canvas: o.decorations.canvas.isConnected };
    });
    throw Error(error.message + ' ' + JSON.stringify(state));
  });
  await frames(20);
};
const first = page.locator('.margin-link-card').first();
const second = page.locator('.margin-link-card').nth(1);
const wait = fn => page.waitForFunction(fn, undefined, { timeout: 4500 });
let verified = false;
try {
  await wait(() => window.app?.vault?.adapter);
  const vault = path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(vault).toLowerCase(), path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(vault), /^[a-f0-9]{32}$/);
  verified = true;
  const trust = page.getByRole('button', { name: /信任仓库作者并启用插件|Trust author and enable plugins/i });
  if (await trust.isVisible()) await trust.click();
  await wait(() => app.plugins.plugins['margin-link']);
  page.on('pageerror', error => report.errors.push(String(error)));
  report.userAgent = await page.evaluate(() => navigator.userAgent);
  report.hostTitle = await page.title();
  const pluginDir = path.join(vault, '.obsidian/plugins/margin-link');
  report.manifest = JSON.parse(await readFile(path.join(pluginDir, 'manifest.json')));
  report.bundle = sha(await readFile(path.join(pluginDir, 'main.js')));
  const source = () => readFile(path.join(vault, 'Navigation.md'));
  const data = () => readFile(path.join(pluginDir, 'data.json'));
  report.source = sha(await source());
  for (const name of ['live', 'source', 'reading']) {
    await mode(name);
    if (await page.locator('.modal-container .vertical-tab-header').isVisible()) {
      await page.keyboard.press('Escape'); await page.locator('.modal-container .vertical-tab-header').waitFor({state: 'hidden'});
    }
    const measured = await page.evaluate(async () => {
      const plugin = app.plugins.plugins['margin-link'], view = app.workspace.activeLeaf.view, overlay = plugin.overlays.get(view);
      await document.fonts.ready;
      // Exclude startup, the host's layout transition and the 160 ms scroll
      // idle pass from the interaction-only window. Fail if it never settles.
      const settleStart = performance.now();
      let previous = '', stableSince = settleStart;
      for (;;) {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const signature = [overlay.geometryRevision, overlay.batchSignature, overlay.frame, overlay.scrolling].join('/');
        if (signature !== previous || overlay.frame || overlay.scrolling) stableSince = performance.now();
        previous = signature;
        if (performance.now() - stableSince > 320) break;
        if (performance.now() - settleStart > 5000) throw Error('Host layout did not settle: ' + signature);
      }
      const buttons = [...overlay.cards.values()].map(c => c.button);
      const diagnostics = overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      const reads = app.vault.cachedRead, save = plugin.saveData;
      let targetReads = 0, saves = 0;
      app.vault.cachedRead = function(file) { if (file !== view.file) targetReads++; return reads.call(this, file); };
      plugin.saveData = function(...args) { saves++; return save.apply(this, args); };
      const geometryBefore = [overlay.geometryRevision, overlay.batchSignature];
      const samples = [], longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => e.duration)));
      observer.observe({type: 'longtask'});
      try {
        for (let i = 0; i < 160; i++) {
          const shell = buttons[i % buttons.length].parentElement, start = performance.now();
          shell.dispatchEvent(new PointerEvent('pointerenter'));
          shell.dispatchEvent(new PointerEvent('pointerleave'));
          samples.push(performance.now() - start);
        }
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const hoverRoutes = diagnostics.routes, svgWrites = diagnostics.svgWrites;
        const geometryAfter = [overlay.geometryRevision, overlay.batchSignature];
        const scroller = overlay.scroller;
        for (let i = 0; i < 48; i++) {
          scroller.scrollTop += i < 24 ? 14 : -14;
          await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        }
        await new Promise(resolve => setTimeout(resolve, 320));
        return { samples, longTasks, geometryBefore, geometryAfter, render: diagnostics.work, hoverRoutes, svgWrites, targetReads, saves,
          size: [innerWidth, innerHeight], mode: view.getMode(), live: !!view.contentEl.querySelector('.is-live-preview') };
      } finally { observer.disconnect(); app.vault.cachedRead = reads; plugin.saveData = save; overlay.diagnostics = undefined; }
    });
    report.scenarios.push({ name, ...measured });
    assert.equal(measured.mode, name === 'reading' ? 'preview' : 'source');
    if (name !== 'reading') assert.equal(measured.live, name === 'live');
    assert(measured.render.length > 0);
    for (const metric of ['hoverRoutes', 'svgWrites', 'targetReads', 'saves']) assert.equal(measured[metric], 0, metric);
    if (!baseline) {
      const before = sha(await data());
      await first.focus(); await page.keyboard.press('p');
      const key = await first.locator('..').getAttribute('data-relation');
      await second.hover();
      assert.equal(await page.locator('.margin-link-pinned').getAttribute('data-relation'), key);
      assert.equal(await page.locator('.margin-link-card.margin-link-active').count(), 1);
      assert(await page.locator(name === 'reading' ? '.margin-link-anchor-active' : '.margin-link-anchor-ink').count() >= 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.margin-link-pinned').count(), 0);
      assert.equal(sha(await data()), before);
    }
  }
  if (!baseline) {
    const before = sha(await data()), preview = page.locator('.margin-link-target-preview');
    const context = () => page.evaluate(() => {
      const view = app.workspace.activeLeaf.view;
      return [view.leaf.id, view.editor.getCursor(), app.plugins.plugins['margin-link'].overlays.get(view).scroller.scrollTop];
    });
    const entry = await context();
    await first.hover();
    await preview.getByText(/Plain text/).waitFor();
    assert.equal(await preview.locator('script, img, iframe, a').count(), 0);
    assert((await preview.innerText()).includes('<script>void 0</script>'));
    await preview.hover(); await page.waitForTimeout(260);
    assert(await preview.isVisible());
    if (process.argv.includes('--capture')) await page.screenshot({path: path.join(rawDir, 'reading-preview.png')});
    assert.deepEqual(await context(), entry);
    await first.focus(); await page.keyboard.press('v');
    assert(await preview.evaluate(e => e === document.activeElement));
    await page.keyboard.press('Escape');
    assert(await first.evaluate(e => e === document.activeElement));
    assert.equal(await preview.count(), 0);
    await page.locator('.margin-link-card').nth(3).focus(); await page.keyboard.press('v');
    await preview.getByText('附件仅显示文件信息。').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.margin-link-card').nth(4).focus(); await page.keyboard.press('v');
    await preview.getByText('未找到目标文件。').waitFor();
    await page.keyboard.press('Escape');
    await first.focus(); await page.keyboard.press('v');
    await page.evaluate(() => app.vault.modify(app.vault.getFileByPath('Docs/Target.md'), 'Changed preview target.'));
    await wait(() => !document.querySelector('.margin-link-target-preview'));
    await first.focus(); await page.keyboard.press('v');
    await preview.getByText('Changed preview target.').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => app.vault.rename(app.vault.getFileByPath('Docs/Target.md'), 'Docs/Renamed.md'));
    await first.focus(); await page.keyboard.press('v');
    await preview.getByText('未找到目标文件。').waitFor();
    await page.keyboard.press('Escape');
    await page.evaluate(() => app.vault.rename(app.vault.getFileByPath('Docs/Renamed.md'), 'Docs/Target.md'));
    assert.equal(sha(await data()), before);
    report.preview = 'hover, panel handoff, literal Markdown, keyboard return, attachment/missing, modify/rename, leaf/cursor/scroll and disk invariants';
  }
  if (!baseline) {
    const groups = page.locator('.margin-link-group-action').first();
    const cards = page.locator('.margin-link-card-shell');
    const slots = () => cards.evaluateAll(nodes => Object.fromEntries(nodes.map(el => [el.dataset.relation, el.style.transform])));
    const fold = async label => {
      await groups.click();
      await page.locator('.menu-item').filter({ hasText: label }).click();
      await frames();
    };
    assert.equal(await groups.count(), 0);
    await page.evaluate(() => app.plugins.plugins['margin-link'].openSettingsPanel());
    const selector = page.locator('[data-margin-key="groupMode"] select:not([aria-hidden="true"])');
    assert.equal(await selector.inputValue(), 'none');
    await selector.selectOption('folder');
    await page.evaluate(() => {
      const leaf = app.workspace.getLeavesOfType('margin-link-settings')[0];
      leaf.detach(); app.workspace.rightSplit.collapse();
      app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], {focus: true});
    });
    await frames();
    report.groupLayouts = [];
    for (const placementMode of ['auto', 'free', 'snap', 'manual']) {
      await page.evaluate(async placement => {
        const plugin = app.plugins.plugins['margin-link'];
        await plugin.setPlacementMode(placement); plugin.preferences.groupMode = 'folder'; await plugin.savePreferences();
      }, placementMode);
      await frames(); await page.waitForTimeout(350);
      const before = await slots(), disk = sha(await data());
      assert.equal(Object.keys(before).length, 5);
      const members = await cards.evaluateAll(nodes => nodes.filter(n => n.dataset.group === 'Docs/').map(n => n.dataset.relation));
      assert.equal(members.length, 2);
      await fold('Docs/ · 2');
      assert.equal(await cards.count(), 3);
      for (const node of await page.locator('path[data-segment]').evaluateAll(nodes => nodes.flatMap(n => JSON.parse(n.dataset.members)))) assert(!members.includes(node));
      await fold('Docs/ · 2');
      assert.deepEqual(await slots(), before);
      assert.equal(sha(await data()), disk);
      report.groupLayouts.push(placementMode);
    }
    await page.evaluate(async () => { const p = app.plugins.plugins['margin-link']; p.preferences.groupMode = 'type'; await p.savePreferences(); });
    await fold('Markdown · 3'); assert.equal(await cards.count(), 2);
    await fold('Markdown · 3'); assert.equal(await cards.count(), 5);
    await page.evaluate(async () => {
      const sibling = app.workspace.getLeaf('split', 'horizontal');
      await sibling.setViewState({type: 'markdown', state: {file: 'Navigation.md', mode: 'preview'}, active: true});
    });
    await wait(() => document.querySelectorAll('.margin-link-card').length === 10);
    await fold('Markdown · 3');
    const counts = await page.evaluate(() => app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view.contentEl.querySelectorAll('.margin-link-card').length).sort());
    assert.deepEqual(counts, [2, 5]);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown').at(-1).detach());
    report.groups = 'folder/type, independent duplicate occurrences, hidden route membership, unchanged slots and layout snapshot, split leaf independence';
  }
  if (!baseline) report.lifetime = await checkNavigationLifetime(page, frames);
  assert.equal(sha(await source()), report.source);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;
} finally {
  if (verified && !page.isClosed()) {
    try {
      await page.keyboard.press('Escape');
      const closed = page.waitForEvent('close', {timeout: 6000});
      await Promise.all([closed, page.locator('.titlebar-button.mod-close').click({timeout: 4000}).catch(error => { if (!page.isClosed()) throw error; })]);
    } catch (error) { report.shutdownError = String(error); report.status = 'failed'; process.exitCode = 1; }
  }
  const output = path.join(rawDir, report.phase + '-' + Date.now() + '.json');
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(report.status, output, report.failure ?? '');
  await browser.close();
}
