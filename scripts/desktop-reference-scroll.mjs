/* global app */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

// Launch scripts/launch-navigation-test.ps1 first. Only write to its disposable vault.
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
  await page.waitForFunction(() => window.app?.vault?.adapter);
  const vault = path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(vault).toLowerCase(), path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(vault), /^[a-f0-9]{32}$/);
  const bundle = await readFile(path.join(vault, '.obsidian/plugins/margin-link/main.js'));
  assert(bundle.equals(await readFile('dist/margin-link/main.js')));
  const trust = page.getByRole('button', { name: /信任仓库作者并启用插件|Trust author and enable plugins/i });
  if (!await page.evaluate(() => !!app.plugins?.plugins?.['margin-link'])) {
    await trust.click();
  }
  await page.waitForFunction(() => app.plugins.plugins['margin-link']);
  await page.keyboard.press('Escape');
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const file = await page.evaluate(async () => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const lines = ['# Stable cards', ''];
    for (let i = 0; i < 180; i++) {
      lines.push(i % 6 === 0 ? 'Read [[Docs/Target|Repeat ' + i + ']].'
        : i < 35 ? 'Read [[Missing-' + i + ']].' : 'A paragraph between references.', '');
    }
    return (await app.vault.create('Scroll-' + Date.now() + '.md', lines.join('\n'))).path;
  });
  const results = [];
  const host = (await page.title()).match(/Obsidian v?([\d.]+)/)?.[1];
  assert(host);
  for (const mode of ['live', 'source', 'reading']) for (const placement of ['auto', 'free', 'snap', 'manual']) for (const merged of [true, false]) {
    await page.evaluate(async ({ file, mode, placement, merged }) => {
      const p = app.plugins.plugins['margin-link'];
      Object.assign(p.preferences, { mergeReferences: merged, cardShape: 'square', placementMode: placement, lines: 'always' });
      await p.savePreferences();
      await app.workspace.activeLeaf.setViewState({ type: 'markdown', state: { file, mode: mode === 'reading' ? 'preview' : 'source', source: mode === 'source' } });
      app.workspace.activeLeaf.view.setEphemeralState({ scroll: 0 });
    }, { file, mode, placement, merged });
    await page.waitForFunction(merged => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
      return o?.scroller?.scrollTop === 0 && o.cards.size && o.cards.has('file:Docs/Target.md') === merged;
    }, merged);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
      const scroller = o.scroller, original = new Map(), switched = new Set(), replaced = new Set(), missing = new Set();
      const offsets = new Map(), nativePositions = new Map();
      let nativeShift = 0, collisions = 0;
      let maxX = 0, maxY = 0, relativeDrift = 0, comparisons = 0, deepRelations = 0, hitChecks = 0;
      const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const sample = () => {
        const clip = scroller.getBoundingClientRect();
        // Measure native text again, independently of the overlay's anchor cache.
        const native = new Map((o.bridge() && v.getMode() === 'source' ? o.bridge().anchors() : o.host.reading.anchors(v)).map(a => [a.key, a.rect]));
        const rects = [];
        for (const [key, c] of o.cards) {
          const box = c.shell.getBoundingClientRect(), docY = box.top + scroller.scrollTop;
          for (const other of rects) if (other.right > box.left && other.left < box.right && other.bottom > box.top + .01 && other.top < box.bottom - .01) collisions++;
          rects.push(box);
          if (!original.has(key)) original.set(key, { shell: c.shell, x: box.left, y: docY, height: box.height, anchor: c.anchor.key });
          const first = original.get(key);
          const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
          if (cx > clip.left && cx < clip.right && cy > clip.top + 1 && cy < clip.bottom - 1) {
            hitChecks++;
            if (!document.elementsFromPoint(cx, cy).some(el => c.shell.contains(el))) missing.add(key);
          }
          if (first.anchor !== c.anchor.key) switched.add(key);
          if (first.shell !== c.shell) replaced.add(key);
          maxX = Math.max(maxX, Math.abs(box.left - first.x));
          maxY = Math.max(maxY, Math.abs(docY - first.y));
          const text = native.get(c.anchor.key);
          if (text) {
            const nativeY = text.bottom + scroller.scrollTop;
            if (!nativePositions.has(key)) nativePositions.set(key, nativeY);
            nativeShift = Math.max(nativeShift, Math.abs(nativeY - nativePositions.get(key)));
            const offset = box.top - text.bottom;
            if (!offsets.has(key)) offsets.set(key, offset);
            else { relativeDrift = Math.max(relativeDrift, Math.abs(offset - offsets.get(key))); comparisons++; }
          }
        }
        for (const [key, first] of original) {
          const top = first.y - scroller.scrollTop;
          if (top < clip.bottom - 1 && top + first.height > clip.top + 1 && !o.cards.get(key)?.shell.isConnected) missing.add(key);
        }
        if (scroller.scrollTop > 2000) deepRelations = Math.max(deepRelations, [...(o.visibleRelations ?? o.cards).values()].filter(r =>
          r.anchor.occurrence.target === 'Docs/Target' && r.anchor.rect.top > clip.top && r.anchor.rect.bottom < clip.bottom &&
          (r.path.getAttribute('d') || r.continuation?.[0] && !r.continuation[0].hidden)).length);
      };
      window.scrollProbe = { sample, frame, done: () => ({ maxX, maxY, relativeDrift, comparisons, switched: switched.size,
        replaced: replaced.size, missing: missing.size, deepRelations, hitChecks, nativeShift, collisions, sampled: original.size }) };
      sample();
    });
    const scroller = await page.evaluate(() => {
      const r = app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view).scroller.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(scroller.x, scroller.y);
    let wheelDistance = 0;
    for (const dy of [90, 90, 90, -90, -90, -90]) {
      await page.mouse.wheel(0, dy);
      const y = await page.evaluate(async () => {
        await window.scrollProbe.frame(); window.scrollProbe.sample();
        return app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view).scroller.scrollTop;
      });
      wheelDistance = Math.max(wheelDistance, y);
    }
    const sample = await page.evaluate(async () => {
      const { frame, sample, done } = window.scrollProbe;
      const scroller = app.plugins.plugins['margin-link'].overlays.get(app.workspace.activeLeaf.view).scroller;
      const down = Array.from({ length: 30 }, (_, i) => (i + 1) * 28);
      for (const y of [...down, 3500, 5500, 3500, ...down.reverse(), 0, 560, 0]) {
        scroller.scrollTop = y;
        await frame(); await frame(); sample();
        if (y === 5500 || y === 0) { await new Promise(resolve => setTimeout(resolve, 220)); sample(); }
      }
      delete window.scrollProbe;
      return done();
    });
    const row = { mode, placement, merged, wheelDistance, ...sample };
    results.push(row); console.log(JSON.stringify(row));
  }
  assert.deepEqual(errors, []);
  // A spacer can move one end of a tightly packed stack into its neighbour.
  // Both the card and its text-relative offset must stay within the actual
  // native geometry correction; an entire row jump or any overlap fails.
  assert(results.every(r => r.wheelDistance > 0 && r.sampled > 10 && r.comparisons > 100 && r.hitChecks > 100 && r.maxX <= 1 &&
    r.maxY <= r.nativeShift + 1 && r.relativeDrift <= r.nativeShift + 1 && !r.collisions &&
    !r.switched && !r.replaced && !r.missing && r.deepRelations));
  await writeFile('artifacts/card-clearance-scroll-' + host + '.json', JSON.stringify({
    host, bundle: createHash('sha256').update(bundle).digest('hex'), results, errors
  }, null, 2) + '\n');
} finally { await browser.close(); }
