/* global app */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const phase = process.argv[2]; assert(['prepare', 'verify'].includes(phase));
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
await page.waitForFunction(() => typeof app !== 'undefined' && app.workspace && app.workspace.getLeavesOfType('markdown').length > 0);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false });
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
const data = async () => JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/data.json', 'utf8'));
const hashes = async () => {
  const paths = await page.evaluate(() => app.vault.getMarkdownFiles().map(f => f.path).sort());
  return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(`test-vault/${path}`)).digest('hex')])));
};
try {
  if (phase === 'prepare') {
    await page.keyboard.press('Control+p'); await page.locator('.prompt-input').fill('Open quick controls'); await page.keyboard.press('Enter');
    const panel = page.locator('.margin-link-quick-controls'); await panel.waitFor();
    await panel.locator('select:not(.is-measuring)').nth(0).selectOption('free'); await panel.locator('select:not(.is-measuring)').nth(1).selectOption('square');
    await page.keyboard.press('Escape');
    const shell = page.locator('.margin-link-card').filter({ hasText: '同名文件' }).locator('..');
    const grip = shell.locator('.margin-link-card-grip'), start = await grip.boundingBox();
    const target = await page.locator('.margin-link-host').evaluate(host => {
      const h = host.getBoundingClientRect(), body = host.querySelector('.cm-content'), b = body.getBoundingClientRect(), s = getComputedStyle(body);
      return { x: (b.right - parseFloat(s.paddingRight) + h.right) / 2, y: h.top + 500 };
    });
    await page.mouse.move(start.x + 8, start.y + 8); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up();
    await page.waitForFunction(() => [...document.querySelectorAll('.margin-link-card-shell')].some(c => c.dataset.manual === 'true'));
    for (let i = 0; i < 30; i++) { const saved = await data(); if (saved.layouts.length) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    await page.evaluate(async () => { await app.workspace.getLeavesOfType('markdown')[0].view.save(); await app.workspace.requestSaveLayout().run(); });
    const saved = await data(); assert(saved.layouts.length > 0);
    await writeFile('artifacts/restart-checkpoint.json', JSON.stringify({ title: await page.title(), data: saved, hashes: await hashes() }, null, 2));
    console.log('Prepared saved layout and Markdown hashes. Close the isolated app, relaunch, then verify.');
  } else {
    await page.waitForSelector('.margin-link-card-shell[data-manual=true]');
    const expected = JSON.parse(await readFile('artifacts/restart-checkpoint.json', 'utf8'));
    assert.deepEqual(await data(), expected.data); assert.deepEqual(await hashes(), expected.hashes);
    await page.screenshot({ path: 'artifacts/v2-restart.png' });
    await writeFile('artifacts/v2-restart.json', JSON.stringify({ passed: true, titleBefore: expected.title, titleAfter: await page.title(), layoutsRestored: expected.data.layouts.length, markdownHashesUnchanged: true }, null, 2));
    console.log('PASS full application exit/relaunch: exact UI data restored, actual manual card visible, all Markdown bytes unchanged.');
  }
} finally { await browser.close(); }
