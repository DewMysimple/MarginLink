/* global app */
// Launch with scripts/launch-navigation-test.ps1 -Port 9244, then pass its vault GUID.
import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const id = process.argv[2];
assert.match(id ?? '', /^[a-f0-9]{32}$/);
const root = path.resolve('test-vault/.v03-desktop', id), sources = path.resolve('test-profile/v03', id, 'sources');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9244');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
page.setDefaultTimeout(9000);
const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 9000 });
const check = async (label, run) => { await run(); console.log('PASS', label); };
const hash = data => createHash('sha256').update(data).digest('hex');
const errors = [];
const picker = page.locator('.margin-link-file-picker:visible');
const dialog = page.locator('.modal:visible').filter({ has: page.getByText('检测到同名文件', { exact: true }) });
const confirm = () => dialog.getByRole('button', { name: '替换文件', exact: true }).click();
const card = () => page.locator('.workspace-leaf.mod-active .margin-link-card').first();
const openCard = async () => {
  await card().click({ button: 'right' });
  await page.getByText('重新链接文件…', { exact: true }).click();
  await picker.waitFor();
};
const original = 'First [[Docs/Brief#Old|保留别名]] then [[Docs/Brief|第二处]].\n\nselect here';
const sourceText = () => page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue());
const openSelection = async () => {
  await page.evaluate(() => {
    const editor = app.workspace.activeLeaf.view.editor;
    const at = editor.getValue().indexOf('select here');
    editor.setSelection(editor.offsetToPos(at), editor.offsetToPos(at + 6)); editor.focus();
  });
  await page.locator('.margin-link-handle:visible').click();
};
const paste = async name => picker.getByRole('searchbox').fill(path.join(sources, name));
const gone = async name => {
  for (let n = 0; n < 100; n++) {
    if (!(await access(path.join(sources, name)).then(() => true, () => false))) return;
    await delay(50);
  }
  throw Error('External source still present: ' + name);
};
const position = () => page.evaluate(() => {
  const view = app.workspace.activeLeaf.view;
  return [view.leaf.id, view.getMode(), view.editor.listSelections(), view.editor.getScrollInfo().top];
});
const disk = name => readFile(path.join(root, name));
const renderPreview = async text => {
  await wait(() => {
    const view = app.workspace.activeLeaf.view, overlay = app.plugins.plugins['margin-link'].overlays.get(view);
    return overlay?.cards.size === 2 && !overlay.frame && !overlay.scrolling && !!app.metadataCache.getFileCache(app.vault.getFileByPath('Docs/Brief.md'))?.headings;
  });
  await card().hover();
  await page.locator('.margin-link-target-preview p').filter({ hasText: text }).waitFor();
  await page.keyboard.press('Escape');
};
let verified = false;
try {
  await wait(() => window.app?.vault?.adapter);
  assert.equal(path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath())).toLowerCase(), root.toLowerCase());
  assert.equal(hash(await disk('.obsidian/plugins/margin-link/main.js')), hash(await readFile('dist/margin-link/main.js')));
  verified = true;
  const trust = page.getByRole('button', { name: /信任仓库作者并启用插件|Trust author and enable plugins/i });
  await Promise.race([trust.waitFor(), wait(() => app.plugins.plugins['margin-link'])]);
  if (await trust.isVisible()) await trust.click();
  await wait(() => app.plugins.plugins['margin-link']); await page.keyboard.press('Escape');
  page.on('pageerror', e => errors.push(String(e)));
  console.log(await page.title(), 'plugin', await page.evaluate(() => app.plugins.plugins['margin-link'].manifest.version));
  await mkdir(sources);
  await page.evaluate(async original => {
    Object.assign(app.plugins.plugins['margin-link'].preferences, { newNoteFolders: ['Docs', '/', ''], newNoteDefault: 0 });
    await app.plugins.plugins['margin-link'].savePreferences();
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    await app.vault.create('Docs/Brief.md', '# Old\n\nOLD CONTENT');
    await app.vault.create('Brief.md', 'different folder');
    await app.vault.create('Other.md', 'untouched [[Docs/Brief#Old|another note]]\r\n');
    await app.vault.create('Replace.md', original);
    await app.workspace.activeLeaf.setViewState({type: 'markdown', state: {file: 'Replace.md', mode: 'source', source: false}});
  }, original);
  const initial = await disk('Replace.md'), neighbor = await disk('Other.md'), old = await disk('Docs/Brief.md');
  const changed = Buffer.from('# New\n\nNEW CONTENT');
  assert.equal(changed.length, old.length);
  await writeFile(path.join(sources, 'Brief.md'), changed);
  await renderPreview('OLD CONTENT');
  await check('cancel, Enter on Cancel, Escape and close preserve both files and references', async () => {
    await openCard(); await paste('Brief.md');
    for (const action of ['cancel', 'Enter', 'Escape', 'close']) {
      await dialog.waitFor();
      assert.deepEqual(await dialog.locator('.modal-content button').allTextContents(), ['取消', '替换文件']);
      assert((await dialog.innerText()).includes('现有文件：Docs/Brief.md'));
      assert((await dialog.innerText()).includes('新文件：Brief.md'));
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '取消');
      if (action === 'cancel') await dialog.getByRole('button', {name:'取消'}).click();
      else if (action === 'close') await page.locator('.modal-container').filter({ has: dialog }).locator('.modal-bg').click({ position: { x: 5, y: 5 } });
      else await page.keyboard.press(action);
      await dialog.waitFor({state: 'hidden'});
      assert.deepEqual(await disk('Docs/Brief.md'), old);
      assert.deepEqual(await readFile(path.join(sources, 'Brief.md')), changed);
      assert.equal(await sourceText(), original);
      if (action !== 'close') await picker.getByRole('button', { name: '确认替换…' }).click();
    }
    await page.keyboard.press('Escape'); await picker.waitFor({state:'hidden'});
  });
  await check('same-size Markdown from linked card preserves editor state and refreshes heading and preview', async () => {
    const before = await position();
    await openCard(); await paste('Brief.md'); await confirm(); await gone('Brief.md');
    await picker.waitFor({state:'hidden'});
    assert.deepEqual(await position(), before); assert.equal(await sourceText(), original);
    assert.deepEqual(await disk('Replace.md'), initial); assert.deepEqual(await disk('Other.md'), neighbor);
    assert.deepEqual(await disk('Docs/Brief.md'), changed); assert.equal(String(await disk('Brief.md')), 'different folder');
    assert.equal(await page.locator('.workspace-leaf.mod-active .margin-link-card').count(), 2);
    assert.equal(await page.evaluate(() => app.metadataCache.getFileCache(app.vault.getFileByPath('Docs/Brief.md')).headings[0].heading), 'New');
    await renderPreview('NEW CONTENT');
  });
  await check('identical bytes from a distinct external file can complete without touching its existing link', async () => {
    await writeFile(path.join(sources, 'Brief.md'), changed);
    await openCard(); await paste('Brief.md'); await confirm(); await gone('Brief.md');
    assert.deepEqual(await disk('Docs/Brief.md'), changed); assert.equal(await sourceText(), original);
  });
  await check('reading-mode replacement preserves both same-note splits and rejects an intervening sibling edit', async () => {
    const ids = await page.evaluate(async source => {
      await app.vault.create('Split.md', source);
      const writer = app.workspace.activeLeaf;
      await writer.setViewState({type:'markdown', state:{file:'Split.md',mode:'source', source:false}});
      const reader = app.workspace.getLeaf('split','horizontal');
      await reader.setViewState({type:'markdown', state:{file:'Split.md',mode:'preview'},active:true});
      app.workspace.setActiveLeaf(reader, {focus:true}); return {reader:reader.id, writer:writer.id};
    }, original);
    await wait(() => app.workspace.activeLeaf.view.getMode() === 'preview' && app.workspace.activeLeaf.view.contentEl.querySelectorAll('.margin-link-card').length === 2);
    const src = path.join(sources, 'Brief.md');
    await writeFile(src, changed); await openCard(); await paste('Brief.md'); await confirm(); await gone('Brief.md');
    assert.deepEqual(await disk('Replace.md'), initial);
    assert(await page.evaluate(ids => {
      const leaves = app.workspace.getLeavesOfType('markdown');
      return app.workspace.activeLeaf.id === ids.reader && app.workspace.activeLeaf.view.getMode() === 'preview' &&
        leaves.find(l=>l.id === ids.writer).view.editor.getValue() === app.workspace.activeLeaf.view.data;
    }, ids));
    await writeFile(src, 'sibling edit'); await openCard(); await paste('Brief.md'); await dialog.waitFor();
    await page.evaluate(id => {
      const editor = app.workspace.getLeavesOfType('markdown').find(l=>l.id===id).view.editor;
      editor.replaceRange('edited ', {line:0,ch:0});
    }, ids.writer);
    await confirm();
    await picker.getByRole('status').filter({hasText:/改变|变化/}).waitFor();
    assert.equal(String(await readFile(src)), 'sibling edit'); assert.deepEqual(await disk('Docs/Brief.md'), changed);
    await page.keyboard.press('Escape');
    await page.evaluate(ids => {
      const leaves = app.workspace.getLeavesOfType('markdown'), writer = leaves.find(l=>l.id===ids.writer);
      leaves.find(l=>l.id===ids.reader).detach(); app.workspace.setActiveLeaf(writer, {focus:true});
      writer.view.editor.focus();
    }, ids);
    assert.equal(await sourceText(), 'edited ' + original);
    await page.evaluate(async () => { await app.workspace.activeLeaf.setViewState({type:'markdown', state:{file:'Replace.md',mode:'source',source:false}}); });
    assert.equal(await sourceText(), original);
  });
  await check('native Vault absolute path, folder choice, invalid filename and new Markdown', async () => {
    await openSelection(); await picker.getByRole('searchbox').fill(path.join(root,'Docs','Target.md'));
    await picker.getByRole('button', {name:'关联此文件'}).click(); await picker.waitFor({state:'hidden'});
    assert.equal(await sourceText(), original.replace('select here', '[[Docs/Target.md|select]] here'));
    await page.keyboard.press('Control+z'); assert.equal(await sourceText(), original);
    await openSelection(); await picker.getByRole('button', {name:'新建文件'}).click();
    const name = picker.locator('input[type="text"]');
    await name.fill('AUX'); assert(await picker.getByRole('button', {name:'创建并链接'}).isDisabled());
    await picker.locator('select').selectOption('/'); await name.fill('Created');
    await picker.getByRole('button', {name:'创建并链接'}).click(); await picker.waitFor({state:'hidden'});
    assert.equal(await sourceText(), original.replace('select here','[[Created.md|select]] here'));
    assert.equal(String(await disk('Created.md')), '');
    await page.keyboard.press('Control+z'); assert.equal(await sourceText(), original);
  });
  await check('normal import, HTML and PNG replacement from selection; one undo and redo', async () => {
    const cases = [
      ['fresh.HTM', Buffer.from('新建\r\n'), false],
      ['Page.HTML', Buffer.from('<p>替换后的内容</p>\r\n'), true],
      ['Image.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW3cAAAAASUVORK5CYII=', 'base64'), true]
    ];
    for (const [name, bytes, conflict] of cases) {
      if (conflict) await page.evaluate(async name => { await app.vault.createBinary('Docs/' + name, new Uint8Array([1,2,3]).buffer); }, name);
      await writeFile(path.join(sources, name), bytes);
      await openSelection(); await paste(name);
      if (conflict) await confirm(); else await picker.getByRole('button', {name: '移动到仓库并关联'}).click();
      await gone(name); await picker.waitFor({state:'hidden'});
      assert.equal(hash(await disk('Docs/' + name)), hash(bytes));
      const linked = original.replace('select here', '[[Docs/' + name + '|select]] here');
      assert.equal(await sourceText(), linked);
      await page.keyboard.press('Control+z'); assert.equal(await sourceText(), original);
      await page.keyboard.press('Control+y'); assert.equal(await sourceText(), linked);
      await page.keyboard.press('Control+z'); assert.equal(await sourceText(), original);
    }
  });
  await check('real relink continues to edit only one occurrence; disabling while confirming cancels', async () => {
    await openCard(); await picker.getByRole('searchbox').fill('Docs/Target.md'); await picker.getByRole('searchbox').press('Enter');
    await page.getByRole('button', {name:'移除子路径'}).click();
    await picker.waitFor({state:'hidden'}); assert.equal(await sourceText(), original.replace('Docs/Brief#Old','Docs/Target.md'));
    await page.keyboard.press('Control+z'); assert.equal(await sourceText(), original);
    await writeFile(path.join(sources, 'Brief.md'), 'unload test');
    await openCard(); await paste('Brief.md'); await dialog.waitFor();
    await page.evaluate(() => app.plugins.disablePlugin('margin-link'));
    await dialog.waitFor({state:'hidden'}); await picker.waitFor({state:'hidden'});
    assert.deepEqual(await disk('Docs/Brief.md'), changed);
    assert.equal(await readFile(path.join(sources,'Brief.md'), 'utf8'), 'unload test');
    await page.evaluate(() => app.plugins.enablePlugin('margin-link'));
    await card().waitFor(); assert.equal(await sourceText(), original);
  });
  await check('target edited during confirmation is preserved; post-publish editor change reports partial success', async () => {
    const name = 'Race.pdf', target = 'Docs/' + name, src = path.join(sources, name);
    await page.evaluate(async target => { await app.vault.createBinary(target, new Uint8Array([1,2,3]).buffer); }, target);
    const newer = Buffer.from([0xff, 0, 0x11]), external = Buffer.from('new source');
    await writeFile(src, external); await openSelection(); await paste(name); await dialog.waitFor();
    await writeFile(path.join(root, target), newer); await confirm();
    await picker.getByRole('status').filter({hasText:/改变/}).waitFor();
    assert.deepEqual(await disk(target), newer); assert.deepEqual(await readFile(src), external);
    await page.keyboard.press('Escape'); await picker.waitFor({state:'hidden'});
    await openSelection(); await paste(name); await dialog.waitFor();
    await page.evaluate(target => {
      const ref = app.vault.on('modify', file => {
        if (file.path !== target) return;
        app.vault.offref(ref); app.workspace.activeLeaf.view.editor.setCursor({line:0, ch:0});
      });
    }, target);
    await confirm();
    await page.locator('.notice').filter({hasText:'目标内容已替换：' + target}).filter({hasText:'库外来源已保留'}).waitFor();
    await picker.waitFor({state:'hidden'});
    assert.deepEqual(await disk(target), external); assert.deepEqual(await readFile(src), external); assert.equal(await sourceText(), original);
  });
  assert.deepEqual((await readdir(path.join(root, 'Docs'))).sort(), ['Brief.md', 'Image.png', 'Page.HTML', 'Race.pdf', 'Target.md', 'fresh.HTM'].sort());
  assert.deepEqual(await disk('Other.md'), neighbor); assert.deepEqual(errors, []);
  console.log('PASS exact directory contents, other note bytes, zero page errors');
  await check('native window close during the first staging write removes only the staging file', async () => {
    const name = 'Closing.pdf', target = 'Docs/' + name, src = path.join(sources, name);
    const before = Buffer.from([8,9,10]), bytes = Buffer.alloc(3 * 1024 * 1024 + 31, 0xe7);
    await page.evaluate(async target => { await app.vault.createBinary(target, new Uint8Array([8,9,10]).buffer); }, target);
    await writeFile(src, bytes); await openSelection(); await paste(name); await dialog.waitFor();
    await page.evaluate(() => {
      const load = window.require;
      const fs = load('fs/promises'), open = fs.open;
      fs.open = async (...args) => {
        const handle = await open(...args);
        if (args[1] === 'wx' && args[0].endsWith('.tmp')) {
          fs.open = open;
          const write = handle.write.bind(handle);
          handle.write = async (...params) => {
            const result = await write(...params);
            window.marginLinkTestStaged = true;
            await new Promise(resolve => setTimeout(resolve, 12000));
            return result;
          };
        }
        return handle;
      };
    });
    await confirm(); await wait(() => window.marginLinkTestStaged);
    assert.equal((await readdir(path.join(root, 'Docs'))).filter(f => f.endsWith('.tmp')).length, 1);
    await Promise.all([page.waitForEvent('close'), page.evaluate(() => window.close()).catch(() => {})]);
    assert.deepEqual(await disk(target), before); assert.equal(hash(await readFile(src)), hash(bytes));
    assert.equal((await readdir(path.join(root, 'Docs'))).filter(f => f.endsWith('.tmp')).length, 0);
    assert.deepEqual(errors, []);
  });
} catch (error) {
  console.error(error);
  if (verified) console.error('Host UI:', await page.locator('.modal:visible, .notice:visible').allTextContents().catch(() => []));
  throw error;
} finally {
  if (verified && !page.isClosed()) {
    await browser.newBrowserCDPSession().then(session => session.send('Browser.close')).catch(() => {});
  }
  await browser.close();
}
