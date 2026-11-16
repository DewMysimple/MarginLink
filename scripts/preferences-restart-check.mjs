/* global app */
// Run prepare <case>, exit/relaunch the isolated application normally, then verify.
// This helper never restarts/kills the app itself and never changes Markdown.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [phase, caseName] = process.argv.slice(2);
const valid = { lines: 'hover', placementMode: 'auto', cardShape: 'horizontal' };
const defaults = { lines: 'always', placementMode: 'free', cardShape: 'square' };
const cases = {
  'flat-valid': { value: { ...valid, layout: 'right' }, expected: { ...valid, layout: 'right' } },
  'nested-valid': { value: { schemaVersion: 2, preferences: { ...valid, lineStyle: 'elbow' }, layouts: [] }, expected: { ...valid, lineStyle: 'elbow' } },
  missing: { value: { schemaVersion: 2, preferences: { lines: 'hover', cardShape: 'horizontal' }, layouts: [] }, expected: { ...valid, placementMode: 'free' } },
  invalid: { value: { schemaVersion: 2, preferences: { lines: 'invalid', placementMode: 4, cardShape: null, layout: 'left' }, layouts: [] }, expected: { ...defaults, layout: 'left' } },
  defaults: { value: undefined, expected: defaults }
};
assert(['prepare', 'verify'].includes(phase), 'Use prepare <flat-valid|nested-valid|missing|invalid|defaults> or verify');
if (phase === 'prepare') assert(Object.hasOwn(cases, caseName), 'Unknown fixture');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  assert(page, 'Isolated Obsidian missing');
  await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace && app.vault);
  assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Never use a real vault');
  const dataPath = 'test-vault/.obsidian/plugins/margin-link/data.json';
  const expectedPath = 'artifacts/preferences-restart-expected.json', reportPath = 'artifacts/preferences-restart.json';
  const bundleHash = async () => createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  const hashes = async () => {
    const files = await page.evaluate(() => app.vault.getMarkdownFiles().map(f => f.path).sort());
    return Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(path.join('test-vault', file))).digest('hex')])));
  };
  const observe = async () => {
    await page.waitForFunction(() => app.plugins.plugins['margin-link']);
    const preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
    await page.locator('.side-dock-ribbon-action[aria-label="打开 MarginLink 设置"]').click();
    const panel = page.locator('.margin-link-settings-view'); await panel.waitFor({ state: 'visible' });
    const values = await panel.evaluate(el => ({ heading: el.querySelector('h2').textContent, fields: Object.fromEntries(['lines', 'placementMode', 'cardShape'].map(key => {
      const s = el.querySelector(`[data-margin-key="${key}"] select:not(.is-measuring)`);
      return [key, { value: s.value, text: s.selectedOptions[0].textContent }];
    })) }));
    await page.evaluate(() => { for (const leaf of app.workspace.getLeavesOfType('margin-link-settings')) leaf.detach(); app.workspace.rightSplit.collapse(); });
    assert.equal(values.heading, 'MarginLink');
    for (const key of ['lines', 'placementMode', 'cardShape']) assert.equal(values.fields[key].value, preferences[key]);
    return { preferences, values, title: await page.title() };
  };
  if (phase === 'prepare') {
    const fixture = cases[caseName], beforeHashes = await hashes();
    await page.evaluate(async () => { for (const l of app.workspace.getLeavesOfType('margin-link-settings')) l.detach(); await app.plugins.disablePluginAndSave('margin-link'); });
    await page.waitForFunction(() => !document.querySelector('.margin-link-overlay'));
    if (fixture.value === undefined) await unlink(dataPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    else await writeFile(dataPath, JSON.stringify(fixture.value));
    await page.evaluate(async () => app.plugins.enablePluginAndSave('margin-link'));
    const before = await observe();
    for (const [key, value] of Object.entries(fixture.expected)) assert.equal(before.preferences[key], value);
    assert.deepEqual(await hashes(), beforeHashes);
    await page.evaluate(async () => { for (const l of app.workspace.getLeavesOfType('markdown')) await l.view.save(); await app.workspace.requestSaveLayout().run(); });
    await writeFile(expectedPath, JSON.stringify({ caseName, expected: fixture.expected, before, markdownHashes: beforeHashes, bundleSHA256: await bundleHash() }, null, 2));
    console.log(`PREPARED ${caseName}: close the isolated app normally, relaunch, then verify.`);
  } else {
    const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
    assert.equal(await bundleHash(), expected.bundleSHA256);
    const after = await observe();
    for (const [key, value] of Object.entries(expected.expected)) assert.equal(after.preferences[key], value);
    assert.deepEqual(after.preferences, expected.before.preferences);
    assert.deepEqual(after.values, expected.before.values); assert.deepEqual(await hashes(), expected.markdownHashes);
    let report = { cases: [] };
    try { report = JSON.parse(await readFile(reportPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    report.cases = report.cases.filter(c => c.name !== expected.caseName);
    report.cases.push({ name: expected.caseName, passed: true, bundleSHA256: expected.bundleSHA256, before: expected.before, after, markdownHashesUnchanged: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`PASS normal application restart: ${expected.caseName}; preferences/UI/Markdown unchanged.`);
  }
} finally { await browser.close(); }
