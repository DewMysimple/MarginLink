/* global app */
// Run against a fresh launch-navigation-test.ps1 window. Each invocation
// keeps its own raw measurements, including failed assertions.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

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
  const pluginDir = path.join(vault, '.obsidian/plugins/margin-link');
  report.manifest = JSON.parse(await readFile(path.join(pluginDir, 'manifest.json')));
  report.bundle = sha(await readFile(path.join(pluginDir, 'main.js')));
  const source = () => readFile(path.join(vault, 'Navigation.md'));
  const data = () => readFile(path.join(pluginDir, 'data.json'));
  report.source = sha(await source());
  for (const name of ['live', 'source', 'reading']) {
    await mode(name);
    const measured = await page.evaluate(async () => {
      const plugin = app.plugins.plugins['margin-link'], view = app.workspace.activeLeaf.view, overlay = plugin.overlays.get(view);
      const buttons = [...overlay.cards.values()].map(c => c.button);
      const diagnostics = overlay.diagnostics = { renders: 0, measurements: 0, routes: 0, svgWrites: 0, markerWrites: 0, work: [] };
      const reads = app.vault.cachedRead, save = plugin.saveData;
      let targetReads = 0, saves = 0;
      app.vault.cachedRead = function(file) { if (file !== view.file) targetReads++; return reads.call(this, file); };
      plugin.saveData = function(...args) { saves++; return save.apply(this, args); };
      const samples = [];
      try {
        for (let i = 0; i < 160; i++) {
          const shell = buttons[i % buttons.length].parentElement, start = performance.now();
          shell.dispatchEvent(new PointerEvent('pointerenter'));
          shell.dispatchEvent(new PointerEvent('pointerleave'));
          samples.push(performance.now() - start);
        }
        const hoverRoutes = diagnostics.routes, svgWrites = diagnostics.svgWrites;
        const scroller = overlay.scroller;
        for (let i = 0; i < 48; i++) {
          scroller.scrollTop += i < 24 ? 14 : -14;
          await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        }
        await new Promise(resolve => setTimeout(resolve, 320));
        return { samples, render: diagnostics.work, hoverRoutes, svgWrites, targetReads, saves,
          size: [innerWidth, innerHeight], mode: view.getMode(), live: !!view.contentEl.querySelector('.is-live-preview') };
      } finally { app.vault.cachedRead = reads; plugin.saveData = save; overlay.diagnostics = undefined; }
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
  assert.equal(sha(await source()), report.source);
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;
} finally {
  const output = path.join(rawDir, report.phase + '-' + Date.now() + '.json');
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(report.status, output, report.failure ?? '');
  if (verified) await page.locator('.titlebar-button.mod-close').click({timeout: 2500}).catch(() => {});
  await browser.close();
}
