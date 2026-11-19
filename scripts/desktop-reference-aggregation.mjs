/* global app */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
const hash = value => createHash('sha256').update(value).digest('hex');
const wait = fn => page.waitForFunction(fn, undefined, { timeout: 12000 });
const settle = () => page.waitForTimeout(450);
const report = { modes: [], interactions: [], performance: [], errors: [] };
try {
  await wait(() => window.app?.vault?.adapter);
  const vault = path.resolve(await page.evaluate(() => app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(vault).toLowerCase(), path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(vault), /^[a-f0-9]{32}$/);
  const trust = page.getByRole('button', { name: /信任仓库作者并启用插件|Trust author and enable plugins/i });
  await wait(() => window.app?.plugins?.plugins?.['margin-link'] || [...document.querySelectorAll('button')].some(b => /信任仓库作者并启用插件|Trust author and enable plugins/i.test(b.textContent)));
  if (await trust.isVisible()) await trust.click();
  await wait(() => window.app?.plugins?.plugins?.['margin-link']);
  page.on('pageerror', e => report.errors.push(String(e)));
  const pluginDir = path.join(vault, '.obsidian/plugins/margin-link');
  report.bundle = hash(await readFile(path.join(pluginDir, 'main.js')));
  assert.equal(report.bundle, hash(await readFile('dist/margin-link/main.js')));
  report.host = await page.title();
  await page.evaluate(async () => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const lines = ['# Reference aggregation', ''];
    for (let i = 0; i < 30; i++) {
      const duplicate = i < 8 || i === 15 || i === 29;
      if (!duplicate) await app.vault.create('Unique-' + i + '.md', '# Unique ' + i);
      if (i === 15 || i === 29) lines.push(...Array(55).fill('Scroll through this paragraph.\n'));
      lines.push(duplicate ? 'Reference [[Docs/Target' + (i % 2 ? '#^block' : '#Heading') + '|alias-' + i + ']].' : 'Read [[Unique-' + i + ']].', '');
    }
    await app.vault.create('References.md', lines.join('\n'));
  });
  async function mode(name) {
    await page.evaluate(async name => {
      await app.workspace.activeLeaf.setViewState({ type: 'markdown', state: { file: 'References.md', mode: name === 'reading' ? 'preview' : 'source', source: name === 'source' } });
      app.workspace.activeLeaf.view.setEphemeralState({ scroll: 0 });
    }, name);
    await wait(() => app.workspace.activeLeaf.view.contentEl.querySelector('.margin-link-card'));
    await settle();
  }
  const set = async changes => {
    await page.evaluate(async changes => {
      const p = app.plugins.plugins['margin-link'];
      Object.assign(p.preferences, changes); await p.savePreferences();
    }, changes); await settle();
  };
  const data = async () => hash(JSON.stringify(JSON.parse(await readFile(path.join(pluginDir, 'data.json'))).layouts));
  const markdown = async () => hash(await readFile(path.join(vault, 'References.md')));
  const sourceBefore = await markdown();
  await mode('live');
  if (await page.locator('.modal-container .vertical-tab-header').isVisible()) await page.keyboard.press('Escape');
  const badge = page.locator('.margin-link-reference-count').first();
  for (const placementMode of ['manual', 'free', 'snap', 'auto']) {
    await set({ placementMode, mergeReferences: false });
    await settle();
    const before = await data();
    const positions = () => page.locator('.margin-link-card-shell').evaluateAll(shells => shells.map(s => [s.dataset.relation, s.style.transform]));
    const original = await positions();
    await set({ mergeReferences: true });
    assert.equal(await badge.textContent(), '10');
    const merged = await positions();
    assert.equal(merged.filter(([k]) => k === 'file:Docs/Target.md').length, 1);
    assert.equal(await data(), before);
    await set({ mergeReferences: false });
    assert.deepEqual(await positions(), original);
    assert.equal(await data(), before);
    report.modes.push({ placementMode, individual: original.length, merged: merged.length, layoutBefore: before, layoutAfter: await data() });
  }
  for (const name of ['live', 'source', 'reading']) {
    await set({ mergeReferences: true });
    await mode(name);
    await badge.click();
    const panel = page.locator('.margin-link-reference-list');
    assert.equal(await panel.locator(':scope > div').count(), 10);
    assert.match(await panel.textContent(), /alias-29/);
    await panel.hover();
    await page.evaluate(() => app.plugins.plugins['margin-link'].refresh());
    await settle(); assert(await panel.isVisible());
    await page.keyboard.press('Escape');
    await panel.waitFor({state:'hidden'});
    await badge.click();
    await panel.getByRole('button', { name: '定位原文' }).last().click();
    await wait(() => {
      const view = app.workspace.activeLeaf.view, overlay = app.plugins.plugins['margin-link'].overlays.get(view);
      return view.file.path === 'References.md' && overlay.scroller.scrollTop > 300 && overlay.visibleRelations?.get(overlay.located)?.anchor.occurrence.alias === 'alias-29' &&
        !!view.contentEl.querySelector('.margin-link-anchor-ink,.margin-link-anchor-active');
    });
    report.interactions.push(name);
  }
  await mode('live');
  for (const enabled of [false, true]) {
    await set({ mergeReferences: enabled });
    report.performance.push(await page.evaluate(async enabled => {
      const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
      const d = o.diagnostics = { renders:0, routes:0, measurements:0, svgWrites:0, markerWrites:0, work:[] };
      const sample = () => ({ cards:o.cards.size, logical:(o.visibleRelations ?? o.cards).size, routes:o.batch?.relations.size,
        pairs:[...(o.visibleRelations ?? o.cards).values()].filter(r => r.continuation && !r.continuation[0].hidden).length,
        positions:[...o.cards].map(([key,c]) => [key,c.anchor.key,c.placement.y,c.anchor.rect.bottom - o.hostRect.top]) });
      const before = sample(), scroller = o.scroller;
      const owners = new Map([...o.cards].map(([key, c]) => [key, c.anchor.key]));
      let representativeSwitches = 0;
      const buttons = [...o.cards.values()].map(c => c.shell);
      for (const button of buttons) {
        button.dispatchEvent(new PointerEvent('pointerenter')); button.dispatchEvent(new PointerEvent('pointerleave'));
      }
      const hoverRoutes = d.routes, hoverSearches = d.routeSearches ?? 0;
      for (let i=0; i<48; i++) {
        scroller.scrollTop += i < 24 ? 26 : -26;
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,0)));
        for (const [key, c] of o.cards) {
          if (owners.has(key) && owners.get(key) !== c.anchor.key) representativeSwitches++;
          owners.set(key, c.anchor.key);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 300));
      const sorted = [...d.work].sort((a,b)=>a-b), q = n => sorted[Math.floor((sorted.length-1)*n)];
      o.diagnostics = undefined;
      return { enabled,before,after:sample(),hoverRoutes,hoverSearches,batches:d.routes,routeSearches:d.routeSearches ?? 0,
        groupRecomputes:d.groupRecomputes ?? 0, representativeSwitches, renderMs:{ p50:q(.5),p95:q(.95),max:q(1),raw:d.work } };
    }, enabled));
  }
  assert(report.performance.every(p => p.hoverRoutes === 0 && p.hoverSearches === 0 && p.groupRecomputes === 0 && p.representativeSwitches === 0 && p.renderMs.raw.length));
  report.markdownBefore = sourceBefore; report.markdownAfter = await markdown(); assert.equal(report.markdownAfter, sourceBefore);
  await mode('live'); await set({ mergeReferences:true });
  const fileCard = page.locator('[data-relation="file:Docs/Target.md"] .margin-link-card').first();
  const panel = page.locator('.margin-link-reference-list');
  const top = () => page.evaluate(() => { app.workspace.activeLeaf.view.setEphemeralState({ scroll:0 }); });
  await top(); await settle();
  const cdp=await page.context().newCDPSession(page);
  try {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1120,height:520,deviceScaleFactor:1,mobile:false});
    await settle(); await badge.click();
    report.narrow=await panel.evaluate(el=>{
      const r=el.getBoundingClientRect();return { fits:r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight+1, scrollable:el.scrollHeight>el.clientHeight };
    });
    assert(report.narrow.fits && report.narrow.scrollable);
    await page.keyboard.press('Escape');
  } finally {await cdp.send('Emulation.clearDeviceMetricsOverride');await cdp.detach();}
  await settle();
  for (const lines of ['always','numbers','hover','none']) {
    for (const lineStyle of ['straight','elbow','curve']) {
      await set({lines,lineStyle});
      const state = await page.evaluate(() => {
        const v=app.workspace.activeLeaf.view,o=app.plugins.plugins['margin-link'].overlays.get(v);
        const members=[...o.visibleRelations].filter(([,r])=>r.placement.key==='file:Docs/Target.md');
        return { members:members.length, paths:members.filter(([,r])=>!!r.path.getAttribute('d')).length,
          pairs:members.filter(([,r])=>r.continuation?.every(el=>!el.hidden)).length, svg:o.svg.style.display };
      });
      assert(state.members >= 2);
      if (lines==='numbers') assert.equal(state.pairs,state.members);
      else if (lines==='none') assert.equal(state.svg,'none');
      else assert(state.paths + state.pairs >= state.members);
      (report.lineModes ??= []).push({lines,lineStyle,...state});
    }
  }
  await set({lines:'always'});
  report.listProbe = await page.evaluate(() => {
    const v = app.workspace.activeLeaf.view, o = app.plugins.plugins['margin-link'].overlays.get(v);
    const card = o.cards.get('file:Docs/Target.md'), vault = app.vault, calls = [];
    const originals = new Map();
    for (const method of ['cachedRead','read','getFiles','getMarkdownFiles']) {
      originals.set(method,vault[method]); vault[method] = function(...args) { calls.push(method); return originals.get(method).apply(this,args); };
    }
    try {
      const focus = document.activeElement;
      card.badge.click();
      const panel = o.root.querySelector('.margin-link-reference-list');
      const stableFocus = document.activeElement === focus;
      const within = (box, region) => box.left >= region.left-1 && box.right <= region.right+1 && box.top >= region.top-1 && box.bottom <= region.bottom+1;
      const fits = within(panel.getBoundingClientRect(),v.contentEl.getBoundingClientRect());
      card.badge.click();
      const member = [...o.visibleRelations.values()].find(r=>r.placement.key === card.placement.key);
      o.hover(member.anchor.key);
      const one = [...o.visibleRelations.values()].filter(r=>r.path.classList.contains('margin-link-active')).length;
      o.hover(card.placement.key);
      const all = [...o.visibleRelations.values()].filter(r=>r.path.classList.contains('margin-link-active')).length;
      o.hover(undefined);
      return {calls, stableFocus, fits, one, all};
    } finally { for (const [method,fn] of originals) vault[method]=fn; }
  });
  assert.deepEqual(report.listProbe.calls,[]); assert(report.listProbe.stableFocus && report.listProbe.fits);
  assert.equal(report.listProbe.one,1); assert(report.listProbe.all>=2);
  await fileCard.click({modifiers:['Control']});
  await wait(()=>app.workspace.activeLeaf.view.file?.path==='Docs/Target.md');
  assert(await page.evaluate(()=>app.workspace.getLeavesOfType('markdown').some(l=>l.view.file?.path==='References.md')));
  await page.evaluate(()=>app.workspace.activeLeaf.detach()); await settle();
  for (const key of ['Enter','Space']) {
    await fileCard.focus(); await page.keyboard.press(key);
    await wait(()=>app.workspace.activeLeaf.view.file?.path==='Docs/Target.md');
    await mode('live');
  }
  await badge.focus(); await page.keyboard.press('Enter');
  assert(await panel.isVisible()); await page.keyboard.press('Escape');
  await page.evaluate(async()=>{const leaf=app.workspace.getLeaf('split','horizontal');await leaf.openFile(app.vault.getFileByPath('References.md'));});
  await settle();
  const split = await page.evaluate(()=>app.workspace.getLeavesOfType('markdown').filter(l=>l.view.file?.path==='References.md').map(l=>{
    const o=app.plugins.plugins['margin-link'].overlays.get(l.view);return !!o?.visibleRelations && o.view===l.view;
  })); assert.deepEqual(split,[true,true]);
  await page.evaluate(()=>{const v=app.workspace.activeLeaf.view;app.plugins.plugins['margin-link'].overlays.get(v).cards.get('file:Docs/Target.md').badge.click();});
  await panel.getByRole('button',{name:'定位原文'}).last().click();
  await wait(()=>{const p=app.plugins.plugins['margin-link'], active=app.workspace.activeLeaf, o=p.overlays.get(active.view);
    return o.scroller.scrollTop>300 && !!o.located && app.workspace.getLeavesOfType('markdown').filter(l=>l!==active).every(l=>p.overlays.get(l.view).scroller.scrollTop<100);});

  await page.evaluate(()=>app.workspace.activeLeaf.detach()); await settle();
  await mode('live');
  report.dense = await page.evaluate(async () => {
    const leaf=app.workspace.activeLeaf, v=leaf.view, p=app.plugins.plugins['margin-link'];
    const file=await app.vault.create('Ten.md', Array.from({length:10},(_,i)=>'Same [[Docs/Target|ref-'+i+']].').join('\n\n'));
    await leaf.openFile(file);
    const until=async predicate=>{
      const start=performance.now();
      while (!predicate()) {if(performance.now()-start>8000)throw Error('Dense reference fixture did not settle');await new Promise(r=>setTimeout(r,20));}
    };
    const o=p.overlays.get(v);
    await until(()=>o.visibleRelations?.size===10 && o.cards.size===1);
    const card=o.cards.values().next().value;
    const ids=[...o.visibleRelations.keys()];
    const complete=ids.every(id=>o.batch?.relations.has(id)||o.visibleRelations.get(id).continuation?.every(el=>!el.hidden));
    const original=v.editor.getValue(), cursor=v.editor.getCursor(), scroll=o.scroller.scrollTop;
    for(let i=0;i<4;i++){p.preferences.mergeReferences=!p.preferences.mergeReferences;await p.savePreferences();}
    await until(()=>o.visibleRelations?.size===10);
    return {count:card.badge.textContent,complete,unique:new Set(ids).size,cursor:JSON.stringify(cursor)===JSON.stringify(v.editor.getCursor()),
      scroll:o.scroller.scrollTop===scroll,text:v.editor.getValue()===original};
  });
  assert.deepEqual(report.dense,{count:'10',complete:true,unique:10,cursor:true,scroll:true,text:true});
  await mode('live');
  await badge.click();
  await page.evaluate(async()=>{const file=app.vault.getFileByPath('Docs/Target.md');await app.vault.delete(file);});
  await panel.waitFor({state:'hidden'});
  await wait(()=>!app.workspace.activeLeaf.view.contentEl.querySelector('.margin-link-reference-count'));
  await page.evaluate(async()=>{await app.vault.create('Docs/Target.md','# Heading');});
  await badge.waitFor();
  assert.equal(await badge.textContent(),'10');
  await page.evaluate(async()=>{await app.vault.rename(app.vault.getFileByPath('Docs/Target.md'),'Docs/Moved.md');});
  await badge.waitFor({state:'hidden'});
  await page.evaluate(async()=>{await app.vault.rename(app.vault.getFileByPath('Docs/Moved.md'),'Docs/Target.md');});
  await badge.waitFor();
  await badge.click(); await panel.getByRole('button',{name:'重新链接此处引用'}).first().click();
  const picker = page.locator('.margin-link-file-picker');
  await picker.getByRole('searchbox').fill('Unique-8.md');
  await picker.getByRole('button',{name:'Unique-8.md',exact:true}).click();
  await page.getByRole('button',{name:'保留子路径',exact:true}).click();
  await wait(()=>app.workspace.activeLeaf.view.editor.getValue().includes('Unique-8.md#Heading|alias-0'));
  await page.evaluate(()=>app.workspace.activeLeaf.view.editor.undo()); await settle();
  assert.equal(await badge.textContent(),'10');
  await badge.click(); await panel.getByRole('button',{name:'取消此处链接'}).nth(1).click();
  await wait(()=>app.workspace.activeLeaf.view.contentEl.querySelector('.margin-link-reference-count')?.textContent==='9');
  const textAfter = await page.evaluate(()=>app.workspace.activeLeaf.view.editor.getValue());
  assert(textAfter.includes('Reference alias-1.') && textAfter.includes('[[Docs/Target#Heading|alias-0]]'));
  await page.evaluate(()=>app.workspace.activeLeaf.view.editor.undo()); await settle();
  assert.equal(await badge.textContent(),'10');
  await page.evaluate(async()=>{const f=app.workspace.activeLeaf.view.file;await app.fileManager.renameFile(f,'Renamed references.md');});
  await badge.waitFor(); await settle();
  report.unload = await page.evaluate(async () => {
    const view=app.workspace.activeLeaf.view, overlay=app.plugins.plugins['margin-link'].overlays.get(view);
    const list=overlay.referenceList, tracked=new Set(), add=document.addEventListener, remove=document.removeEventListener;
    document.addEventListener=function(type,fn,...args){if(fn===list.escape || fn===list.outside)tracked.add(fn);return add.call(this,type,fn,...args);};
    document.removeEventListener=function(type,fn,...args){tracked.delete(fn);return remove.call(this,type,fn,...args);};
    try {
      overlay.cards.get('file:Docs/Target.md').badge.click();
      const registered=tracked.size;
      await app.plugins.disablePlugin('margin-link');
      return {registered, remaining:tracked.size, locateTimer:overlay.locateTimer !== undefined, panel:!!list.owner, relations:overlay.visibleRelations.size};
    } finally {document.addEventListener=add;document.removeEventListener=remove;}
  });
  assert.deepEqual(report.unload,{registered:2,remaining:0,locateTimer:false,panel:false,relations:0});
  assert.equal(await page.locator('.margin-link-overlay,.margin-link-reference-list,.margin-link-continuation,.margin-link-reference-count').count(),0);
  report.lifecycle = 'keyboard opens, Ctrl+click tab, split view, delete/recreate, single unlink and undo, source rename, unload with open list';
  assert.deepEqual(report.errors, []);
  report.status = 'passed';
} catch (e) {
  report.status = 'failed'; report.failure = String(e.stack ?? e); process.exitCode = 1;
} finally {
  await writeFile('artifacts/reference-aggregation-' + Date.now() + '.json', JSON.stringify(report,null,2));
  console.log(report.status, report.failure ?? '');
  await browser.close();
}
