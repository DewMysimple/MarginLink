/* global app */
// Called by desktop-test only after the isolated repository vault is verified.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

export async function runRemediationScenarios({ page, viewport, check, command, persist }) {
  const a = 'Remediation A.md', b = 'Remediation B.md', target = 'Folder/Note A.md';
  const fixtures = {
    [a]: '# Remediation A\n\nSource A has [[Folder/Note A|Shared target]] in its own context.\n',
    [b]: '# Remediation B\n\nSource B independently has [[Folder/Note A|Shared target]] here.\n'
  };
  assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault');
  await page.evaluate(async fixtures => {
    for (const [path, text] of Object.entries(fixtures)) {
      const file = app.vault.getFileByPath(path);
      if (file) await app.vault.modify(file, text); else await app.vault.create(path, text);
    }
  }, fixtures);
  const hashes = async () => {
    const paths = await page.evaluate(() => app.vault.getMarkdownFiles().map(f => f.path).sort());
    return Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(`test-vault/${path}`)).digest('hex')])));
  };
  const beforeHashes = await hashes();
  const observations = [];
  const backCommand = await page.evaluate(() => app.commands.commands['app:go-back'].name);
  const goBack = () => command(backCommand);
  const host = () => page.locator('.margin-link-host').filter({ has: page.locator('.margin-link-card-label', { hasText: 'Shared target' }) }).first();
  const card = () => host().locator('.margin-link-card').first();
  const shell = () => host().locator('.margin-link-card-shell').first();
  const memory = () => page.evaluate(() => app.plugins.plugins['margin-link'].layouts.snapshot());
  const open = async path => {
    await page.keyboard.press('Control+o'); await page.locator('.prompt-input').fill(path); await page.keyboard.press('Enter');
    await page.waitForFunction(path => app.workspace.getLeavesOfType('markdown').some(l => l.view.file?.path === path), path);
  };
  const snapshot = async () => shell().evaluate(el => ({
    rect: el.getBoundingClientRect().toJSON(), side: el.getBoundingClientRect().x < el.parentElement.getBoundingClientRect().x + el.parentElement.getBoundingClientRect().width / 2 ? 'left' : 'right',
    line: el.parentElement.querySelector('.margin-link-connector')?.getAttribute('d'), manual: el.dataset.manual
  }));
  const stable = async () => {
    await card().waitFor({ state: 'visible' });
    await page.evaluate(() => { delete window.marginRemediationStability; });
    await page.waitForFunction(() => {
      const card = [...document.querySelectorAll('.margin-link-host .margin-link-card')].find(e => e.textContent.includes('Shared target'));
      if (!card || getComputedStyle(card).visibility === 'hidden') return false;
      const rect = card.getBoundingClientRect(), host = card.closest('.margin-link-host').getBoundingClientRect(), value = [rect.x, rect.y, rect.width, rect.height, host.width].join(':');
      const state = window.marginRemediationStability ??= { value: '', count: 0 };
      state.count = state.value === value ? state.count + 1 : 0; state.value = value;
      return state.count >= 8;
    }, undefined, { polling: 'raf' });
  };
  const same = (actual, expected) => {
    assert.equal(actual.side, expected.side);
    for (const key of ['x', 'y', 'width', 'height']) assert(Math.abs(actual.rect[key] - expected.rect[key]) <= 1, `${key}: ${actual.rect[key]} != ${expected.rect[key]}`);
    const numbers = value => value.match(/-?\d+(?:\.\d+)?/g).map(Number);
    assert.equal(numbers(actual.line).length, numbers(expected.line).length);
    numbers(actual.line).forEach((value, i) => assert(Math.abs(value - numbers(expected.line)[i]) <= 1, `connector coordinate ${i}`));
  };
  const closePanel = async () => {
    await page.evaluate(() => { for (const leaf of app.workspace.getLeavesOfType('margin-link-settings')) leaf.detach(); app.workspace.rightSplit.collapse(); });
    await page.waitForFunction(() => !document.querySelector('.margin-link-settings-view'));
    await stable();
  };
  const ribbon = () => page.locator('.side-dock-ribbon-action[aria-label="打开 MarginLink 设置"]');
  const panel = () => page.locator('.margin-link-settings-view');
  const configure = async values => {
    await ribbon().click(); await panel().waitFor({ state: 'visible' });
    for (const [key, value] of Object.entries(values)) await panel().locator(`[data-margin-key="${key}"] select:not(.is-measuring)`).selectOption(value);
    await closePanel();
  };
  const point = async (side, y = 540) => host().evaluate((el, { side, y }) => {
    const h = el.getBoundingClientRect(), body = [...el.querySelectorAll('.cm-content, .markdown-preview-sizer')].find(e => e.getBoundingClientRect().width);
    const r = body.getBoundingClientRect(), s = getComputedStyle(body), left = r.left + parseFloat(s.paddingLeft || 0), right = r.right - parseFloat(s.paddingRight || 0);
    return { x: side === 'left' ? (h.left + left) / 2 : (right + h.right) / 2, y: h.top + Math.min(y, h.height - 100) };
  }, { side, y });
  const begin = async (side, y = 540, part = 'filename') => {
    await stable();
    const bounds = await card().boundingBox();
    const child = part === 'icon' ? card().locator('.margin-link-card-icon') : part === 'filename' ? card().locator('.margin-link-card-label') : undefined;
    const childBounds = child ? await child.boundingBox() : undefined;
    const start = childBounds && childBounds.width > 0 && childBounds.height > 0
      ? { x: childBounds.x + childBounds.width / 2, y: childBounds.y + childBounds.height / 2 }
      : { x: bounds.x + bounds.width - 6, y: bounds.y + bounds.height - 6 };
    const destination = await point(side, y);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(destination.x, destination.y, { steps: 10 });
    await page.waitForSelector('.margin-link-card-dragging');
    return snapshot();
  };
  const drop = async (side, y, part) => { const expected = await begin(side, y, part); await page.mouse.up(); await stable(); same(await snapshot(), expected); return snapshot(); };
  const safe = async () => {
    const issue = await host().evaluate(el => {
      const h = el.getBoundingClientRect(), body = [...el.querySelectorAll('.cm-content, .markdown-preview-sizer')].find(e => e.getBoundingClientRect().width);
      const r = body.getBoundingClientRect(), s = getComputedStyle(body), left = r.left + parseFloat(s.paddingLeft || 0), right = r.right - parseFloat(s.paddingRight || 0);
      return [...el.querySelectorAll('.margin-link-card-shell')].filter(e => getComputedStyle(e).visibility !== 'hidden').some(e => { const c = e.getBoundingClientRect(); return c.left < h.left - 1 || c.right > h.right + 1 || c.top < h.top - 1 || c.bottom > h.bottom + 1 || (c.left < right - 1 && c.right > left + 1); });
    }); assert.equal(issue, false, 'Card must stay in its own legal margin');
  };
  await viewport(1980); await open(a);
  await page.evaluate(async a => { await app.workspace.getLeavesOfType('markdown')[0].setViewState({ type: 'markdown', state: { file: a, mode: 'source', source: false } }); }, a);
  await stable();
  await check('remediation: Ribbon opens full right settings once, reopens after close, and applies immediately', async () => {
    await page.evaluate(() => app.workspace.rightSplit.collapse());
    await ribbon().click(); await panel().waitFor({ state: 'visible' });
    await ribbon().evaluate(el => { el.click(); el.click(); });
    assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('margin-link-settings').length), 1);
    assert.equal(await panel().count(), 1);
    assert.equal(await panel().locator('h3').count(), 5);
    await panel().locator('[data-margin-key="placementMode"] select:not(.is-measuring)').selectOption('free');
    await panel().locator('[data-margin-key="lines"] select:not(.is-measuring)').selectOption('always');
    await panel().locator('[data-margin-key="lineStyle"] select:not(.is-measuring)').selectOption('straight');
    await page.waitForFunction(() => document.querySelector('.margin-link-host .margin-link-connector')?.getAttribute('d').includes(' L '));
    await page.screenshot({ path: 'artifacts/remediation-settings.png' });
    await page.keyboard.press('Control+w');
    await panel().waitFor({ state: 'detached' }); await stable();
    await ribbon().click(); await panel().waitFor();
    assert.equal(await panel().locator('[data-margin-key="placementMode"] select:not(.is-measuring)').inputValue(), 'free');
    await closePanel();
  });
  await check('remediation: icon, filename and blank card regions drag in horizontal/square/icon appearances', async () => {
    for (const cardShape of ['horizontal', 'square', 'icon']) {
      await configure({ cardShape });
      assert.equal(await page.locator('.margin-link-card-grip').count(), 0);
      for (const [i, part] of ['icon', 'filename', 'blank'].entries()) {
        await drop(i % 2 ? 'left' : 'right', 400 + i * 100, part);
        assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), a);
      }
    }
    await configure({ cardShape: 'horizontal' });
  });
  await check('remediation: Esc, pointer cancellation, blur and body drops restore exact card and line', async () => {
    const before = await snapshot(), saved = await memory();
    for (const reason of ['Escape', 'pointercancel', 'blur', 'body']) {
      await begin('left', 350);
      if (reason === 'Escape') await page.keyboard.press('Escape');
      if (reason === 'pointercancel') await card().evaluate(el => el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
      if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (reason === 'body') { const body = await host().locator('.cm-content').boundingBox(); await page.mouse.move(body.x + body.width / 2, body.y + 150); }
      await page.mouse.up(); await stable(); same(await snapshot(), before); assert.deepEqual(await memory(), saved);
    }
    await card().click(); await page.waitForFunction(target => app.workspace.getLeavesOfType('markdown')[0].view.file.path === target, target);
    await goBack(); await stable(); same(await snapshot(), before);
  });
  let aPosition, bPosition;
  await check('remediation: immediate A→B→A keeps independent shared-target locations without flush or debounce waits', async () => {
    aPosition = await begin('right', 580, 'filename'); await page.mouse.up();
    // Deliberately no frames, save, data-file polling or delay between drop and navigation.
    await open(b); await stable();
    bPosition = await begin('left', 390, 'icon'); await page.mouse.up();
    await open(a); await stable(); same(await snapshot(), aPosition);
    await open(b); await stable(); same(await snapshot(), bPosition);
    await open(a); await stable(); same(await snapshot(), aPosition);
    assert.deepEqual(new Set((await memory()).map(e => e.source)), new Set([a, b]));
    observations.push({ scenario: 'immediate navigation', a: await snapshot(), b: bPosition, layouts: await memory() });
  });
  await check('remediation: delayed real document loading cannot reconcile old editor links under a new source', async () => {
    await page.evaluate(({ a, b }) => {
      window.marginOriginalReads = {};
      for (const method of ['read', 'cachedRead']) {
        const original = app.vault[method]; window.marginOriginalReads[method] = original;
        app.vault[method] = async function(file, ...args) { if ([a, b].includes(file.path)) await new Promise(resolve => setTimeout(resolve, 120)); return original.call(this, file, ...args); };
      }
    }, { a, b });
    try {
      aPosition = await begin('right', 610, 'blank'); await page.mouse.up(); await open(b); await stable(); same(await snapshot(), bPosition);
      await open(a); await stable(); same(await snapshot(), aPosition);
      observations.push({ scenario: '120ms Vault read loading delay', a: await snapshot(), layouts: await memory() });
    } finally {
      await page.evaluate(() => { for (const [method, original] of Object.entries(window.marginOriginalReads)) app.vault[method] = original; delete window.marginOriginalReads; });
    }
  });
  await check('remediation: normal click opens target, native Back and close/reopen restore exact placement', async () => {
    await card().locator('.margin-link-card-label').click(); await page.waitForFunction(target => app.workspace.getLeavesOfType('markdown')[0].view.file.path === target, target);
    await goBack(); await stable(); same(await snapshot(), aPosition);
    await page.keyboard.press('Control+w'); await open(a); await stable(); same(await snapshot(), aPosition);
    await card().click({ modifiers: ['Control'] }); await page.waitForFunction(target => app.workspace.getLeavesOfType('markdown').some(l => l.view.file?.path === target), target);
    await page.keyboard.press('Control+w'); await open(a); await stable(); same(await snapshot(), aPosition);
  });
  await check('remediation: reading/editing transitions and narrow/expanded sidebars preserve UI records and anchor endpoints', async () => {
    const saved = await memory();
    await page.evaluate(async () => { const l = app.workspace.getLeavesOfType('markdown')[0]; await l.setViewState({ type: 'markdown', state: { file: l.view.file.path, mode: 'preview' } }); });
    await stable(); assert.equal((await snapshot()).manual, 'true'); await safe();
    await page.evaluate(async () => { const l = app.workspace.getLeavesOfType('markdown')[0]; await l.setViewState({ type: 'markdown', state: { file: l.view.file.path, mode: 'source', source: false } }); });
    await stable(); same(await snapshot(), aPosition);
    await ribbon().click(); await panel().waitFor({ state: 'visible' }); await stable(); await safe();
    await page.evaluate(() => app.workspace.rightSplit.collapse()); await stable(); same(await snapshot(), aPosition);
    await page.evaluate(() => { for (const l of app.workspace.getLeavesOfType('margin-link-settings')) l.detach(); });
    await viewport(820); await page.waitForFunction(() => document.querySelectorAll('.margin-link-host .margin-link-card').length === 0);
    await viewport(1980); await stable(); same(await snapshot(), aPosition); assert.deepEqual(await memory(), saved);
  });
  await check('remediation: unrelated attachment rename/delete preserves both notes; focused card owns keyboard controls', async () => {
    const saved = await memory();
    await page.evaluate(async () => { const f = await app.vault.create('Remediation attachment.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'); await app.vault.rename(f, 'Remediation renamed.svg'); await app.vault.delete(f); });
    await stable(); assert.deepEqual(await memory(), saved); same(await snapshot(), aPosition);
    await card().focus(); assert.equal(await card().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('ArrowDown'); await stable(); assert((await snapshot()).rect.y > aPosition.rect.y);
    await page.keyboard.press('Shift+ArrowLeft'); await stable(); assert.equal((await snapshot()).side, 'left');
    await page.keyboard.press('Delete'); await stable(); assert.equal((await snapshot()).manual, 'false');
    assert((await memory()).some(e => e.source === b));
    await page.keyboard.press('Enter'); await page.waitForFunction(target => app.workspace.getLeavesOfType('markdown')[0].view.file.path === target, target);
    await goBack(); await stable(); aPosition = await drop('right', 580, 'filename');
  });
  await check('remediation: removing native Wikilink removes its card and cannot resurrect it from saved UI data', async () => {
    await page.evaluate(({ a, fixtures }) => { const l = app.workspace.getLeavesOfType('markdown')[0]; if (l.view.file.path !== a) throw new Error('Wrong source'); l.view.editor.setValue(fixtures[a].replace('[[Folder/Note A|Shared target]]', 'removed target')); }, { a, fixtures });
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-host .margin-link-card').length === 0);
    await command('Refresh margin links'); assert.equal(await page.locator('.margin-link-host .margin-link-card').count(), 0);
    await page.evaluate(({ a, fixtures }) => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(fixtures[a]), { a, fixtures });
    await stable(); await persist();
    assert.deepEqual(await hashes(), beforeHashes);
  });
  await check('remediation: CRLF occurrence identity survives editing/reading despite native host newline normalization', async () => {
    const crlf = 'Remediation CRLF.md', raw = '# CRLF fixture\r\n\r\nA [[Folder/Note A|Shared target]] with a Windows line ending.\r\n';
    await page.evaluate(async ({ crlf, raw }) => { await app.vault.create(crlf, raw); }, { crlf, raw });
    try {
      await open(crlf); await stable();
      const placed = await drop('right', 560, 'filename');
      assert.equal(await readFile(`test-vault/${crlf}`, 'utf8'), raw, 'Dragging alone must preserve CRLF bytes');
      const record = (await memory()).find(e => e.source === crlf); assert(record);
      await page.evaluate(async crlf => { await app.workspace.getLeavesOfType('markdown')[0].setViewState({ type: 'markdown', state: { file: crlf, mode: 'preview' } }); }, crlf);
      await stable(); assert.equal((await snapshot()).manual, 'true'); await safe();
      assert.deepEqual((await memory()).find(e => e.source === crlf), record);
      await page.evaluate(async crlf => { await app.workspace.getLeavesOfType('markdown')[0].setViewState({ type: 'markdown', state: { file: crlf, mode: 'source', source: false } }); }, crlf);
      await stable(); same(await snapshot(), placed);
      await open(a); await stable();
      const returned = await readFile(`test-vault/${crlf}`, 'utf8');
      // Obsidian 1.10.6 also normalizes CRLF on source→preview with the plugin
      // disabled. The independent control is artifacts/crlf-host-control.json.
      assert.equal(returned, raw.replace(/\r\n/g, '\n'));
      observations.push({ scenario: 'CRLF reading/editing', layoutRestored: true, dragPreservedRawBytes: true, hostNormalizedNewlines: true, beforeSHA256: createHash('sha256').update(raw).digest('hex'), afterSHA256: createHash('sha256').update(returned).digest('hex') });
    } finally {
      await open(a); await stable();
      await page.evaluate(async crlf => { const f = app.vault.getFileByPath(crlf); if (f) await app.vault.delete(f); }, crlf);
    }
    assert.deepEqual(await hashes(), beforeHashes);
  });
  await check('remediation: current-note reset follows the most recently operated split while the settings panel stays open', async () => {
    await drop('right', 580, 'filename');
    const aRecord = (await memory()).find(e => e.source === a);
    await viewport(3200); await stable();
    await page.evaluate(async b => { await app.workspace.getLeaf('split').openFile(app.vault.getFileByPath(b)); }, b);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-host .margin-link-card').length === 2);
    await page.evaluate(a => { const l = app.workspace.getLeavesOfType('markdown').find(l => l.view.file?.path === a); app.workspace.setActiveLeaf(l, { focus: true }); }, a);
    await ribbon().click(); await panel().waitFor({ state: 'visible' });
    const bContent = page.locator('.workspace-leaf-content[data-type="markdown"]').filter({ has: page.locator('.cm-content', { hasText: 'Source B independently' }) }).locator('.cm-content');
    await bContent.click();
    await panel().getByRole('button', { name: '整理当前笔记', exact: true }).click();
    await page.locator('.margin-link-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForFunction(b => !app.plugins.plugins['margin-link'].layouts.snapshot().some(e => e.source === b), b);
    assert.deepEqual((await memory()).find(e => e.source === a), aRecord);
    await page.evaluate(a => { for (const l of app.workspace.getLeavesOfType('markdown')) if (l.view.file?.path !== a) l.detach(); }, a);
    await closePanel(); await viewport(1980); await stable();
    assert.deepEqual(await hashes(), beforeHashes);
  });
  await writeFile('artifacts/desktop-remediation.json', JSON.stringify({ host: await page.title(), pluginVersion: JSON.parse(await readFile('manifest.json', 'utf8')).version, observations, markdownHashesUnchanged: true }, null, 2));
  await page.screenshot({ path: 'artifacts/remediation-final.png' });
  await open('MarginLink Demo.md'); await viewport(1680); await persist();
}
