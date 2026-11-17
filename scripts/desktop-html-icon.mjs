/* global app */
// Actual Obsidian card rendering and interaction, restricted to the test Vault.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const output = process.argv.find(value => value.startsWith('--output='))?.slice(9) ?? 'artifacts/html-icon-0.2.26';
const vault = path.resolve('test-vault'), fixture = 'HTML Icon Acceptance.md';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const body = '# HTML icon acceptance\n\nThe HTML card: [[References/stages.html|HTML example]].\n\nThe uppercase HTM card: [[HTML Icon Target.HTM|HTM example]].\n\nThe ordinary control: [[Note A|Markdown example]].\n';
const fixtures = { [fixture]: body, 'HTML Icon Target.HTM': '<!doctype html><title>HTML icon acceptance</title><p>Isolated HTM file.</p>' };
await mkdir(output, { recursive: true });
if (process.argv.includes('--prepare')) {
  await mkdir(`${output}/config-before`, { recursive: true });
  const configs = [];
  for (const relative of ['app.json', 'appearance.json', 'community-plugins.json', 'core-plugins.json', 'workspace.json', 'plugins/margin-link/data.json']) {
    const source = path.join(vault, '.obsidian', relative), backup = `${output}/config-before/${relative.replaceAll('/', '__')}`;
    await copyFile(source, backup, 1); configs.push({ relative, sha256: digest(await readFile(source)) });
  }
  for (const [name, contents] of Object.entries(fixtures)) await writeFile(path.join(vault, name), contents, { flag: 'wx' });
  await writeFile(`${output}/prepare.json`, JSON.stringify({ fixtures: Object.entries(fixtures).map(([name, contents]) => ({ relative: name, sha256: digest(contents) })), configs }, null, 2));
  console.log(`Prepared ${fixture}; backed up ${configs.length} test configurations.`); process.exit(0);
}
const report = { status: 'running', scenarios: [], errors: [] };
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const expectedIcon = await readFile('src/assets/edge.png');
report.expectedIconSHA256 = digest(expectedIcon);
let browser, page, preferences, layouts;
const frames = count => page.evaluate(count => new Promise(resolve => {
  const next = () => --count ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next);
}), count);
const check = async (name, run) => {
  try { const detail = await run(); report.scenarios.push({ name, passed: true, ...detail }); console.log('PASS', name); }
  catch (error) { report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack }); console.log('FAIL', name, error.message); }
  await save();
};
try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9226', { timeout: 12000 });
  page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/')); assert(page); page.setDefaultTimeout(12000);
  await page.waitForFunction(() => typeof app !== 'undefined' && app.plugins?.plugins['margin-link']?.layouts && app.workspace.layoutReady);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), vault.toLowerCase());
  report.host = await page.title(); report.version = await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version);
  report.bundleSHA256 = digest(await readFile(path.join(vault, '.obsidian/plugins/margin-link/main.js')));
  page.on('pageerror', error => report.errors.push({ message: String(error), stack: error.stack }));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  layouts = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(() => { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); });
  const open = async (mode, shape = 'square', placementMode = 'auto') => {
    const id = await page.evaluate(async ({ fixture, mode, shape, placementMode }) => {
      const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, { enabled: true, lines: 'always', cardShape: shape, density: 'auto', placementMode, layout: 'balanced', showPath: true, hoverFeedback: true });
      await p.savePreferences();
      const leaf = app.workspace.activeLeaf ?? app.workspace.getLeaf(false);
      await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode, source: false } });
      if (mode === 'preview') leaf.view.previewMode.rerender(true);
      app.workspace.setActiveLeaf(leaf, { focus: true }); return leaf.id;
    }, { fixture, mode, shape, placementMode });
    await page.waitForFunction(id => [...app.plugins.plugins['margin-link'].overlays].some(([v, o]) => v.leaf.id === id && o.cards.size === 3), id);
    await page.evaluate(() => document.fonts.ready); await frames(20); return id;
  };
  const cards = id => page.evaluate(async id => {
    const [, o] = [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id);
    const output = [];
    for (const [key, c] of o.cards) {
      const image = c.button.querySelector('img'), icon = c.button.querySelector('.margin-link-html-icon'), label = c.button.querySelector('.margin-link-html-label');
      const outer = c.button.getBoundingClientRect(), imageBox = image?.getBoundingClientRect(), labelBox = label?.getBoundingClientRect();
      let pixels;
      if (image) {
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data; let colored = 0, opaque = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 100) { opaque++; if (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 30) colored++; }
        pixels = { opaque, colored };
      }
      const within = r => !!r && r.left >= outer.left && r.right <= outer.right && r.top >= outer.top && r.bottom <= outer.bottom;
      output.push({ key, target: c.anchor.occurrence.target, alias: c.anchor.occurrence.label, shape: c.shell.dataset.shape, compact: c.button.classList.contains('margin-link-compact'), rect: outer.toJSON(),
        image: image ? { source: image.currentSrc, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, complete: image.complete, rect: imageBox.toJSON(), within: within(imageBox),
          filter: getComputedStyle(image).filter, opacity: getComputedStyle(image).opacity, objectFit: getComputedStyle(image).objectFit, alt: image.alt, draggable: image.draggable, pointerEvents: getComputedStyle(image).pointerEvents, pixels } : null,
        typeLabel: label?.textContent, typeWithin: within(labelBox), iconAriaHidden: icon?.getAttribute('aria-hidden'), title: c.button.getAttribute('title'), ariaLabel: c.button.getAttribute('aria-label'),
        accessible: document.getElementById(c.button.getAttribute('aria-labelledby'))?.textContent, tooltip: c.button.dataset.tooltip,
        labelText: c.button.querySelector('.margin-link-card-label')?.textContent, labelVisible: c.button.querySelector('.margin-link-card-label')?.checkVisibility({ checkVisibilityCSS: true }),
        ordinarySvg: !!c.button.querySelector('.margin-link-card-icon svg') });
    }
    return output;
  }, id);
  for (const theme of ['light', 'dark']) for (const mode of ['preview', 'source']) for (const shape of ['square', 'horizontal', 'icon']) await check(`${theme}/${mode}/${shape}: full-color supplied PNG, HTML/HTM and native Markdown control`, async () => {
    await page.evaluate(theme => { app.vault.setConfig('theme', theme === 'light' ? 'moonstone' : 'obsidian'); app.setTheme(); }, theme);
    await page.waitForFunction(theme => document.body.classList.contains(`theme-${theme}`), theme); await frames(4);
    const actualTheme = await page.evaluate(() => ({ classes: document.body.className, background: getComputedStyle(document.body).backgroundColor, primary: getComputedStyle(document.body).getPropertyValue('--background-primary').trim() }));
    assert(actualTheme.classes.includes(`theme-${theme}`));
    const channels = actualTheme.background.match(/\d+/g).slice(0, 3).map(Number);
    assert(theme === 'light' ? Math.min(...channels) > 200 : Math.max(...channels) < 80, 'Native theme background did not match requested brightness');
    const id = await open(mode, shape), measured = await cards(id); assert.equal(measured.length, 3);
    for (const card of measured) {
      assert.equal(card.title, null); assert.equal(card.ariaLabel, null); assert.equal(card.labelText, card.alias);
      if (/\.(?:html|HTM)$/.test(card.target)) {
        assert(card.image?.complete); assert.equal(card.image.naturalWidth, 512); assert.equal(card.image.naturalHeight, 512);
        assert(card.image.source.startsWith('data:image/png;base64,')); assert.equal(digest(Buffer.from(card.image.source.split(',')[1], 'base64')), report.expectedIconSHA256);
        assert(card.image.within, 'PNG clipped'); assert.equal(card.typeLabel, undefined, 'HTML wordmark must be absent'); assert.equal(card.iconAriaHidden, 'true');
        assert.equal(card.image.filter, 'none'); assert.equal(card.image.opacity, '1'); assert(card.image.pixels.colored > 200); assert(card.image.pixels.opaque > 300);
        assert.equal(card.image.alt, ''); assert.equal(card.image.draggable, false); assert.equal(card.image.objectFit, 'contain');
        assert.match(card.accessible, / · HTML 文件$/); assert(card.tooltip.endsWith(' · HTML 文件')); assert.equal(card.ordinarySvg, false);
      } else { assert.equal(card.image, null); assert(card.ordinarySvg); }
      if (shape === 'icon') { assert(card.compact); assert.equal(card.labelVisible, false); } else assert(card.labelVisible);
    }
    await page.screenshot({ path: `${output}/${theme}-${mode}-${shape}.png` });
    return { actualTheme, checks: measured.map(c => ({ ...c, image: c.image && { ...c.image, source: undefined, embeddedSHA256: digest(Buffer.from(c.image.source.split(',')[1], 'base64')) } })) };
  });
  for (const mode of ['preview', 'source']) await check(`${mode}: image preserves tooltip, drag, saved position and single-click opening`, async () => {
    const id = await open(mode, 'square', 'free'), before = await cards(id), card = before.find(c => c.target.endsWith('.html')); assert(card);
    const x = card.image.rect.x + card.image.rect.width / 2, y = card.image.rect.y + card.image.rect.height / 2;
    await page.mouse.move(x, y); await page.waitForTimeout(600);
    assert.equal(await page.locator('.margin-link-tooltip').count(), 1); assert.match(await page.locator('.margin-link-tooltip').innerText(), /stages\.html · HTML 文件/);
    await page.mouse.down(); await page.mouse.move(x, y + 60, { steps: 10 }); await frames(2);
    assert.equal(await page.locator('.margin-link-tooltip').count(), 0, 'Tooltip remained while dragging');
    assert(await page.evaluate(id => [...app.plugins.plugins['margin-link'].overlays].find(([v]) => v.leaf.id === id)[1].cardDrag.dragging, id));
    await page.mouse.up(); await frames(8);
    const after = await cards(id), moved = after.find(c => c.key === card.key); assert(Math.abs(moved.rect.y - card.rect.y - 60) <= 1);
    for (const neighbor of before.filter(c => c.key !== card.key)) { const current = after.find(c => c.key === neighbor.key); assert(Math.abs(current.rect.x - neighbor.rect.x) <= 1 && Math.abs(current.rect.y - neighbor.rect.y) <= 1); }
    const saved = await page.evaluate(async () => { const p = app.plugins.plugins['margin-link']; await p.flush(); return p.layouts.snapshot(); }); assert(saved.some(r => r.source === fixture));
    await page.mouse.move(20, 20); await frames(2);
    await page.mouse.click(moved.image.rect.x + moved.image.rect.width / 2, moved.image.rect.y + moved.image.rect.height / 2);
    await page.waitForFunction(() => app.workspace.activeLeaf?.view.file?.path === 'References/stages.html');
    assert.equal(await readFile(path.join(vault, fixture), 'utf8'), body);
    return { draggedPixels: moved.rect.y - card.rect.y, neighbors: before.length - 1, openedTarget: 'References/stages.html', tooltipsWhileDragging: 0 };
  });
  report.status = report.scenarios.every(s => s.passed) && !report.errors.length ? 'passed' : 'failed'; if (report.status !== 'passed') process.exitCode = 1;
} catch (error) { Object.assign(report, { status: 'failed', error: String(error), stack: error.stack }); process.exitCode = 1; }
finally {
  if (page && preferences) await page.evaluate(async ({ preferences, layouts }) => { const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, preferences); p.layouts.records = layouts; await p.savePreferences(); await p.flush(); }, { preferences, layouts }).catch(error => report.restoreError = String(error));
  await save(); await browser?.close(); console.log(`${report.status}: ${output}/results.json`);
}
