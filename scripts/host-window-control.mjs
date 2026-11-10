/* global app */
// Read/write only this repository's isolated test vault. Reproduce host diagnostics
// with MarginLink unloaded, using normal native settings controls.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
const open = async label => {
  await page.keyboard.press('Control+,');
  for (let i = 0; i < 100; i++) {
    for (const p of browser.contexts().flatMap(c => c.pages())) if (!p.isClosed() && await p.locator('.vertical-tab-nav-item').first().isVisible()) {
      await p.locator('.vertical-tab-nav-item').filter({ hasText: label }).first().click(); return p;
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Native settings missing');
};
const close = async owner => {
  if (owner === page) await page.keyboard.press('Escape');
  else { await owner.locator('.titlebar-button.mod-close').click(); await page.bringToFront(); }
};
const flip = async (owner, toggle) => {
  const input = toggle.locator('input[type=checkbox]'); await (await input.count() ? input : toggle).focus(); await owner.keyboard.press('Space');
};
let owner = await open(/^(Community plugins|第三方插件)$/);
let toggle = owner.locator('.setting-item').filter({ hasText: 'MarginLink contributors' }).locator('.checkbox-container');
await flip(owner, toggle); await close(owner);
await page.waitForFunction(() => !document.querySelector('.margin-link-overlay'));
const errors = [], runtime = []; let phase = 'start';
const onError = e => errors.push({ phase, message: String(e), stack: e.stack });
page.on('pageerror', onError);
const cdp = await page.context().newCDPSession(page); await cdp.send('Runtime.enable');
cdp.on('Runtime.exceptionThrown', e => runtime.push({ phase, details: e.exceptionDetails }));
try {
  for (let i = 0; i < 2; i++) {
    phase = 'opening editor'; owner = await open(/^(Editor|编辑器)$/);
    toggle = owner.locator('.setting-item').filter({ hasText: /Readable line length|限制行宽/ }).locator('.checkbox-container').first();
    await flip(owner, toggle); phase = 'closing editor'; await close(owner);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(await page.locator('.margin-link-overlay').count(), 0);
  await writeFile('artifacts/v2-host-control.json', JSON.stringify({ title: await page.title(), pluginLoaded: false, action: 'native editor settings toggle/close twice', errors, runtime }, null, 2));
  console.log(`Plugin-unloaded control: ${errors.length} page errors; ${runtime.length} raw diagnostics`);
} finally {
  page.off('pageerror', onError); await cdp.detach();
  owner = await open(/^(Community plugins|第三方插件)$/); toggle = owner.locator('.setting-item').filter({ hasText: 'MarginLink contributors' }).locator('.checkbox-container');
  await flip(owner, toggle); await close(owner); await browser.close();
}
