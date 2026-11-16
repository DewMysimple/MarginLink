/* global app */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const phase = process.argv[2]; assert(['prepare', 'verify'].includes(phase));
const outputPrefix = process.env.MARGINLINK_RESTART_PREFIX ?? 'artifacts/remediation';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace && app.workspace.getLeavesOfType('markdown').length > 0);
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/show-isolated-test.ps1']);
await page.bringToFront();
await page.mouse.up();
await new Promise(resolve => setTimeout(resolve, 350));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
const sources = ['Remediation A.md', 'Remediation B.md'];
const data = async () => {
  for (let i = 0; i < 10; i++) {
    try { return JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/data.json', 'utf8')); }
    catch (error) { if (!(error instanceof SyntaxError) || i === 9) throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
  }
};
const hashes = async () => {
  const paths = await page.evaluate(() => app.vault.getMarkdownFiles().map(f => f.path).sort());
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(`test-vault/${path}`)).digest('hex')])));
};
const open = async source => {
  await page.evaluate(async source => { const leaf = app.workspace.getLeavesOfType('markdown')[0]; await leaf.setViewState({ type: 'markdown', state: { file: source, mode: 'source', source: false } }); app.workspace.setActiveLeaf(leaf, { focus: true }); leaf.view.editor.focus(); delete window.restartStable; }, source);
  await page.waitForSelector('.margin-link-host .margin-link-card');
  await page.waitForFunction(() => {
    const el = document.querySelector('.margin-link-host .margin-link-card-shell');
    if (!el || getComputedStyle(el).visibility === 'hidden') return false;
    const r = el.getBoundingClientRect(), signature = [r.x, r.y, r.width, r.height].join(':');
    const previous = window.restartStable ??= { signature: '', count: 0 };
    previous.count = previous.signature === signature ? previous.count + 1 : 0; previous.signature = signature;
    return previous.count >= 8;
  }, undefined, { polling: 'raf' });
};
const actual = () => page.locator('.margin-link-host .margin-link-card-shell').evaluate(el => ({ manual: el.dataset.manual, shape: el.dataset.shape, rect: el.getBoundingClientRect().toJSON(), line: el.parentElement.querySelector('.margin-link-connector').getAttribute('d') }));
const compare = (value, expected) => {
  assert.equal(value.manual, 'true'); assert.equal(value.shape, expected.shape);
  for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(value.rect[key] - expected.rect[key]) <= 1, `${key}: ${value.rect[key]} != ${expected.rect[key]}`);
  const numbers = value => value.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const v = numbers(value.line), e = numbers(expected.line); assert.equal(v.length, e.length);
  v.forEach((n, i) => assert(Math.abs(n - e[i]) <= 1, `connector coordinate ${i}`));
};
try {
  if (phase === 'prepare') {
    await page.keyboard.press('Control+p'); await page.locator('.prompt-input').fill('Open quick controls'); await page.keyboard.press('Enter');
    const panel = page.locator('.margin-link-quick-controls'); await panel.waitFor();
    await panel.locator('select:not(.is-measuring)').nth(0).selectOption('free'); await panel.locator('select:not(.is-measuring)').nth(1).selectOption('square'); await page.keyboard.press('Escape');
    const positions = {};
    for (const [i, source] of sources.entries()) {
      await open(source);
      assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), source);
      const previousUpdated = await page.evaluate(source => app.plugins.plugins['margin-link'].layouts.snapshot().find(e => e.source === source)?.updated, source);
      const start = await page.locator('.margin-link-host .margin-link-card').boundingBox();
      const target = await page.locator('.margin-link-host').evaluate((host, i) => {
        const h = host.getBoundingClientRect(), body = host.querySelector('.cm-content'), r = body.getBoundingClientRect(), s = getComputedStyle(body);
        return { x: i ? (r.left + parseFloat(s.paddingLeft) + h.left) / 2 : (r.right - parseFloat(s.paddingRight) + h.right) / 2, y: h.top + (i ? 380 : 580) };
      }, i);
      if (Math.hypot(target.x - start.x - start.width / 2, target.y - start.y - start.height / 2) < 40) target.y -= 100;
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 });
      await page.waitForSelector('.margin-link-card-dragging'); await page.mouse.up();
      assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), source);
      await page.waitForFunction(({ source, previousUpdated }) => app.plugins.plugins['margin-link'].layouts.snapshot().some(e => e.source === source && e.updated !== previousUpdated), { source, previousUpdated });
      await open(source); positions[source] = await actual();
    }
    // Observe normal queued persistence without invoking a plugin save function.
    const committed = await page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
    let saved;
    for (let i = 0; i < 40; i++) { saved = await data(); if (JSON.stringify(saved.layouts) === JSON.stringify(committed)) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.deepEqual(saved.layouts, committed);
    await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown')[0].view.save(); await app.workspace.requestSaveLayout().run(); });
    await writeFile('artifacts/restart-checkpoint.json', JSON.stringify({ title: await page.title(), data: saved, hashes: await hashes(), positions }, null, 2));
    console.log('Prepared both source-note positions, actual rectangles/connectors and all Markdown hashes. Close only the isolated app, relaunch, then verify.');
  } else {
    const expected = JSON.parse(await readFile('artifacts/restart-checkpoint.json', 'utf8'));
    assert.deepEqual(await data(), expected.data);
    const positions = {};
    for (const source of sources) { await open(source); positions[source] = await actual(); compare(positions[source], expected.positions[source]); }
    assert.deepEqual(await hashes(), expected.hashes); assert.deepEqual(await data(), expected.data);
    await page.screenshot({ path: `${outputPrefix}-restart.png` });
    await writeFile(`${outputPrefix}-restart.json`, JSON.stringify({ passed: true, titleBefore: expected.title, titleAfter: await page.title(), layoutsRestored: expected.data.layouts.length, positions, markdownHashesUnchanged: true }, null, 2));
    console.log('PASS full isolated application exit/relaunch: both manual rectangles and connector endpoints restored; all Markdown bytes unchanged.');
  }
} finally { await browser.close(); }
