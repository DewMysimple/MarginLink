/* global app */
import assert from 'node:assert/strict';

export async function checkNavigationLifetime(page, frames) {
  const cardFor = label => page.locator('.margin-link-card').filter({has: page.locator('.margin-link-card-label', {hasText: new RegExp('^' + label + '$')})});
  const first = cardFor('first'), other = cardFor('other'), preview = page.locator('.margin-link-target-preview');
  const wait = fn => page.waitForFunction(fn, undefined, {timeout: 5000});
  await page.evaluate(async () => {
    const p = app.plugins.plugins['margin-link'];
    p.preferences.groupMode = 'none'; p.preferences.lines = 'numbers'; await p.savePreferences();
  });
  await wait(() => document.querySelectorAll('.margin-link-card').length === 5);
  await first.click({ button: 'right' });
  await page.locator('.menu-item').filter({hasText: '固定此处关联高亮'}).click();
  assert.equal(await page.locator('.margin-link-pinned').count(), 1);
  assert.equal(await page.locator('.margin-link-continuation.margin-link-active:visible').count(), 2);
  assert.equal(await page.locator('.margin-link-connectors:visible').count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.margin-link-pinned').count(), 0);

  const position = () => first.locator('..').evaluate(el => el.style.transform);
  const before = await position(), rect = await first.boundingBox();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y + 50, {steps: 8});
  assert.notEqual(await position(), before);
  await page.keyboard.press('Escape'); await page.mouse.up(); await frames();
  assert.equal(await position(), before);
  await first.click({modifiers: ['Control']});
  await wait(() => app.workspace.activeLeaf.view.file?.path === 'Docs/Target.md');
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown').length), 2);
  await page.evaluate(() => app.workspace.activeLeaf.detach());
  await wait(() => app.workspace.activeLeaf.view.file?.path === 'Navigation.md');
  const cdp = await page.context().newCDPSession(page);
  await frames(20);
  await first.focus(); await page.keyboard.press('p');
  assert.equal(await first.locator('..').evaluate(el => el.classList.contains('margin-link-pinned')), true, 'pin before resizing');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width: 1170, height: 760, deviceScaleFactor: 1, mobile: false});
  await frames();
  const afterResize = await first.locator('..').evaluate(el => {
    const view = app.workspace.activeLeaf.view, overlay = app.plugins.plugins['margin-link'].overlays.get(view);
    return { marked: el.classList.contains('margin-link-pinned'), key: el.dataset.relation, pinned: overlay.pinned, mode: overlay.mode, path: overlay.path, cards: overlay.cards.size };
  });
  assert(afterResize.marked, 'pin after resizing: ' + JSON.stringify(afterResize));
  await cdp.send('Emulation.clearDeviceMetricsOverride'); await cdp.detach(); await frames();
  await first.focus(); await page.keyboard.press('Escape');
  await first.focus(); await page.keyboard.press('v');
  await preview.getByRole('button', {name: '打开文件'}).click();
  await wait(() => app.workspace.activeLeaf.view.file?.path === 'Docs/Target.md');
  await page.evaluate(() => app.workspace.activeLeaf.openFile(app.vault.getFileByPath('Navigation.md')));
  await wait(() => document.querySelectorAll('.margin-link-card').length === 5); await frames(20);

  // Delay only a target read. Drive the real hover/focus/host handlers while
  // the promise is pending and release it after replacement, navigation or unload.
  const arm = async () => {
    await page.evaluate(() => {
      const vault = app.vault, original = vault.cachedRead, source = 'Docs/Target.md';
      const overlay = app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view);
      overlay.invalidatePreview(source);
      const gate = window.navigationRead = { started: false };
      const blocked = new Promise(resolve => { gate.release = resolve; });
      vault.cachedRead = async function(file) {
        if (file.path === source) { gate.started = true; await blocked; }
        return original.call(this, file);
      };
      gate.restore = () => { vault.cachedRead = original; gate.release(); delete window.navigationRead; };
    });
  };
  const release = () => page.evaluate(() => window.navigationRead?.restore());
  try {
    await arm(); await page.mouse.move(1, 1); await first.hover();
    await wait(() => window.navigationRead.started);
    await other.hover(); await preview.getByText('# Another target').waitFor();
    await release(); await frames();
    assert((await preview.innerText()).includes('# Another target'));
    await first.focus(); await page.keyboard.press('Escape');
    await arm(); await first.focus(); await page.keyboard.press('v');
    await wait(() => window.navigationRead.started);
    await page.evaluate(() => app.workspace.activeLeaf.openFile(app.vault.getFileByPath('Target.md')));
    await release(); await frames(); assert.equal(await preview.count(), 0);
    await page.evaluate(() => app.workspace.activeLeaf.openFile(app.vault.getFileByPath('Navigation.md')));
    await wait(() => document.querySelectorAll('.margin-link-card').length === 5);
    await frames(20); await other.focus(); await frames(); await page.keyboard.press('v');
    await preview.getByText('# Another target').waitFor({ timeout: 5000 }).catch(async error => {
      throw Error(error.message + ' ' + JSON.stringify(await page.evaluate(() => ({ preview: document.querySelector('.margin-link-target-preview')?.textContent, focus: document.activeElement?.outerHTML.slice(0, 250), mode: app.workspace.activeLeaf.view.getMode() }))));
    });
    await page.evaluate(() => app.vault.delete(app.vault.getFileByPath('Target.md')));
    await wait(() => !document.querySelector('.margin-link-target-preview'));
    await arm(); await first.focus(); await page.keyboard.press('v'); await wait(() => window.navigationRead.started);
    await page.evaluate(async () => {
      const overlay = app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view);
      await app.plugins.disablePlugin('margin-link');
      if (overlay.preview.session || overlay.preview.summaries.entries.size || overlay.groups || overlay.cards.size) throw Error('Navigation state survived plugin unload');
    });
    await release(); await page.waitForTimeout(650);
    assert.equal(await page.locator('.margin-link-target-preview,.margin-link-group-action,.margin-link-decoration-layer,.margin-link-overlay,.margin-link-anchor-active,.margin-link-anchor-ink').count(), 0);
    await page.evaluate(() => app.plugins.enablePlugin('margin-link'));
    await wait(() => document.querySelectorAll('.margin-link-card').length === 5);
  } finally { await release(); }
  return ['paired numbers', 'context menu pin/Escape', 'drag cancellation', 'Ctrl+click', 'pinned resize', 'preview open button', 'A→B hover race', 'in-flight navigation', 'target deletion', 'in-flight unload and re-enable'];
}
