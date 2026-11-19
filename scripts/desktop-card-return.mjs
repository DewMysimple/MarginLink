/* global app */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

// Use a fresh launch-navigation-test.ps1 window for each host/build.
const baseline = process.argv.includes('--baseline');
const mediaOnly = process.argv.includes('--media-only');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await page.waitForFunction(() => window.app?.vault?.adapter);
  const vault = path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(vault).toLowerCase(), path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(vault), /^[a-f0-9]{32}$/);
  const bundle = await readFile(path.join(vault, '.obsidian/plugins/margin-link/main.js'));
  assert(bundle.equals(await readFile('dist/margin-link/main.js')));
  if (!await page.evaluate(() => !!app.plugins.plugins['margin-link'])) {
    await page.getByRole('button', { name: /信任仓库作者并启用插件|Trust author and enable plugins/i }).click();
  }
  await page.keyboard.press('Escape');
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const host = (await page.title()).match(/Obsidian v?([\d.]+)/)?.[1];
  const file = await page.evaluate(async () => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const prefix = 'Return-' + Date.now();
    await app.vault.createFolder(prefix);
    const lines = ['# Card return'];
    for (let i = 0; i < 72; i++) {
      const html = prefix + '/' + i + '.html';
      await app.vault.create(html, '<p>Target</p>');
      lines.push('', 'Section ' + i + ' [[' + html + '|local file]] and [[Docs/Target|repeat]] with [[' +
        prefix + '/' + ((i + 1) % 72) + '.html|another]] reference.', '', 'Text between links. '.repeat(9));
    }
    return (await app.vault.create(prefix + '.md', lines.join('\n'))).path;
  });
  const snapshot = () => page.evaluate(() => {
    const leaf = app.workspace.activeLeaf, v = leaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
    const s = o.scroller, clip = s.getBoundingClientRect();
    const cards = [], targets = [], rects = [];
    let collisions = 0;
    for (const [key, card] of o.cards) {
      const r = card.button.getBoundingClientRect();
      if (r.bottom <= clip.top || r.top >= clip.bottom) continue;
      for (const other of rects) if (other.right > r.left && other.left < r.right && other.bottom > r.top + 0.01 && other.top < r.bottom - 0.01) collisions++;
      rects.push(r); cards.push([key, r.left, r.top, card.anchor.key]);
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (y < clip.top + 8 || y > clip.bottom - 8 || !card.button.contains(document.elementFromPoint(x, y))) continue;
      targets.push({ x, y, path: card.anchor.occurrence.target, key });
    }
    const native = o.mode === 'source' ? o.bridge().anchors() : o.host.reading.anchors(v);
    const text = native.filter(a => a.rect.top >= clip.top && a.rect.bottom < clip.bottom).map(a => [a.key, a.rect.top]);
    return { top: s.scrollTop, cards, collisions, targets, text, leaf: leaf.id, mode: v.getMode(),
      live: !!v.contentEl.querySelector('.markdown-source-view.is-live-preview') };
  });
  const results = [], otherReturns = [];
  const sourceBytes = await readFile(path.join(vault, file));
  for (const mode of mediaOnly ? [] : ['reading', 'live', 'source']) for (const placement of ['auto', 'manual', 'free', 'snap']) for (const merged of [true, false]) {
    await page.evaluate(async ({ mode, placement, merged, file }) => {
      const p = app.plugins.plugins['margin-link'];
      Object.assign(p.preferences, { mergeReferences: merged, placementMode: placement, cardShape: 'square', lines: 'always' }); await p.savePreferences();
      await app.workspace.activeLeaf.setViewState({ type: 'markdown', state: { file, mode: mode === 'reading' ? 'preview' : 'source', source: mode === 'source' } });
    }, { mode, placement, merged, file });
    await page.waitForFunction(file => {
      const o = app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view); return o?.path === file && o.cards.size && o.scroller;
    }, file);
    for (const y of [0, 1700, 3100, 2400]) {
      await page.evaluate(y => { app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view).scroller.scrollTop = y; }, y);
      await page.waitForTimeout(220);
    }
    if (await page.locator('.modal-container .vertical-tab-header').isVisible()) await page.keyboard.press('Escape');
    const before = await snapshot();
    assert(before.top > 1500 && before.text.length && before.cards.length > 2);
    const target = before.targets.filter(t => t.path.endsWith('.html')).at(-1);
    assert(target);
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(target => app.workspace.activeLeaf.view.file?.path === target, target.path);
    await page.waitForFunction(file => !app.workspace.activeLeaf.working && app.workspace.activeLeaf.history.backHistory.at(-1)?.state.state.file === file, file);
    await page.evaluate(() => app.commands.executeCommandById('app:go-back'));
    await page.waitForFunction(file => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v); return v.file?.path === file && o?.cards.size && o.path === file;
    }, file);
    await page.waitForTimeout(420);
    const after = await snapshot();
    assert.equal(after.leaf, before.leaf); assert.equal(after.mode, before.mode); assert.equal(after.live, before.live);
    const difference = (previous, current, match) => previous.filter(old => !current.some(now => match(old, now))).length;
    const row = { mode, placement, merged, before: before.top, after: after.top, sampled: before.cards.length,
      changedCards: difference(before.cards, after.cards, (a,b) => a[0] === b[0] && a[3] === b[3] && Math.abs(a[1]-b[1]) <= 1 && Math.abs(a[2]-b[2]) <= 1),
      addedCards: after.cards.filter(a => !before.cards.some(b => b[0] === a[0])).length,
      movedText: difference(before.text, after.text, (a,b) => a[0] === b[0] && Math.abs(a[1]-b[1]) <= 1),
      collisions: before.collisions + after.collisions };
    console.log(JSON.stringify(row)); results.push(row);
    if (!baseline && placement === 'auto' && !merged) {
      for (const method of ['markdown-back', 'close-tab', 'direct-reopen']) {
        const start = await snapshot();
        const next = start.targets.find(t => method === 'markdown-back' ? t.path === 'Docs/Target' : t.path.endsWith('.html'));
        assert(next, method + ' visible target');
        if (method === 'close-tab') await page.keyboard.down('Control');
        try { await page.mouse.click(next.x, next.y); }
        finally { if (method === 'close-tab') await page.keyboard.up('Control'); }
        await page.waitForFunction(target => app.workspace.activeLeaf.view.file?.path === target, method === 'markdown-back' ? 'Docs/Target.md' : next.path);
        const differentLeaf = await page.evaluate(id => app.workspace.activeLeaf.id !== id, start.leaf);
        assert.equal(differentLeaf, method === 'close-tab');
        if (!differentLeaf) await page.waitForFunction(file => !app.workspace.activeLeaf.working &&
          app.workspace.activeLeaf.history.backHistory.at(-1)?.state.state.file === file, file);
        await page.evaluate(async ({method, file}) => {
          if (method === 'close-tab') app.workspace.activeLeaf.detach();
          else if (method === 'direct-reopen') await app.workspace.activeLeaf.openFile(app.vault.getFileByPath(file));
          else app.commands.executeCommandById('app:go-back');
        }, { method, file });
        await page.waitForFunction(file => {
          const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
          return v.file?.path === file && o?.cards.size && o.path === file;
        }, file);
        await page.waitForTimeout(400);
        const end = await snapshot();
        assert.equal(end.mode, start.mode, method); assert.equal(end.live, start.live, method);
        const movedText = difference(start.text, end.text, (a,b) => a[0] === b[0] && Math.abs(a[1] - b[1]) <= 1);
        const changedCards = difference(start.cards, end.cards, (a,b) => a[0] === b[0] && a[3] === b[3] && Math.abs(a[1]-b[1]) <= 1 && Math.abs(a[2]-b[2]) <= 1);
        otherReturns.push({ mode, method, movedText, changedCards, collisions: end.collisions });
        console.log(JSON.stringify(otherReturns.at(-1)));
      }
      const current = await snapshot();
      await page.mouse.move(800, 550); await page.mouse.wheel(0, 180); await page.waitForTimeout(400);
      const scrolled = await snapshot();
      assert(scrolled.top > current.top + 60, 'the first user wheel after return must take effect');
    }
  }
  assert((await readFile(path.join(vault, file))).equals(sourceBytes)); assert.deepEqual(errors, []);
  if (!baseline) {
    const mediaFile = await page.evaluate(async () => {
      const prefix = 'Media-return-' + Date.now(), image = prefix + '.svg';
      await app.vault.create(image, '<svg xmlns="http://www.w3.org/2000/svg" width="700" height="380"><rect width="700" height="380" fill="navy"/></svg>');
      const lines = Array.from({ length: 15 }, (_, i) => '## Section ' + i + '\n\n![[' + image + ']]\n\n' +
        'See [[example.html|attached file ' + i + ']] or [[Docs/Target|another file]].');
      const note = await app.vault.create(prefix + '.md', lines.join('\n\n'));
      const p = app.plugins.plugins['margin-link']; Object.assign(p.preferences, {placementMode: 'auto', mergeReferences: false});
      await p.savePreferences();
      await app.workspace.activeLeaf.setViewState({ type: 'markdown', state: { file: note.path, mode: 'preview' } });
      return note.path;
    });
    await page.waitForFunction(mediaFile => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
      return o?.path === mediaFile && o.cards.size && o.scroller.scrollHeight > 4000;
    }, mediaFile);
    // Obsidian provisionally sizes unmounted image sections. Establish a
    // settled starting position before measuring the outbound click.
    await page.evaluate(async () => {
      const v = app.workspace.activeLeaf.view, s = app.plugins.plugins['margin-link'].overlays.get(v).scroller;
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        s.scrollTop = 2600; await new Promise(resolve => setTimeout(resolve, 350));
        if (s.scrollTop === 2600 && [...v.contentEl.querySelectorAll('.image-embed img')].every(img => img.complete)) {
          await new Promise(resolve => setTimeout(resolve, 250));
          if (s.scrollTop === 2600) return;
        }
      }
      throw Error('Image fixture failed to settle at its starting scroll position: ' + s.scrollTop);
    });
    if (await page.locator('.modal-container .vertical-tab-header').isVisible()) await page.keyboard.press('Escape');
    const start = await snapshot(), target = start.targets.find(t => t.path === 'example.html');
    assert(target && start.top > 2000 && start.text.length, JSON.stringify({top:start.top, cards:start.cards, text:start.text}));
    for (const [id] of start.text) assert(start.cards.some(c => c[0] === id), 'Visible image caption lost its card ' + id);
    const pictures = () => page.evaluate(() => [...app.workspace.activeLeaf.view.contentEl.querySelectorAll('.image-embed img')]
      .map(img => img.getBoundingClientRect()).filter(r => r.height > 200 && r.top > 0 && r.top < innerHeight).map(r => r.top));
    const beforeImages = await pictures(); assert(beforeImages.length);
    await page.mouse.click(target.x, target.y);
    await page.waitForFunction(file => app.workspace.activeLeaf.view.file?.path === 'example.html' && !app.workspace.activeLeaf.working &&
      app.workspace.activeLeaf.history.backHistory.at(-1)?.state.state.file === file, mediaFile);
    await page.evaluate(() => app.commands.executeCommandById('app:go-back'));
    await page.waitForFunction(file => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
      return v.file?.path === file && o?.cards.size && o.path === file;
    }, mediaFile);
    await page.waitForTimeout(600);
    const end = await snapshot(), afterImages = await pictures();
    assert.equal(start.cards.length, end.cards.length);
    for (const [id,x,y] of start.cards) assert(end.cards.some(([k,l,t]) => k === id && Math.abs(l-x) <= 1 && Math.abs(t-y) <= 1));
    assert.equal(beforeImages.length, afterImages.length);
    assert(beforeImages.every((y,i) => Math.abs(y-afterImages[i]) <= 1));
    otherReturns.push({mode:'reading', method:'embedded-image-back', pictures: beforeImages.length, cards: start.cards.length, collisions:end.collisions});
    console.log(JSON.stringify(otherReturns.at(-1)));
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/' + (mediaOnly ? 'media-return-' : 'card-return-') + (baseline ? 'baseline-' : '') + host + '.json', JSON.stringify({
    host, bundle: createHash('sha256').update(bundle).digest('hex'), results, otherReturns, errors
  }, null, 2) + '\n');
  // CM may estimate different document heights on a cold editor. Compare
  // actual native glyphs and card rectangles in viewport coordinates in all modes.
  if (!baseline) assert(results.every(r => !r.changedCards && !r.addedCards && !r.movedText && !r.collisions &&
    (r.mode !== 'reading' || Math.abs(r.before - r.after) <= 1)));
  assert(otherReturns.every(r => !r.changedCards && !r.movedText && !r.collisions));
} finally { await browser.close(); }
