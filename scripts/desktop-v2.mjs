/* global app */
// This module is invoked only after desktop-test.mjs verifies the isolated vault.
import assert from 'node:assert/strict';
import { readFile, unlink } from 'node:fs/promises';
export async function runV2Scenarios({ page, cdp, viewport, check, command, mode, persist, settings, closeSettings, flipToggle, phase }) {
  const note = 'MarginLink Demo.md';
  const diskText = () => readFile(`test-vault/${note}`, 'utf8');
  const data = async () => {
    for (let i = 0; i < 10; i++) {
      try { return JSON.parse(await readFile('test-vault/.obsidian/plugins/margin-link/data.json', 'utf8')); }
      catch (error) { if (!(error instanceof SyntaxError) || i === 9) throw error; await new Promise(resolve => setTimeout(resolve, 20)); }
    }
  };
  const waitData = async predicate => {
    let last;
    for (let i = 0; i < 40; i++) {
      last = await data(); if (predicate(last)) return last;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`UI data did not settle: ${JSON.stringify(last)}`);
  };
  const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const quick = async () => { await command('Open quick controls'); await page.waitForSelector('.margin-link-quick-controls'); return page.locator('.margin-link-quick-controls'); };
  const full = async () => { const q = await quick(); await q.getByRole('button', { name: '打开完整设置', exact: true }).click(); await page.waitForSelector('.margin-link-full-controls'); return page.locator('.margin-link-full-controls'); };
  const configure = async values => {
    const panel = await full();
    for (const [key, value] of Object.entries(values)) {
      const row = panel.locator(`[data-margin-key="${key}"]`);
      if (typeof value === 'number') await row.locator('input[type=range]').evaluate((e, value) => { e.value = String(value); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, value);
      else if (typeof value === 'boolean') {
        const toggle = row.locator('.checkbox-container'), input = toggle.locator('input[type=checkbox]');
        const checked = await input.count() ? await input.isChecked() : (await toggle.getAttribute('aria-checked')) === 'true';
        if (checked !== value) await flipToggle(page, toggle);
      }
      else await row.locator('select:not(.is-measuring)').selectOption(value);
    }
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' }); await frames();
  };
  const card = (label = '同名文件') => page.locator('.margin-link-card').filter({ hasText: label }).first();
  const shell = (label = '同名文件') => card(label).locator('..');
  const grip = (label = '同名文件') => shell(label).locator('.margin-link-card-grip');
  const bounds = async () => page.locator('.margin-link-host').first().evaluate(el => {
    const host = el.getBoundingClientRect();
    const body = [...el.querySelectorAll('.cm-content, .markdown-preview-sizer')].find(b => b.getBoundingClientRect().width > 0); const r = body.getBoundingClientRect(), style = getComputedStyle(body);
    return { x: host.x, y: host.y, width: host.width, height: host.height, left: r.left + (parseFloat(style.paddingLeft) || 0), right: r.right - (parseFloat(style.paddingRight) || 0) };
  });
  const point = async (side, y = 500) => { const b = await bounds(); return { x: side === 'left' ? (b.x + b.left) / 2 : (b.right + b.x + b.width) / 2, y: b.y + Math.min(y, b.height - 90) }; };
  const beginDrag = async (label, destination) => {
    const b = await grip(label).boundingBox(); assert(b, 'Move grip must be visible');
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 12 });
  };
  const drag = async (label, side, y = 500) => { await beginDrag(label, await point(side, y)); await page.mouse.up(); await frames(); };
  const assertSafe = async () => {
    const issues = await page.locator('.margin-link-host').evaluateAll(hosts => hosts.flatMap(host => {
      if (getComputedStyle(host.querySelector('.margin-link-overlay')).visibility === 'hidden') return [];
      const r = host.getBoundingClientRect(), body = [...host.querySelectorAll('.cm-content, .markdown-preview-sizer')].find(b => b.getBoundingClientRect().width > 0); if (!body) return [];
      const b = body.getBoundingClientRect(), s = getComputedStyle(body), left = b.left + (parseFloat(s.paddingLeft) || 0), right = b.right - (parseFloat(s.paddingRight) || 0);
      const cards = [...host.querySelectorAll('.margin-link-card-shell')].map(e => e.getBoundingClientRect());
      return cards.flatMap((c, i) => {
        const bad = [];
        if (c.left < r.left - 1 || c.right > r.right + 1 || c.top < r.top - 1 || c.bottom > r.bottom + 1) bad.push(`pane bounds ${i}`);
        if (c.left < right - 1 && c.right > left + 1) bad.push(`body overlap ${i}`);
        if (cards.some((other, j) => j < i && c.left < other.right && c.right > other.left && c.top < other.bottom && c.bottom > other.top)) bad.push(`collision ${i}`);
        return bad;
      });
    })); assert.deepEqual(issues, []);
  };
  const setText = async text => { await page.evaluate(text => { const e = app.workspace.getLeavesOfType('markdown')[0].view.editor; e.setValue(text); e.setCursor({ line: 0, ch: 0 }); e.focus(); }, text); await frames(); };
  await viewport(1980); await mode('source', false); await persist();
  const original = await diskText();
  await check('v2: native grouped settings, quick/full controls share migrated preferences and preview', async () => {
    const owner = await settings('MarginLink');
    await owner.locator('.margin-link-settings').waitFor();
    assert.equal(await owner.locator('.margin-link-settings h3').count(), 5);
    assert.equal(await owner.locator('[data-margin-key="layout"] select:not(.is-measuring)').inputValue(), 'balanced');
    assert.equal(await owner.locator('[data-margin-key="placementMode"] select:not(.is-measuring)').inputValue(), 'auto');
    await owner.locator('[data-margin-key="lineStyle"] select:not(.is-measuring)').selectOption('elbow');
    assert((await owner.locator('.margin-link-settings-preview path.margin-link-connector').getAttribute('d')).includes(' H '));
    await closeSettings(owner);
    const panel = await full(); assert.equal(await panel.locator('[data-margin-key="lineStyle"] select:not(.is-measuring)').inputValue(), 'elbow');
    await page.keyboard.press('Escape'); assert.equal(await diskText(), original);
  });
  await check('v2: all line modes/styles, widths, opacity and preset color render immediately', async () => {
    for (const lineStyle of ['curve', 'straight', 'elbow']) {
      await configure({ lines: 'always', lineStyle, lineWidth: 4, lineOpacity: 0.6, lineColor: 'blue' });
      await page.mouse.move(20, 30);
      await page.waitForFunction(() => getComputedStyle(document.querySelector('.margin-link-connector')).opacity === '0.6');
      const properties = await page.locator('.margin-link-connector').first().evaluate(p => ({ d: p.getAttribute('d'), width: getComputedStyle(p).strokeWidth, opacity: getComputedStyle(p).opacity, color: getComputedStyle(p).stroke }));
      assert(properties.d.includes(lineStyle === 'curve' ? ' C ' : lineStyle === 'straight' ? ' L ' : ' H '));
      assert.equal(properties.width, '4px'); assert.equal(properties.opacity, '0.6'); assert(properties.color.startsWith('rgb'));
    }
    await configure({ lines: 'none' }); await card().hover();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.margin-link-connector')).opacity === '0');
    assert.equal(await page.locator('.margin-link-connector').first().evaluate(p => getComputedStyle(p).opacity), '0');
    assert.equal(await page.locator('.margin-link-card').count(), 7);
    await configure({ lines: 'hover' }); await card().hover();
    assert.equal(await page.locator('.margin-link-connector.margin-link-active').count(), 1);
    await configure({ lines: 'always', lineWidth: 1.5, lineOpacity: 0.65, lineColor: 'theme' });
    assert.equal(await diskText(), original);
  });
  await check('v2: horizontal/square/icon in all sizes match actual model geometry', async () => {
    for (const cardShape of ['horizontal', 'square', 'icon']) for (const cardSize of ['small', 'medium', 'large']) {
      await configure({ cardShape, cardSize });
      const actual = await shell().boundingBox(); assert(actual.width >= 32);
      assert.equal(await shell().getAttribute('data-shape'), cardShape);
      if (cardShape !== 'horizontal') assert.equal(actual.width, actual.height);
      await assertSafe();
    }
    await configure({ cardShape: 'horizontal', cardSize: 'medium', placementMode: 'free' });
  });
  await check('v2: real 2D card drag updates its connector, saves UI only and survives refresh/reload', async () => {
    const before = await shell().boundingBox(); const oldPath = await shell().evaluate(e => e.parentElement.querySelectorAll('path')[1]?.getAttribute('d'));
    await drag('同名文件', 'right', 600);
    await waitData(d => d.layouts.length === 1);
    const after = await shell().boundingBox(); assert(Math.hypot(after.x - before.x, after.y - before.y) > 40);
    assert.equal(await shell().getAttribute('data-manual'), 'true');
    assert.notEqual(await shell().evaluate(e => e.parentElement.querySelectorAll('path')[1]?.getAttribute('d')), oldPath);
    const saved = (await data()).layouts;
    assert.equal(saved[0].side, 'right'); assert(!JSON.stringify(saved).includes('同名文件'));
    await command('Refresh margin links'); await frames(); assert.deepEqual((await data()).layouts, saved);
    await persist(); await page.reload(); await page.waitForSelector('.margin-link-card');
    assert.equal(await shell().getAttribute('data-manual'), 'true'); assert.deepEqual((await data()).layouts, saved);
    const restored = await shell().boundingBox(); assert(Math.abs(restored.x - after.x) < 2 && Math.abs(restored.y - after.y) < 2);
    await assertSafe(); assert.equal(await diskText(), original);
  });
  await check('v2: Esc, pointercancel, blur, invalid drop and grip click cancel without writes', async () => {
    const saved = (await data()).layouts, before = await shell().boundingBox();
    for (const reason of ['Escape', 'pointercancel', 'blur', 'invalid']) {
      await beginDrag('同名文件', await point('left', 300));
      if (reason === 'Escape') await page.keyboard.press('Escape');
      if (reason === 'pointercancel') await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
      if (reason === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      if (reason === 'invalid') { const b = await bounds(); await page.mouse.move((b.left + b.right) / 2, b.y + 350); }
      await page.mouse.up(); await frames();
      assert.equal(await page.locator('.margin-link-card-dragging').count(), 0);
      assert.deepEqual((await data()).layouts, saved);
      const actual = await shell().boundingBox(); assert(Math.abs(actual.x - before.x) < 2 && Math.abs(actual.y - before.y) < 2);
    }
    await grip().click(); assert.equal(await page.locator('.prompt-input').count(), 0); assert.deepEqual((await data()).layouts, saved);
    assert.equal(await diskText(), original);
  });
  await check('v2: reading mode moves across margins; keyboard restore returns to auto', async () => {
    await mode('preview'); await card().waitFor();
    await drag('同名文件', 'left', 430); await waitData(d => d.layouts[0]?.side === 'left');
    assert.equal(await shell().getAttribute('data-manual'), 'true'); await assertSafe();
    await grip().focus(); await page.keyboard.press('ArrowDown'); await frames();
    await grip().focus(); await page.keyboard.press('Delete'); await waitData(d => d.layouts.length === 0);
    await frames(); assert.equal(await shell().getAttribute('data-manual'), 'false');
    await mode('source', true); await drag('同名文件', 'right', 460); await waitData(d => d.layouts.length === 1);
    await mode('source', false); assert.equal(await shell().getAttribute('data-manual'), 'true');
  });
  await check('v2: snap grid/collision feedback and moving links have independent records', async () => {
    await configure({ placementMode: 'snap', cardShape: 'square', cardSize: 'medium' });
    await beginDrag('关键观点', await point('left', 620));
    assert.equal(await page.locator('.margin-link-snapped.margin-link-card-dragging').count(), 1);
    await page.screenshot({ path: 'artifacts/v2-dragging.png' }); await page.mouse.up();
    await waitData(d => d.layouts.length === 2);
    await drag('产品路线图', 'left', 620); await waitData(d => d.layouts.length === 3);
    assert.equal(new Set((await data()).layouts.map(e => e.key)).size, 3); await assertSafe();
    await page.screenshot({ path: 'artifacts/v2-square.png' });
  });
  await check('v2: narrow/wide, font changes and device scaling preserve records safely', async () => {
    const saved = (await data()).layouts;
    await viewport(820); await frames(); await assertSafe();
    assert.equal(await page.locator('.margin-link-card').count(), 0);
    await viewport(1980); await frames(); await assertSafe(); assert.deepEqual((await data()).layouts, saved);
    await page.locator('.cm-content').evaluate(e => { e.style.fontSize = '24px'; e.style.lineHeight = '38px'; }); await frames(); await assertSafe();
    await page.locator('.cm-content').evaluate(e => { e.style.removeProperty('font-size'); e.style.removeProperty('line-height'); });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1980, height: 1000, deviceScaleFactor: 1.5, mobile: false }); await frames(); await assertSafe();
    await viewport(1980); assert.deepEqual((await data()).layouts, saved);
  });
  await check('v2: same note in two leaves calculates bounds independently', async () => {
    await viewport(3200);
    await page.evaluate(async note => { await app.workspace.getLeaf('split').openFile(app.vault.getFileByPath(note)); }, note);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-overlay').length === 2);
    await frames(); await assertSafe();
    const manual = await page.locator('.margin-link-overlay').evaluateAll(es => es.map(e => e.querySelectorAll('[data-manual=true]').length));
    assert(manual.every(n => n > 0));
    await viewport(920); await frames(); await assertSafe();
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[1].detach()); await viewport(1980);
    await page.evaluate(() => app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], { focus: true }));
  });
  await check('v2: note-only and global resets require confirmation and preserve other notes', async () => {
    await page.evaluate(async () => app.workspace.getLeavesOfType('markdown')[0].openFile(app.vault.getFileByPath('Note A.md'))); await frames();
    await drag('MarginLink Demo', 'right', 300); await waitData(d => d.layouts.some(e => e.source === 'Note A.md'));
    await command('Reset note layout'); await page.locator('.margin-link-confirm').getByRole('button', { name: '取消', exact: true }).click();
    assert((await data()).layouts.some(e => e.source === 'Note A.md'));
    await command('Reset note layout'); await page.locator('.margin-link-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await waitData(d => !d.layouts.some(e => e.source === 'Note A.md')); assert((await data()).layouts.some(e => e.source === note));
    await mode('source', false); await command('Reset all layouts'); await page.locator('.margin-link-confirm').getByRole('button', { name: '确认', exact: true }).click();
    await waitData(d => d.layouts.length === 0); assert.equal(await diskText(), original);
  });
  await check('v2: free-mode card positioning does not interfere with selection-handle linking', async () => {
    await configure({ placementMode: 'free', cardShape: 'horizontal' });
    await page.evaluate(() => { const e = app.workspace.getLeavesOfType('markdown')[0].view.editor, at = e.getValue().indexOf('中文文字'); e.setSelection(e.offsetToPos(at), e.offsetToPos(at + 4)); e.focus(); });
    const handle = page.locator('.margin-link-handle:not([hidden])'); await handle.waitFor(); const b = await handle.boundingBox(), target = await point('right', 550);
    await page.mouse.move(b.x + 12, b.y + 12); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 10 }); await page.mouse.up();
    await page.locator('.prompt-input').fill('Folder/Note A.md'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.getValue()), original.replace('中文文字', '[[Folder/Note A.md|中文文字]]'));
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo()); await persist(); assert.equal(await diskText(), original);
  });
  await check('v2: sidebars, readable line length and dragged cards stay inside their own margins', async () => {
    await page.evaluate(() => { app.workspace.leftSplit.expand(); app.workspace.rightSplit.expand(); }); await frames(); await assertSafe();
    await page.evaluate(() => app.workspace.rightSplit.collapse());
    const owner = await settings('Editor');
    const toggle = owner.locator('.setting-item').filter({ hasText: /Readable line length|限制行宽/ }).locator('.checkbox-container').first();
    await flipToggle(owner, toggle); phase('settings: closing editor'); await closeSettings(owner); await frames(); await assertSafe();
    const back = await settings('Editor'); const reset = back.locator('.setting-item').filter({ hasText: /Readable line length|限制行宽/ }).locator('.checkbox-container').first();
    await flipToggle(back, reset); phase('settings: closing editor'); await closeSettings(back); await frames(); await assertSafe();
  });
  await check('v2: repeated aliases survive distant edits and invalidate safely on deletion', async () => {
    await configure({ placementMode: 'free', cardShape: 'horizontal' });
    const source = ['one', 'two', 'three'].map(word => `${word} ${word.repeat(30)}\n[[Note A|same]]\n${word.repeat(30)}\n`).join('\n');
    await setText(source); await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 3);
    const cards = page.locator('.margin-link-card');
    for (let i = 0; i < 3; i++) {
      const handle = cards.nth(i).locator('..').locator('.margin-link-card-grip'), b = await handle.boundingBox(), target = await point(i % 2 ? 'right' : 'left', 350 + i * 160);
      await page.mouse.move(b.x + 8, b.y + 8); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up(); await frames();
    }
    const saved = await waitData(d => d.layouts.length === 3);
    assert.equal(new Set(saved.layouts.map(e => e.key)).size, 3);
    const edited = 'prefix\n'.repeat(60) + source;
    await page.evaluate(edited => { const e = app.workspace.getLeavesOfType('markdown')[0].view.editor; e.setValue(edited); const at = edited.indexOf('[[Note'); e.setCursor(e.offsetToPos(at)); e.scrollIntoView({ from: e.getCursor(), to: e.getCursor() }, true); }, edited);
    await frames(); assert.deepEqual((await data()).layouts, saved.layouts); await assertSafe();
    await page.evaluate(edited => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(edited.replace('[[Note A|same]]', 'deleted link')), edited);
    await waitData(d => d.layouts.length === 0);
    await setText(original); await persist();
  });
  await check('v2: rename invalidation, active-view and document changes cancel drag safely', async () => {
    await drag('同名文件', 'left', 500); await waitData(d => d.layouts.length === 1);
    await page.evaluate(async () => { const f = await app.vault.create('Layout rename fixture.md', '# fixture'); await app.vault.rename(f, 'Layout renamed.md'); await app.vault.delete(app.vault.getFileByPath('Layout renamed.md')); });
    await waitData(d => d.layouts.length === 0);
    await beginDrag('同名文件', await point('right', 500));
    await page.evaluate(async () => app.workspace.getLeavesOfType('markdown')[0].openFile(app.vault.getFileByPath('Note A.md'))); await page.mouse.up(); await frames();
    assert.equal(await page.locator('.margin-link-card-dragging').count(), 0); assert.equal((await data()).layouts.length, 0);
    await mode('source', false);
    await beginDrag('同名文件', await point('left', 600));
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.replaceRange('changed ', { line: 0, ch: 0 })); await page.mouse.up(); await frames();
    assert.equal(await page.locator('.margin-link-card-dragging').count(), 0); assert.equal((await data()).layouts.length, 0);
    await setText(original); await persist();
  });
  await check('v2: 120 links are viewport clipped and no self-triggered render loop remains', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} has [[Note A|Link ${i}]] with distinct context.\n`).join('\n');
    await setText(long); await frames(); const count = await page.locator('.margin-link-card').count(); assert(count > 0 && count < 40);
    await page.evaluate(() => { const e = app.workspace.getLeavesOfType('markdown')[0].view.editor; e.setCursor(e.offsetToPos(e.getValue().length)); e.scrollIntoView({ from: e.getCursor(), to: e.getCursor() }, true); });
    await frames(); assert((await page.locator('.margin-link-card-label').allTextContents()).some(t => t === 'Link 119')); await assertSafe();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const mutations = await page.locator('.margin-link-overlay').evaluate(el => new Promise(resolve => { let count = 0; const observer = new MutationObserver(rs => { count += rs.length; }); observer.observe(el, { attributes: true, subtree: true, childList: true }); setTimeout(() => { observer.disconnect(); resolve(count); }, 300); }));
    assert(mutations < 100, `Possible render feedback loop: ${mutations} mutations/300ms`);
    await setText(original); await persist();
  });
  await check('v2: square and icon cards follow native light/dark themes and reduced motion', async () => {
    await configure({ cardShape: 'square', lineStyle: 'curve', reduceMotion: true, lines: 'always' });
    let owner = await settings('Appearance');
    await owner.locator('.setting-item').filter({ hasText: /Base color scheme|基础颜色/ }).locator('select:not(.is-measuring)').first().selectOption('moonstone');
    phase('theme: closing light settings'); await closeSettings(owner); await page.waitForSelector('body.theme-light'); await frames(); await assertSafe();
    assert.equal(await page.locator('.margin-link-connector').first().evaluate(e => getComputedStyle(e).transitionDuration), '0s');
    await page.screenshot({ path: 'artifacts/v2-light.png' });
    await configure({ cardShape: 'icon' }); await assertSafe();
    owner = await settings('Appearance'); await owner.locator('.setting-item').filter({ hasText: /Base color scheme|基础颜色/ }).locator('select:not(.is-measuring)').first().selectOption('obsidian');
    phase('theme: closing dark settings'); await closeSettings(owner); await page.waitForSelector('body.theme-dark'); await frames(); await assertSafe();
    await page.screenshot({ path: 'artifacts/v2-icon.png' });
  });
  await check('v2: disabling mid-drag and closing quick controls cleans captured UI state', async () => {
    await configure({ cardShape: 'horizontal', placementMode: 'free' });
    await beginDrag('同名文件', await point('left', 600));
    let owner = await settings('Community plugins');
    let toggle = owner.locator('.setting-item').filter({ hasText: 'MarginLink contributors' }).locator('.checkbox-container');
    await flipToggle(owner, toggle); await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.margin-link-host,.margin-link-overlay,.margin-link-anchor-active,.margin-link-position-ghost'));
    await flipToggle(owner, toggle); await closeSettings(owner); await page.waitForSelector('.margin-link-card');
    await quick(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('.margin-link-quick-controls').count(), 0);
    assert.equal(await diskText(), original);
  });
  await check('v2: UI-only data clearing/reload rebuilds links and resets appearance', async () => {
    // Use the native settings action; no external application/profile writes.
    const panel = await full(); await panel.getByRole('button', { name: '恢复默认', exact: true }).click();
    await page.locator('.margin-link-confirm').getByRole('button', { name: '确认', exact: true }).click(); await page.keyboard.press('Escape');
    await waitData(d => d.preferences.placementMode === 'auto' && d.layouts.length === 0);
    await persist(); await unlink('test-vault/.obsidian/plugins/margin-link/data.json');
    await page.reload(); await page.waitForSelector('.margin-link-card');
    assert.equal(await page.locator('.margin-link-card').count(), 7); assert.equal(await diskText(), original);
    assert.equal(await page.locator('.margin-link-card-grip:not([hidden])').count(), 0);
  });
  await mode('source', false); await viewport(1680); await persist();
}
