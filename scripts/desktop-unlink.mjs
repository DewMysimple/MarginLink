/* global app */
// Use a fresh window from scripts/launch-navigation-test.ps1.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
const wait = (predicate, arg) => page.waitForFunction(predicate, arg, {timeout: 8000});
const errors = [];
let vault;
const card = key => page.locator(`.workspace-leaf.mod-active .margin-link-card-shell[data-relation="${key}"] .margin-link-card`);
const unlink = async key => {
  await card(key).click({ button: 'right', timeout: 5000 });
  await page.getByText('取消链接文件', { exact: true }).click();
};
const textAndCount = (text, count, mode) => wait(({ text, count, mode }) => {
  const view = app.workspace.activeLeaf.view;
  return view.getMode?.() === mode && (mode === 'preview' ? view.data : view.editor.getValue()).replace(/\r\n/g, '\n') === text &&
    view.contentEl.querySelectorAll('.margin-link-card').length === count;
}, { text, count, mode });

try {
  await wait(() => window.app?.vault?.adapter);
  const root = path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(root).toLowerCase(), path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(root), /^[a-f0-9]{32}$/);
  vault = root;
  const trust = page.getByRole('button', {name: /信任仓库作者并启用插件|Trust author and enable plugins/i});
  await Promise.race([trust.waitFor(), wait(() => app.plugins.plugins['margin-link'])]);
  if (await trust.isVisible()) await trust.click();
  await wait(() => app.plugins.plugins['margin-link']);
  await page.keyboard.press('Escape');
  page.on('pageerror', err => errors.push(String(err)));
  const host = await page.title();
  const alias = '同一文件', raw = '[[Docs/Target|' + alias + ']]', missing = 'Missing#Heading';
  const original = 'First ' + raw + '\n\nSecond ' + raw + '\n\nThird [[' + missing + ']].';
  const at = original.lastIndexOf(raw), expected = original.slice(0, at) + alias + original.slice(at + raw.length);
  const targetContents = () => page.evaluate(() => app.vault.read(app.vault.getFileByPath('Docs/Target.md')));
  const before = await targetContents();
  for (const display of ['live', 'source', 'reading', 'reading-CRLF']) {
    const mode = display.startsWith('reading') ? 'preview' : 'source';
    const file = 'Unlink-' + display + '.md';
    await page.evaluate(async ({ original, file, mode, display }) => {
      await app.vault.create(file, display === 'reading-CRLF' ? original.replaceAll('\n', '\r\n') : original);
      app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
      await app.workspace.activeLeaf.setViewState({type: 'markdown', state: {file, mode, source: display === 'source'}});
    }, { original, file, mode, display });
    await textAndCount(original, 3, mode);
    const textInView = () => page.evaluate(() => {
      const view = app.workspace.activeLeaf.view;
      return view.getMode() === 'preview' ? view.data : view.editor.getValue();
    });
    const selected = (await textInView()).lastIndexOf(raw);
    await unlink(selected);
    await textAndCount(expected, 2, mode);
    assert.equal(await card(selected).count(), 0);
    await unlink((await textInView()).indexOf('[[' + missing));
    await textAndCount(expected.replace('[[' + missing + ']]', missing), 1, mode);
    await page.evaluate(async () => {
      const view = app.workspace.activeLeaf.view;
      if (view.getMode() === 'preview') await view.setState({ ...view.getState(), mode: 'source' }, {history: false});
      view.editor.focus();
    });
    await page.keyboard.press('Control+z'); await textAndCount(expected, 2, 'source');
    await page.keyboard.press('Control+z'); await textAndCount(original, 3, 'source');
    await page.keyboard.press('Control+y'); await textAndCount(expected, 2, 'source');
    assert.equal(await targetContents(), before);
    console.log(display, 'single occurrence, missing target, undo/redo and target bytes passed');
  }
  await page.evaluate(() => app.plugins.plugins['margin-link'].openSettingsPanel());
  const slider = page.locator('[data-margin-key="edgePadding"] input[type="range"]:visible').first();
  assert.equal(await slider.getAttribute('max'), '300');
  assert.equal(await slider.inputValue(), '16');
  await slider.focus(); await page.keyboard.press('End');
  await wait(async () => (await app.plugins.plugins['margin-link'].loadData()).preferences.edgePadding === 300);
  await page.evaluate(async () => {
    const settings = app.workspace.getLeavesOfType('margin-link-settings')[0];
    settings.detach(); app.workspace.rightSplit.collapse();
    const leaf = app.workspace.getLeavesOfType('markdown')[0];
    app.workspace.setActiveLeaf(leaf, {focus: true});
    await app.plugins.disablePlugin('margin-link');
    await app.plugins.enablePlugin('margin-link');
  });
  await wait(() => {
    const plugin = app.plugins.plugins['margin-link'], view = app.workspace.activeLeaf.view;
    const overlay = plugin?.overlays.get(view);
    if (plugin?.preferences.edgePadding !== 300 || !overlay?.cards.size) return false;
    const x = view.contentEl.getBoundingClientRect().left, body = overlay.layoutInput.body;
    return [...overlay.cards.values()].every(card => {
      const rect = card.button.getBoundingClientRect();
      return (card.placement.side === 'left' ? x + body.left - rect.right : rect.left - x - body.right) >= 299.9;
    });
  });
  const savedOnOpen = await page.evaluate(async () => {
    const plugin = app.plugins.plugins['margin-link'], save = plugin.saveData;
    let writes = 0;
    plugin.saveData = function(data) { writes++; return save.call(this, data); };
    try { await plugin.openSettingsPanel(); await plugin.saving; return writes; }
    finally { plugin.saveData = save; }
  });
  assert.equal(savedOnOpen, 0);
  assert.equal(await slider.inputValue(), '300');
  assert.deepEqual(errors, []);
  console.log(host, '300px slider, save, plugin reload and DOM clearance passed');
} catch (error) {
  if (vault) console.error(await page.evaluate(() => {
    const view = app.workspace.activeLeaf.view, overlay = app.plugins.plugins['margin-link']?.overlays.get(view);
    return { mode: view.getMode?.(), classes: view.containerEl.closest('.workspace-leaf')?.className, source: view.data,
      padding: app.plugins.plugins['margin-link']?.preferences.edgePadding, body: overlay?.layoutInput?.body, left: view.contentEl.getBoundingClientRect().left,
      positions: [...overlay?.cards.values() ?? []].map(c=>[c.placement.side,c.placement.x,c.button.getBoundingClientRect().x,c.button.getBoundingClientRect().width]),
      cards: [...overlay?.cards ?? []].map(([id, c]) => [id, c.anchor.occurrence.raw]),
      sections: [...app.plugins.plugins['margin-link'].reading.entries.values()].filter(e=>view.contentEl.contains(e.element)).map(e=>[e.text===view.data,e.links.map(l=>l.occurrence.start)]),
      links: [...view.contentEl.querySelectorAll('a.internal-link')].map(e => e.textContent),
      notices: [...document.querySelectorAll('.notice')].map(n => n.textContent) };
  }));
  throw error;
} finally {
  if (vault && !page.isClosed()) {
    await page.keyboard.press('Escape');
    await Promise.all([page.waitForEvent('close', {timeout: 7000}), page.locator('.titlebar-button.mod-close').click().catch(e => { if (!page.isClosed()) throw e; })]);
  }
  await browser.close();
}
const saved = JSON.parse(await readFile(path.join(vault, '.obsidian/plugins/margin-link/data.json'), 'utf8'));
assert.equal(saved.preferences.edgePadding, 300);
