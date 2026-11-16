/* global app */
// Existing-user data fixture only; no internal layout/save methods are invoked.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert(page, 'Isolated Obsidian must be running');
await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace && app.workspace.getLeavesOfType('markdown').length > 0);
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1980, height: 1000, deviceScaleFactor: 1, mobile: false });
const source = 'Legacy CRLF layout.md';
const raw = '# Legacy CRLF\r\n\r\nBefore [[Folder/Note A|Legacy target]] after.\r\n';
// Fixed v0.2 identity fixtures, calculated from raw and LF-normalized context.
const legacyKey = 'd38c9af9d54b808f964a6b513808dedb1e753158f074d8f6340ca71c53c0841a';
const canonicalKey = 'd38c9af9d54b808f75d67c611a75e40bd6b038630ad5df71340ca71c53c0841a';
const dataPath = 'test-vault/.obsidian/plugins/margin-link/data.json';
const observations = [], errors = [], runtimeErrors = [];
page.on('pageerror', error => errors.push({ message: String(error), stack: error.stack }));
await cdp.send('Runtime.enable'); cdp.on('Runtime.exceptionThrown', event => runtimeErrors.push(event.exceptionDetails));
const savedData = async () => {
  for (let i = 0; i < 20; i++) {
    try { return JSON.parse(await readFile(dataPath, 'utf8')); }
    catch (error) { if (!(error instanceof SyntaxError) || i === 19) throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
  }
};
const enabled = () => page.evaluate(() => !!app.plugins.plugins['margin-link']);
const setPluginEnabled = async value => {
  await page.keyboard.press('Control+,');
  let owner;
  for (let i = 0; i < 100 && !owner; i++) {
    for (const candidate of page.context().pages()) if (!candidate.isClosed() && await candidate.locator('.vertical-tab-nav-item').first().isVisible()) { owner = candidate; break; }
    if (!owner) await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert(owner, 'Native settings must open');
  await owner.locator('.vertical-tab-nav-item').filter({ hasText: /^(Community plugins|第三方插件)$/ }).click();
  const toggle = owner.locator('.setting-item').filter({ hasText: 'MarginLink contributors' }).locator('.checkbox-container'), input = toggle.locator('input[type=checkbox]');
  // Obsidian 1.15.1 styles the label; its nested input.checked stays false.
  const checked = await toggle.evaluate(el => el.classList.contains('is-enabled'));
  if (checked !== value) { await (await input.count() ? input : toggle).focus(); await owner.keyboard.press('Space'); }
  await owner.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (owner === page) await page.keyboard.press('Escape');
  else { await owner.locator('.titlebar-button.mod-close').click(); await page.bringToFront(); }
  await page.waitForFunction(value => !!app.plugins.plugins['margin-link'] === value, value);
  let stored;
  for (let i = 0; i < 40; i++) {
    stored = JSON.parse(await readFile('test-vault/.obsidian/community-plugins.json', 'utf8'));
    if (stored.includes('margin-link') === value) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(stored.includes('margin-link'), value, 'Native plugin-enabled configuration must finish saving before reload');
};
const memory = () => page.evaluate(source => app.plugins.plugins['margin-link'].layouts.snapshot().filter(e => e.source === source), source);
const stable = async () => {
  await page.waitForSelector('.margin-link-host .margin-link-card');
  await page.evaluate(() => { delete window.legacyMigrationStable; });
  await page.waitForFunction(() => {
    const el = document.querySelector('.margin-link-host .margin-link-card-shell');
    if (!el || getComputedStyle(el).visibility === 'hidden') return false;
    const r = el.getBoundingClientRect(), signature = [r.x, r.y, r.width, r.height].join(':');
    const previous = window.legacyMigrationStable ??= { signature: '', count: 0 };
    previous.count = previous.signature === signature ? previous.count + 1 : 0; previous.signature = signature;
    return previous.count >= 8;
  }, undefined, { polling: 'raf' });
};
const open = async (path, mode = 'source') => {
  await page.evaluate(async ({ path, mode }) => { await app.workspace.getLeavesOfType('markdown')[0].setViewState({ type: 'markdown', state: { file: path, mode, source: false } }); }, { path, mode });
};
const actual = async () => page.locator('.margin-link-host .margin-link-card-shell').evaluate(el => ({ manual: el.dataset.manual, rect: el.getBoundingClientRect().toJSON(), line: el.parentElement.querySelector('.margin-link-connector').getAttribute('d') }));
const compare = (value, expected) => {
  assert.equal(value.manual, 'true');
  for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(value.rect[key] - expected.rect[key]) <= 1, `Restored ${key}`);
  const numbers = value => value.match(/-?\d+(?:\.\d+)?/g).map(Number), v = numbers(value.line), e = numbers(expected.line);
  assert.equal(v.length, e.length); v.forEach((n, i) => assert(Math.abs(n - e[i]) <= 1, `Restored connector coordinate ${i}`));
};
let fixture;
try {
  assert(await enabled()); await setPluginEnabled(false);
  await page.evaluate(async ({ source, raw }) => { const f = app.vault.getFileByPath(source); if (f) await app.vault.modify(f, raw); else await app.vault.create(source, raw); }, { source, raw });
  await open(source);
  const data = await savedData();
  fixture = { source, key: legacyKey, side: 'right', xNormalized: 0.72, yOffset: 12, updated: Date.now() };
  await writeFile(dataPath, JSON.stringify({ ...data, preferences: { ...data.preferences, placementMode: 'free', cardShape: 'horizontal', lines: 'always' }, layouts: [...data.layouts.filter(e => e.source !== source), fixture] }));
  await setPluginEnabled(true); await stable();
  const first = await actual(); assert.equal(first.manual, 'true');
  assert.equal(await readFile(`test-vault/${source}`, 'utf8'), raw, 'Loading existing UI positions must not edit CRLF source');
  const migrated = await memory();
  assert.deepEqual(migrated, [{ ...fixture, key: canonicalKey }]);
  observations.push({ stage: 'normal enable with v0.2 raw CRLF record', actual: first, records: migrated });
  await open(source, 'preview'); await stable(); assert.equal((await actual()).manual, 'true'); assert.deepEqual(await memory(), migrated);
  observations.push({ stage: 'reading after native LF normalization', actual: await actual(), records: await memory() });
  await open(source); await stable(); compare(await actual(), first); assert.deepEqual(await memory(), migrated);
  await open('Remediation A.md'); await stable(); await open(source); await stable(); compare(await actual(), first); assert.deepEqual(await memory(), migrated);
  let persisted;
  for (let i = 0; i < 40; i++) { persisted = (await savedData()).layouts.filter(e => e.source === source); if (JSON.stringify(persisted) === JSON.stringify(migrated)) break; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.deepEqual(persisted, migrated);
  await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown')[0].view.save(); await app.workspace.requestSaveLayout().run(); });
  await page.reload(); await stable(); compare(await actual(), first); assert.deepEqual(await memory(), migrated);
  observations.push({ stage: 'source restored after navigation and normal plugin reload', actual: await actual(), records: await memory() });
  await writeFile('artifacts/legacy-layout-migration.json', JSON.stringify({ passed: true, host: await page.title(), pluginVersion: JSON.parse(await readFile('manifest.json', 'utf8')).version, bundleSHA256: createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex'), fixture, observations, errors, runtimeErrors }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(runtimeErrors, []);
  console.log('PASS v0.2 raw CRLF layout: canonical migration, reading/editing, navigation, exact rectangle/connector restoration and reload.');
} finally {
  if (!await enabled()) await setPluginEnabled(true);
  await open('MarginLink Demo.md');
  await page.evaluate(async source => { const f = app.vault.getFileByPath(source); if (f) await app.vault.delete(f); }, source);
  await browser.close();
}
