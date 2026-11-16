/* global app */
// node scripts/desktop-relink.mjs [--menu]
// The optional flag requires the final right-click menu; WIP runs exercise the same action directly.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const useMenu = process.argv.includes('--menu');
const output = `artifacts/iteration-16-20/relink-${useMenu ? 'menu' : 'action'}`;
const fixture = 'Relink Acceptance.md';
const old = 'Relink Targets/Old.html', target = 'Relink Targets/New destination.html';
const report = { status: 'running', startedAt: new Date().toISOString(), entry: useMenu ? 'card-context-menu' : 'shared-relink-action', scenarios: [], errors: [] };
let browser, page, preferences, leafId;
await mkdir(output, { recursive: true });
const save = () => writeFile(`${output}/results.json`, JSON.stringify(report, null, 2));
const frames = (n = 8) => page.evaluate(n => new Promise(resolve => { const next = () => --n ? requestAnimationFrame(next) : resolve(); requestAnimationFrame(next); }), n);
const picker = () => page.locator('.margin-link-file-picker');
const currentText = () => page.evaluate(id => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view.editor.getValue(), leafId);
const reset = async (text, mode = 'source') => {
  leafId = await page.evaluate(async ({ fixture, text, mode }) => {
    const plugin = app.plugins.plugins['margin-link']; plugin.selection.cancel(); plugin.layouts.clear(fixture);
    const leaves = app.workspace.getLeavesOfType('markdown');
    const leaf = leaves[0] ?? app.workspace.getLeaf(true);
    for (const other of leaves.slice(1)) other.detach();
    let file = app.vault.getFileByPath(fixture);
    if (!file) file = await app.vault.create(fixture, text);
    await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: 'source', source: false } });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.editor.setValue(text); leaf.view.editor.setCursor({ line: 0, ch: 0 });
    await leaf.view.save();
    leaf.view.editor.focus();
    if (mode === 'preview') await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: 'preview' } });
    return leaf.id;
  }, { fixture, text, mode });
  await page.waitForFunction(({ id, mode }) => [...app.plugins.plugins['margin-link'].overlays].some(([view, overlay]) => view.leaf.id === id && view.getMode() === mode && overlay.cards.size), { id: leafId, mode });
  await frames();
};
const invoke = async (label, index = 0) => {
  const card = await page.evaluate(({ id, label, index, useMenu }) => {
    const plugin = app.plugins.plugins['margin-link'];
    const [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
    const cards = [...overlay.cards.values()].filter(card => card.anchor.occurrence.label === label).sort((a, b) => a.anchor.occurrence.start - b.anchor.occurrence.start);
    const card = cards[index]; if (!card) throw Error(`Missing card ${label}/${index}`);
    if (useMenu) card.shell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 500, clientY: 300 }));
    else plugin.selection.relink(view, card.anchor.occurrence, overlay.bridge());
    return { occurrence: card.anchor.occurrence, unresolved: card.button.classList.contains('margin-link-unresolved') };
  }, { id: leafId, label, index, useMenu });
  if (useMenu) {
    await page.getByText('重新链接文件…', { exact: true }).click();
  }
  await picker().waitFor();
  assert.equal(await picker().count(), 1);
  assert((await picker().innerText()).includes(`当前目标：${card.occurrence.target}`));
  return card;
};
const choose = async targetPath => {
  await picker().getByRole('searchbox', { name: '搜索已有文件' }).fill(targetPath);
  await picker().getByRole('button', { name: targetPath, exact: true }).click();
};
const chosen = async () => { await picker().waitFor({ state: 'hidden' }); await frames(10); };
const nativeHistory = async operation => {
  await page.evaluate(({ id, operation }) => { const editor = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view.editor; editor.focus(); editor[operation](); }, { id: leafId, operation });
  await frames(12);
};
const positions = () => page.evaluate(id => {
  const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
  return [...overlay.cards.values()].sort((a, b) => a.anchor.occurrence.start - b.anchor.occurrence.start).map(card => ({
    raw: card.anchor.occurrence.raw, label: card.anchor.occurrence.label, key: card.anchor.layoutKey,
    position: plugin.layouts.get(view.file.path, card.anchor.layoutKey),
    rect: card.shell.getBoundingClientRect().toJSON(), number: card.shell.dataset.number ?? card.continuation?.[0]?.dataset.number
  }));
}, leafId);
const samePositions = (before, after) => {
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].label, before[i].label);
    assert.equal(after[i].number, before[i].number, `${before[i].label}/${i} changed its displayed occurrence number`);
    assert.deepEqual(after[i].position, before[i].position, `${before[i].label}/${i} lost its manual UI record`);
    assert(Math.abs(after[i].rect.x - before[i].rect.x) <= 1 && Math.abs(after[i].rect.y - before[i].rect.y) <= 1, `${before[i].label}/${i} moved beyond one CSS pixel`);
  }
};
const check = async (name, run) => {
  try { const details = await run(); report.scenarios.push({ name, passed: true, ...details }); console.log('PASS', name); }
  catch (error) {
    report.scenarios.push({ name, passed: false, error: String(error), stack: error.stack });
    console.log('FAIL', name, error.message);
    await page.screenshot({ path: `${output}/failure-${report.scenarios.length}.png` }).catch(() => {});
  } finally { await page.evaluate(() => app.plugins.plugins['margin-link'].selection.cancel()).catch(() => {}); await save(); }
};

try {
  browser = await chromium.connectOverCDP(process.env.MARGINLINK_CDP_URL ?? 'http://127.0.0.1:9223', { timeout: 10000 });
  page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('app://obsidian.md/'));
  assert(page, 'Isolated Obsidian must be running'); page.setDefaultTimeout(5000);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), path.resolve('test-vault').toLowerCase(), 'Refuse all real Vaults');
  await page.waitForFunction(() => !!app.plugins.plugins['margin-link']?.selection?.relink);
  report.host = await page.title(); report.plugin = await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version);
  report.bundleSHA256 = createHash('sha256').update(await readFile('test-vault/.obsidian/plugins/margin-link/main.js')).digest('hex');
  page.on('pageerror', error => report.errors.push(String(error)));
  preferences = await page.evaluate(() => ({ ...app.plugins.plugins['margin-link'].preferences }));
  await page.evaluate(async () => {
    const plugin = app.plugins.plugins['margin-link']; Object.assign(plugin.preferences, { enabled: true, lines: 'numbers', placementMode: 'free', reduceMotion: true }); await plugin.savePreferences();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    if (!app.vault.getFolderByPath('Relink Targets')) await app.vault.createFolder('Relink Targets');
    for (const [name, bytes] of [['Old.html', '<html>old</html>'], ['New destination.html', '<html>new</html>'], ['Without.md', '# Other\n'], ['With.md', '# Known\n\nA block ^known\n']]) {
      const path = 'Relink Targets/' + name, file = app.vault.getFileByPath(path);
      if (file) await app.vault.modify(file, bytes); else await app.vault.create(path, bytes);
    }
  });
  await page.waitForFunction(() => app.metadataCache.getFileCache(app.vault.getFileByPath('Relink Targets/With.md'))?.headings?.length);

  await check('only the second identical occurrence changes; alias, neighboring manual placement and native Undo/Redo stay exact', async () => {
    const original = `# Relink acceptance\n\nBefore [[${old}|streams]] middle [[${old}|streams]] [[${old}|neighbor]] after.\n`;
    await reset(original);
    await page.evaluate(id => {
      const plugin = app.plugins.plugins['margin-link'], [view, overlay] = [...plugin.overlays].find(([view]) => view.leaf.id === id);
      const cards = [...overlay.cards.values()].sort((a, b) => a.anchor.occurrence.start - b.anchor.occurrence.start);
      for (const [index, card] of cards.entries()) plugin.layouts.set(view.file.path, card.anchor.layoutKey, { side: index === 1 ? 'left' : 'right', xNormalized: .4, yOffset: index * 3 });
      plugin.refresh();
    }, leafId); await frames(12);
    const before = await positions();
    const card = await invoke('streams', 1); await choose(target); await chosen();
    const expected = original.slice(0, card.occurrence.start) + `[[${target}|streams]]` + original.slice(card.occurrence.end);
    assert.equal(await currentText(), expected); const after = await positions(); samePositions(before, after);
    await nativeHistory('undo'); assert.equal(await currentText(), original); const undo = await positions(); samePositions(before, undo);
    await nativeHistory('redo'); assert.equal(await currentText(), expected); const redo = await positions(); samePositions(before, redo);
    await page.evaluate(async ({ id, fixture }) => {
      const leaf = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id); await leaf.view.save();
      await leaf.openFile(app.vault.getFileByPath('Relink Targets/Without.md'), { active: true, state: { mode: 'source' } });
      await leaf.setViewState({ type: 'markdown', state: { file: fixture, mode: 'source', source: false } });
      app.workspace.setActiveLeaf(leaf, { focus: true });
    }, { id: leafId, fixture });
    await page.waitForFunction(id => [...app.plugins.plugins['margin-link'].overlays].some(([view, overlay]) => view.leaf.id === id && overlay.cards.size === 3), leafId);
    await frames(12); const reopened = await positions(); samePositions(before, reopened);
    await page.screenshot({ path: `${output}/second-identical.png` });
    return { beforeText: original, afterText: expected, before, after, undo, redo, reopened };
  });
  await check('a link without an explicit alias stays without an alias', async () => {
    const original = `# No alias\n\n[[${old}]]\n`; await reset(original); await invoke(old); await choose(target); await chosen();
    assert.equal(await currentText(), original.replace(old, target));
  });
  for (const [decision, suffix] of [['保留子路径', '#Unknown'], ['移除子路径', ''], ['取消', undefined]]) await check(`unverified heading requires explicit ${decision}`, async () => {
    const original = `# Subpath\n\n[[${old}#Unknown|streams]]\n`; await reset(original); await invoke('streams'); await choose('Relink Targets/Without.md');
    await page.getByRole('button', { name: decision, exact: true }).click();
    if (suffix === undefined) { await frames(); assert.equal(await currentText(), original); assert.equal(await picker().count(), 1); }
    else { await chosen(); assert.equal(await currentText(), `# Subpath\n\n[[Relink Targets/Without.md${suffix}|streams]]\n`); }
  });
  for (const subpath of ['#Known', '#^known']) await check(`verified subpath ${subpath} is preserved without extra confirmation`, async () => {
    const original = `# Verified subpath\n\n[[${old}${subpath}|streams]]\n`; await reset(original); await invoke('streams'); await choose('Relink Targets/With.md'); await chosen();
    assert.equal(await currentText(), original.replace(old, 'Relink Targets/With.md'));
    assert.equal(await page.getByRole('button', { name: '保留子路径', exact: true }).count(), 0);
  });
  await check('an unresolved card can be relinked without creating or deleting its old target', async () => {
    const original = '# Broken target\n\n[[Relink Targets/Does not exist.html|broken]]\n'; await reset(original);
    const card = await invoke('broken'); assert(card.unresolved); await choose(target); await chosen();
    assert.equal(await currentText(), original.replace('Relink Targets/Does not exist.html', target));
    assert.equal(await page.evaluate(() => !!app.vault.getFileByPath('Relink Targets/Does not exist.html')), false);
  });
  await check('reading-mode relink restores the mode and scroll position', async () => {
    const original = `# Reading relink\n\n[[${old}|streams]]\n\n` + 'Paragraph for the reading view.\n\n'.repeat(60);
    await reset(original, 'preview');
    const before = await page.evaluate(id => {
      const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view;
      const outer = view.previewMode.containerEl, scroller = outer.querySelector('.markdown-preview-view') ?? outer;
      scroller.scrollTop = 20; return scroller.scrollTop;
    }, leafId);
    assert(before > 0, 'Reading scroll test must move the actual scroll container');
    await frames(); await invoke('streams'); await choose(target); await chosen();
    const after = await page.evaluate(id => {
      const view = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view;
      const outer = view.previewMode.containerEl, scroller = outer.querySelector('.markdown-preview-view') ?? outer;
      return { mode: view.getMode(), scroll: scroller.scrollTop, text: view.data };
    }, leafId);
    assert.equal(after.mode, 'preview'); assert(Math.abs(after.scroll - before) <= 1, `Reading scroll changed from ${before} to ${after.scroll}`);
    assert.equal(after.text, original.replace(old, target));
    await page.evaluate(async id => {
      const leaf = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id);
      await leaf.setViewState({ type: 'markdown', state: { file: leaf.view.file.path, mode: 'source', source: false } });
    }, leafId); await frames();
    await nativeHistory('undo'); assert.equal(await currentText(), original);
    await nativeHistory('redo'); assert.equal(await currentText(), original.replace(old, target));
    return { beforeScroll: before, after };
  });
  await check('an unsaved edit from a same-note split invalidates the captured occurrence without overwriting either editor', async () => {
    const original = `# Split relink\n\n[[${old}|streams]]\n`; await reset(original);
    const second = await page.evaluate(async ({ id, fixture }) => {
      const first = app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id), other = app.workspace.getLeaf('split');
      await other.setViewState({ type: 'markdown', state: { file: fixture, mode: 'source', source: false } });
      app.workspace.setActiveLeaf(first, { focus: true }); return other.id;
    }, { id: leafId, fixture }); await frames(12);
    await invoke('streams');
    await page.evaluate(id => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view.editor.replaceRange('changed ', { line: 0, ch: 0 }), second);
    await choose(target); await frames();
    const texts = await page.evaluate(({ first, second }) => [first, second].map(id => app.workspace.getLeavesOfType('markdown').find(leaf => leaf.id === id).view.editor.getValue()), { first: leafId, second });
    assert(texts.every(text => text === 'changed ' + original));
    assert.equal(await picker().count(), 1);
    return { editorTexts: texts };
  });
  await check('a failing external path leaves the captured original link untouched', async () => {
    const original = `# Import failure\n\n[[${old}|streams]]\n`; await reset(original); await invoke('streams');
    await picker().getByRole('searchbox', { name: '搜索已有文件' }).fill(path.resolve('test-profile/relink-missing-source.html'));
    await picker().getByText('源文件或目标目录已不存在。', { exact: true }).waitFor();
    assert.equal(await currentText(), original);
    assert.equal(await picker().getByRole('button', { name: '移动到仓库并关联', exact: true }).count(), 0);
  });
  report.status = report.scenarios.every(scenario => scenario.passed) ? 'passed' : 'failed';
  report.finishedAt = new Date().toISOString(); await save();
  assert.equal(report.status, 'passed', 'See individual relink acceptance failures in results.json');
} catch (error) {
  report.status = 'failed'; report.fatal = String(error); await save(); throw error;
} finally {
  if (page && preferences) await page.evaluate(async preferences => { const plugin = app.plugins.plugins['margin-link']; plugin.selection.cancel(); Object.assign(plugin.preferences, preferences); await plugin.savePreferences(); }, preferences).catch(() => {});
  await browser?.close();
}
