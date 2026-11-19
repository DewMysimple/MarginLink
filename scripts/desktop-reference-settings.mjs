/* global app */
// Follow desktop-reference-aggregation.mjs in its disposable vault.
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9238');
try {
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().startsWith('app://obsidian.md/'));
  const vault=path.resolve(await page.evaluate(()=>app.vault.adapter.getBasePath()));
  assert.equal(path.dirname(vault).toLowerCase(),path.resolve('test-vault/.v03-desktop').toLowerCase());
  assert.match(path.basename(vault),/^[a-f0-9]{32}$/);
  await page.evaluate(async()=>{
    await app.plugins.enablePlugin('margin-link');
    const p=app.plugins.plugins['margin-link'];
    await app.vault.createFolder('Near'); await app.vault.createFolder('Other');
    await app.vault.create('Other/Plan.md','# Older plan');
    const f=await app.vault.create('Near/Source.md','[[Plan|one]] and [[Other/Plan|two]]');
    await app.workspace.activeLeaf.openFile(f);
    p.preferences.mergeReferences=false; await p.savePreferences();
    await p.openSettingsPanel();
  });
  const control=page.locator('[data-margin-key="mergeReferences"] .checkbox-container').last();
  await control.waitFor(); await control.click();
  await page.waitForFunction(()=>app.plugins.plugins['margin-link'].preferences.mergeReferences);
  await page.evaluate(()=>{
    const leaf=app.workspace.getLeavesOfType('margin-link-settings')[0];
    leaf.detach(); app.workspace.rightSplit.collapse();
    app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0],{focus:true});
  });
  const badge=page.locator('.margin-link-reference-count');
  await badge.waitFor(); assert.equal(await badge.textContent(),'2');
  const original=await page.locator('[data-relation="file:Other/Plan.md"] .margin-link-card').elementHandle();
  await page.evaluate(()=>{
    const editor=app.workspace.activeLeaf.view.editor;
    editor.replaceRange('Prefix ',{line:0,ch:0});
  });
  await page.waitForTimeout(450);
  assert(await original.evaluate(el=>el.isConnected));
  await badge.click();
  await page.evaluate(async()=>{await app.vault.create('Near/Plan.md','# Near plan');});
  await badge.waitFor({state:'hidden'});
  assert.equal(await page.locator('.margin-link-reference-list').count(),0);
  assert.equal(await page.locator('[data-relation="file:Near/Plan.md"]').count(),1);
  assert.equal(await page.locator('[data-relation="file:Other/Plan.md"]').count(),1);
  await page.evaluate(async()=>{await app.vault.delete(app.vault.getFileByPath('Near/Plan.md'));});
  await badge.waitFor(); assert.equal(await badge.textContent(),'2');
  await original.dispose();
  console.log('passed: settings toggle, stable card after offset change, same-basename resolver split and merge');
} finally {await browser.close();}
