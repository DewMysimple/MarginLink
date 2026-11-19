/* global app */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const through = Number(process.argv[2] ?? 20), output = `artifacts/iteration-16-20/actions-${through}`;
await mkdir(output, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase());
const report = { host: await page.title(), through, scenarios: [], errors: [] };
page.on('pageerror', error => report.errors.push(String(error)));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
const frames = (n = 8) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
const check = async (name, fn) => { await fn(); report.scenarios.push({ name, passed: true }); console.log('PASS', name); };
const text = () => page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.getValue());
const base = '# Linking acceptance\n\nSelect streams for linking.\n';
const reset = async (value = base) => {
  await page.evaluate(async value => {
    const plugin = app.plugins.plugins['margin-link']; plugin.selection.cancel();
    Object.assign(plugin.preferences, { enabled: true, lines: 'always', placementMode: 'free' }); await plugin.savePreferences();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const file = app.vault.getFileByPath('Iteration Actions.md') ?? await app.vault.create('Iteration Actions.md', value);
    const leaf = app.workspace.getLeavesOfType('markdown')[0];
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source', source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true }); leaf.view.editor.setValue(value);
    const at = value.indexOf('streams'); leaf.view.editor.setSelection(leaf.view.editor.offsetToPos(at), leaf.view.editor.offsetToPos(at + 7)); leaf.view.editor.focus();
  }, value); await frames(15);
};
const handle = page.locator('.margin-link-handle:visible'), picker = page.locator('.margin-link-file-picker');
const choose = async target => { await picker.getByRole('searchbox', { name: '搜索已有文件' }).fill(target); await picker.getByRole('searchbox').press('Enter'); await picker.waitFor({ state: 'hidden' }); };
try {
  await check('single click links exact selection; one native undo restores it', async () => {
    await reset(); await handle.click(); await picker.waitFor(); assert.equal(await picker.count(), 1);
    await choose('Folder/Note A.md'); assert.equal(await text(), base.replace('streams', '[[Folder/Note A.md|streams]]'));
    await page.keyboard.press('Control+z'); assert.equal(await text(), base);
  });
  await check('cancel and Enter/Space do not duplicate panels or edit source', async () => {
    for (const key of ['Enter', 'Space']) {
      await reset(); await handle.focus(); await page.keyboard.press(key); await picker.waitFor(); assert.equal(await picker.count(), 1);
      await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' }); assert.equal(await text(), base);
    }
  });
  await check('threshold click and irreversible drag-return keep distinct behavior', async () => {
    await reset(); let box = await handle.boundingBox(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 3, y); await page.mouse.up(); await picker.waitFor(); await page.keyboard.press('Escape');
    await reset(); box = await handle.boundingBox(); const xx = box.x + box.width / 2, yy = box.y + box.height / 2;
    await page.mouse.move(xx, yy); await page.mouse.down(); await page.mouse.move(xx + 12, yy); await page.mouse.move(xx, yy); await page.mouse.up(); await frames(); assert.equal(await picker.count(), 0); assert.equal(await text(), base);
  });
  await check('valid margin drag opens once and Escape cancels a gesture', async () => {
    await reset(); let box = await handle.boundingBox(); let x = box.x + box.width / 2, y = box.y + box.height / 2;
    const lane = await page.evaluate(() => { const o = [...app.plugins.plugins['margin-link'].overlays.values()][0], i = o.layoutInput; return { x: o.hostRect.left + (i.viewport.left + i.body.left) / 2, y: o.hostRect.top + (i.viewport.top + i.viewport.bottom) / 2 }; });
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(lane.x, lane.y, { steps: 8 }); await page.mouse.up(); await picker.waitFor(); assert.equal(await picker.count(), 1); await page.keyboard.press('Escape');
    await reset(); box = await handle.boundingBox(); x = box.x + box.width / 2; y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 12, y); await page.keyboard.press('Escape'); await page.mouse.up(); await frames(); assert.equal(await picker.count(), 0);
  });
  await page.screenshot({ path: `${output}/selection.png` });
  if (through >= 17) {
    const sources = path.resolve('test-profile/import-sources'); await mkdir(sources, { recursive: true });
    const hash = value => createHash('sha256').update(value).digest('hex');
    const pathInput = () => picker.getByRole('searchbox', { name: '搜索已有文件' });
    await check('quoted Chinese HTML preview is read-only; move retains bytes and native undo retains attachment', async () => {
      const filename = `中文 streams ${Date.now()}.html`, source = path.join(sources, filename), bytes = Buffer.from('<!doctype html><p>中文 streams</p>');
      await writeFile(source, bytes); await reset(); await handle.click(); await pathInput().fill('"' + source + '"');
      const move = picker.getByRole('button', { name: '移动到仓库并关联', exact: true }); await move.waitFor();
      assert.equal(hash(await readFile(source)), hash(bytes)); await assert.rejects(access(path.join('test-vault', filename)));
      await move.dblclick(); await picker.waitFor({ state: 'hidden' });
      await page.waitForFunction(filename => !!app.vault.getFileByPath(filename), filename);
      for (let i = 0; i < 100; i++) { if (!(await access(source).then(() => true, () => false))) break; await new Promise(resolve => setTimeout(resolve, 30)); }
      await assert.rejects(access(source)); assert.equal(hash(await readFile(path.join('test-vault', filename))), hash(bytes));
      assert.equal(await text(), base.replace('streams', `[[${filename}|streams]]`));
      await page.keyboard.press('Control+z'); assert.equal(await text(), base); assert.equal(hash(await readFile(path.join('test-vault', filename))), hash(bytes));
    });
    await check('raw XMind path preserves binary bytes and original extension', async () => {
      const filename = `binary ${Date.now()}.XMind`, source = path.join(sources, filename), bytes = Buffer.alloc(2 * 1024 * 1024);
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
      await writeFile(source, bytes); await reset(); await handle.click(); await pathInput().fill(source);
      await picker.getByRole('button', { name: '移动到仓库并关联', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
      for (let i = 0; i < 100; i++) { if (!(await access(source).then(() => true, () => false))) break; await new Promise(resolve => setTimeout(resolve, 30)); }
      await assert.rejects(access(source)); assert.equal(hash(await readFile(path.join('test-vault', filename))), hash(bytes));
      assert.equal(await text(), base.replace('streams', `[[${filename}|streams]]`));
    });
    await check('canceling a same-name replacement preserves the attachment, source and selection', async () => {
      const source = path.join(sources, 'Note A.md'); await writeFile(source, 'external original');
      await reset(); await handle.click(); await pathInput().fill(source);
      const before = await readFile(path.resolve('test-vault/Note A.md'));
      await page.locator('.margin-link-confirm').getByRole('button', { name: '取消', exact: true }).click();
      await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' });
      assert.equal(await readFile(source, 'utf8'), 'external original'); assert.equal(await text(), base);
      assert.deepEqual(await readFile(path.resolve('test-vault/Note A.md')), before);
    });
    await check('exact vault path resolves to existing TFile with no move operation', async () => {
      await reset(); await handle.click(); await pathInput().fill('"' + path.resolve('test-vault/References/stages.html') + '"');
      await picker.getByRole('button', { name: '关联此文件', exact: true }).click(); await picker.waitFor({ state: 'hidden' });
      assert.equal(await text(), base.replace('streams', '[[References/stages.html|streams]]'));
    });
    await check('folder path and stale input generation show the current result', async () => {
      await reset(); await handle.click(); await pathInput().fill(path.resolve('test-vault/References'));
      await picker.getByText('该路径是文件夹或特殊文件，请选择普通文件。', { exact: true }).waitFor();
      await pathInput().fill(path.resolve('test-vault/References/stages.html'));
      await pathInput().fill(path.join(sources, 'missing-latest.html'));
      await picker.getByText('源文件或目标目录已不存在。', { exact: true }).waitFor();
      assert.equal(await picker.getByRole('button', { name: '关联此文件', exact: true }).count(), 0); await page.keyboard.press('Escape');
    });
  }
} finally {
  await writeFile(`${output}/results.json`, JSON.stringify(report, null, 2)); await browser.close();
}
