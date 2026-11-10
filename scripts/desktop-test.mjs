// Run only against the isolated test profile launched with remote-debugging-port=9223.
/* global app */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
assert(page, 'Isolated Obsidian is not running');
assert.equal(await page.evaluate(() => app.vault.getName()), 'test-vault', 'Never run this suite in a real vault');
await mkdir('artifacts', { recursive: true });
const errors = [];
const results = [];
let currentScenario = 'setup';
page.on('pageerror', error => errors.push({ message: String(error), stack: error.stack, scenario: currentScenario }));
const cdp = await page.context().newCDPSession(page);
const runtimeErrors = [];
const executionContexts = new Map();
cdp.on('Runtime.executionContextCreated', event => executionContexts.set(event.context.id, event.context));
await cdp.send('Runtime.enable');
cdp.on('Runtime.exceptionThrown', event => {
  const record = { scenario: currentScenario, details: event.exceptionDetails, context: executionContexts.get(event.exceptionDetails.executionContextId) };
  runtimeErrors.push(record);
});
const viewport = (width, height = 1000) => cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const text = () => page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.getValue());
const mode = async (mode, source = false) => {
  await page.evaluate(async ({ mode, source }) => {
    const leaf = app.workspace.getLeavesOfType('markdown')[0];
    await leaf.setViewState({ type: 'markdown', state: { file: 'MarginLink Demo.md', mode, source } });
  }, { mode, source });
};
const select = async selected => {
  await page.evaluate(selected => {
    const view = app.workspace.getLeavesOfType('markdown')[0].view;
    const at = view.editor.getValue().indexOf(selected);
    if (at < 0) throw new Error(`Fixture selection missing: ${selected}`);
    view.editor.setSelection(view.editor.offsetToPos(at), view.editor.offsetToPos(at + selected.length));
    view.editor.focus();
  }, selected);
};
const command = async query => {
  await page.keyboard.press('Control+p');
  await page.locator('.prompt-input').fill(query);
  await page.keyboard.press('Enter');
};
const choose = async () => {
  await page.locator('.prompt-input').fill('Folder/Note A.md');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.prompt-input'));
};
const settings = async tab => {
  const context = page.context();
  await page.keyboard.press('Control+,');
  let owner;
  for (let i = 0; i < 100 && !owner; i++) {
    for (const candidate of context.pages()) {
      if (!candidate.isClosed() && await candidate.locator('.vertical-tab-nav-item').first().isVisible()) { owner = candidate; break; }
    }
    if (!owner) await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert(owner, 'Native settings did not open');
  const name = tab === 'Appearance' ? /^(Appearance|外观)$/ : /^(Community plugins|第三方插件)$/;
  await owner.locator('.vertical-tab-nav-item').filter({ hasText: name }).first().click();
  return owner;
};
const persist = async () => page.evaluate(async () => {
  await Promise.all(app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view.save()));
  await app.workspace.requestSaveLayout().run();
});
const closeSettings = async owner => {
  // Let native dropdown fitting and theme/layout observers finish before destroying
  // the detached document. Closing it in the same task as selectOption races Obsidian.
  await owner.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  if (owner === page) await owner.keyboard.press('Escape');
  if (owner !== page) {
    const closed = owner.waitForEvent('close');
    await owner.locator('.titlebar-button.mod-close').click();
    await closed;
    await page.bringToFront();
    await page.evaluate(() => {
      const leaf = app.workspace.getMostRecentLeaf();
      app.workspace.setActiveLeaf(leaf, { focus: true });
      if (leaf.view.getMode?.() === 'source') leaf.view.editor.focus();
    });
  }
};
const check = async (name, run) => { currentScenario = name; await run(); results.push({ name, passed: true }); console.log(`PASS ${name}`); };
try {
  await persist();
  await page.reload(); await page.waitForSelector('.margin-link-overlay');
  await page.keyboard.press('Escape');
  await viewport(1680);
  await mode('source', false);
  const original = await text();
  assert(original.includes('Select Early Access'), 'Run setup-test-vault.mjs first');
  await check('Live Preview: seven native occurrences; embeds/code/Markdown links excluded', async () => {
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
    assert.equal(await page.locator('.margin-link-unresolved').count(), 1);
  });
  await check('hover highlights exactly one connector and its source', async () => {
    await page.locator('.margin-link-card').first().hover();
    assert.equal(await page.locator('.margin-link-connector.margin-link-active').count(), 1);
    assert.equal(await page.locator('.margin-link-anchor-active').count(), 1);
    await page.screenshot({ path: 'artifacts/live-preview-hover.png' });
  });
  await check('command creates an exact native Wikilink and preserves surrounding text', async () => {
    await select('Early Access to create');
    // Narrow selection to the original alias using the public Editor API.
    await page.evaluate(() => {
      const editor = app.workspace.getLeavesOfType('markdown')[0].view.editor;
      const from = editor.getCursor('from'); editor.setSelection(from, { line: from.line, ch: from.ch + 12 });
    });
    await command('Link selected text to file'); await choose();
    assert.equal(await text(), original.replace('Select Early Access', 'Select [[Folder/Note A.md|Early Access]]'));
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 8);
  });
  await check('single transaction undo/redo also removes/restores the derived card', async () => {
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo());
    assert.equal(await text(), original);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.redo());
    assert((await text()).includes('Select [[Folder/Note A.md|Early Access]]'));
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 8);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo());
  });
  await check('Esc from picker never changes a character', async () => {
    await select('中文文字'); const before = await text();
    await command('Link selected text to file'); await page.keyboard.press('Escape');
    assert.equal(await text(), before);
  });
  await check('changed source while choosing is rejected without wrapping another range', async () => {
    await select('中文文字'); await command('Link selected text to file');
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.replaceRange('Changed ', { line: 0, ch: 0 }));
    const changed = await text(); await choose(); assert.equal(await text(), changed);
    assert((await page.locator('.notice').allTextContents()).some(x => /发生变化/.test(x)));
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo());
  });
  await check('drag handle → right margin → picker creates lossless Chinese alias', async () => {
    await select('中文文字');
    const handle = page.locator('.margin-link-handle:not([hidden])'); await handle.waitFor();
    const start = await handle.boundingBox(); const body = await page.locator('.cm-content').boundingBox();
    await page.mouse.move(start.x + 13, start.y + 12); await page.mouse.down();
    await page.mouse.move(body.x + body.width + 75, start.y + 12, { steps: 12 });
    await page.waitForSelector('.margin-link-drop-right.margin-link-drop-active');
    await page.screenshot({ path: 'artifacts/dragging.png' });
    await page.mouse.up(); await page.waitForSelector('.prompt-input'); await choose();
    assert.equal(await text(), original.replace('中文文字', '[[Folder/Note A.md|中文文字]]'));
    await page.screenshot({ path: 'artifacts/created.png' });
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo());
  });
  await check('drag onto body is canceled without a modal or write', async () => {
    await select('中文文字'); const before = await text();
    const handle = page.locator('.margin-link-handle:not([hidden])'); await handle.waitFor();
    const start = await handle.boundingBox(); const body = await page.locator('.cm-content').boundingBox();
    await page.mouse.move(start.x + 13, start.y + 12); await page.mouse.down();
    await page.mouse.move(body.x + 100, start.y - 30, { steps: 8 }); await page.mouse.up();
    assert.equal(await page.locator('.prompt-input').count(), 0); assert.equal(await text(), before);
  });
  await check('Reading view maps each source occurrence once and never shows an edit handle', async () => {
    await mode('preview'); await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
    assert.equal(await page.locator('.margin-link-handle:not([hidden])').count(), 0);
    await page.locator('.margin-link-card').first().hover();
    assert.equal(await page.locator('a.internal-link.margin-link-anchor-active').count(), 1);
    await page.screenshot({ path: 'artifacts/reading.png' });
  });
  await check('Source mode uses actual visible source token positions', async () => {
    await mode('source', true); await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
    assert((await page.locator('.cm-content').innerText()).includes('[[Note A|关键观点]]'));
    await page.screenshot({ path: 'artifacts/source.png' });
  });
  await check('unresolved card does not create or open a missing file', async () => {
    const count = await page.evaluate(() => app.vault.getFiles().length);
    await page.locator('.margin-link-unresolved').click();
    assert.equal(await page.evaluate(() => app.vault.getFiles().length), count);
    assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), 'MarginLink Demo.md');
  });
  await check('resolved card opens its exact existing target', async () => {
    await page.locator('.margin-link-card').filter({ hasText: '同名文件' }).click();
    await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path === 'Folder/Note A.md');
    await mode('source', false);
  });
  await check('split panes stay scoped to their own files', async () => {
    await viewport(2600);
    await page.evaluate(async () => {
      const file = app.vault.getFileByPath('Note A.md'); await app.workspace.getLeaf('split').openFile(file);
    });
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-overlay').length === 2 && [...document.querySelectorAll('.margin-link-overlay')].every(e => e.querySelector('.margin-link-card')));
    const sets = await page.locator('.margin-link-overlay').evaluateAll(es => es.map(e => [...e.querySelectorAll('.margin-link-card-label')].map(x => x.textContent)));
    assert(sets.some(labels => labels.length === 1 && labels[0] === 'MarginLink Demo'));
    assert(sets.some(labels => labels.length === 7));
    await page.screenshot({ path: 'artifacts/split.png' });
  });
  await check('narrow panes safely hide cards without horizontal overflow', async () => {
    await viewport(920);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 0);
    assert(await page.evaluate(() => [...document.querySelectorAll('.margin-link-host')].every(el => el.scrollWidth <= el.clientWidth + 1)));
    await page.screenshot({ path: 'artifacts/narrow.png' });
    await page.evaluate(() => {
      const leaves = app.workspace.getLeavesOfType('markdown'); leaves.find(l => l.view.file.path === 'Note A.md').detach();
    });
    await viewport(1680);
  });
  await check('unhandled HTML is recognized but never launched externally by the card', async () => {
    await mode('source', false);
    await page.locator('.margin-link-card').filter({ hasText: 'Early Access HTML' }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.notice')].some(n => n.textContent.includes('无法通过公开 API')));
    assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path), 'MarginLink Demo.md');
  });
  await check('switching the active file cancels a pending picker without a write', async () => {
    await select('中文文字'); await command('Link selected text to file');
    await page.evaluate(async () => {
      const leaf = app.workspace.getLeavesOfType('markdown')[0]; await leaf.openFile(app.vault.getFileByPath('Note A.md'));
    });
    await page.waitForFunction(() => !document.querySelector('.prompt-input'));
    await mode('source', false); assert.equal(await text(), original);
  });
  await check('multiple editor selections are rejected without opening a picker', async () => {
    await page.evaluate(() => {
      const e = app.workspace.getLeavesOfType('markdown')[0].view.editor;
      e.setSelections([{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 6 } }, { anchor: { line: 4, ch: 0 }, head: { line: 4, ch: 1 } }]); e.focus();
    });
    await command('Link selected text to file');
    assert.equal(await page.locator('.prompt-input').count(), 0); assert.equal(await text(), original);
  });
  await check('left-margin drag temporarily places the new card on the left', async () => {
    await select('中文文字'); const handle = page.locator('.margin-link-handle:not([hidden])'); await handle.waitFor();
    const start = await handle.boundingBox(); const body = await page.locator('.cm-content').boundingBox();
    await page.mouse.move(start.x + 13, start.y + 12); await page.mouse.down();
    await page.mouse.move(body.x - 70, start.y, { steps: 10 }); await page.mouse.up();
    await page.waitForSelector('.prompt-input'); await choose();
    const card = page.locator('.margin-link-card').filter({ hasText: '中文文字' }); await card.waitFor();
    const rect = await card.boundingBox(); assert(rect.x + rect.width < body.x);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.undo());
  });
  await check('keyboard focus and Enter open an existing card target', async () => {
    const card = page.locator('.margin-link-card').filter({ hasText: '同名文件' });
    await card.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => app.workspace.getLeavesOfType('markdown')[0].view.file.path === 'Folder/Note A.md');
    await mode('source', false);
  });
  await check('Reading view distinguishes identical aliases in Markdown, references and Wikilinks', async () => {
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue('[same](Note%20A.md) [[Note A|same]] [same][ref] [[Note A.md|same]]\n\n[ref]: Note%20A.md\n'));
    await mode('preview');
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 2);
    const cards = page.locator('.margin-link-card');
    for (const [i, expected] of [[0, 1], [1, 3]]) {
      await cards.nth(i).hover();
      const actual = await page.locator('.markdown-preview-view a.internal-link, .markdown-preview-view a.external-link').evaluateAll(es => es.findIndex(e => e.classList.contains('margin-link-anchor-active')));
      assert.equal(actual, expected);
    }
    await mode('source', false); await page.evaluate(original => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(original), original);
  });
  await check('long-note scrolling renders only visible anchors and no floating old links', async () => {
    await page.evaluate(original => {
      const e = app.workspace.getLeavesOfType('markdown')[0].view.editor;
      e.setValue(original + '\n' + 'A long paragraph for viewport testing.\n\n'.repeat(220) + '[[Note A|End target]]\n');
      e.setCursor(e.offsetToPos(e.getValue().length)); e.scrollIntoView({ from: e.getCursor(), to: e.getCursor() }, true);
    }, original);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 1 && document.querySelector('.margin-link-card-label')?.textContent === 'End target');
    await page.screenshot({ path: 'artifacts/scroll.png' });
    await page.evaluate(original => {
      const e = app.workspace.getLeavesOfType('markdown')[0].view.editor; e.setValue(original); e.setCursor({ line: 0, ch: 0 });
    }, original);
    await page.locator('.cm-scroller').evaluate(e => { e.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
  });
  await check('rename/delete events refresh resolution without rewriting source', async () => {
    await page.evaluate(async original => {
      await app.vault.create('Refresh target.md', '# Temporary test fixture\n');
      app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(original + '\n[[Refresh target.md|Refresh fixture]]\n');
    }, original);
    const card = page.locator('.margin-link-card').filter({ hasText: 'Refresh fixture' }); await card.waitFor();
    await page.evaluate(async () => app.vault.rename(app.vault.getFileByPath('Refresh target.md'), 'Refresh renamed.md'));
    await page.waitForFunction(() => [...document.querySelectorAll('.margin-link-unresolved')].some(e => e.textContent.includes('Refresh fixture')));
    assert((await text()).includes('[[Refresh target.md|Refresh fixture]]'));
    await page.evaluate(async original => {
      await app.vault.delete(app.vault.getFileByPath('Refresh renamed.md'));
      app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(original);
    }, original);
  });
  await check('native light/dark theme switching keeps cards readable', async () => {
    const control = process.env.MARGINLINK_THEME_CONTROL === '1';
    if (control) {
      await persist(); await writeFile('test-vault/.obsidian/community-plugins.json', '[]');
      await page.reload(); await page.waitForSelector('.cm-content');
      assert.equal(await page.locator('.margin-link-overlay').count(), 0);
    }
    let owner = await settings('Appearance');
    currentScenario = 'theme: selecting light';
    await owner.locator('.setting-item').filter({ hasText: /Base color scheme|基础颜色/ }).locator('select').first().selectOption('moonstone');
    currentScenario = 'theme: closing light settings';
    await closeSettings(owner); await page.waitForSelector('body.theme-light');
    currentScenario = 'theme: capturing light';
    if (!control) await page.locator('.margin-link-card').first().hover();
    await page.screenshot({ path: 'artifacts/light.png' });
    currentScenario = 'theme: opening dark settings';
    owner = await settings('Appearance');
    currentScenario = 'theme: selecting dark';
    await owner.locator('.setting-item').filter({ hasText: /Base color scheme|基础颜色/ }).locator('select').first().selectOption('obsidian');
    currentScenario = 'theme: closing dark settings';
    await closeSettings(owner); await page.waitForSelector('body.theme-dark');
    if (control) {
      await writeFile('test-vault/.obsidian/community-plugins.json', '["margin-link"]');
      await page.reload(); await page.waitForSelector('.margin-link-overlay');
    }
  });
  await check('table selections are refused rather than writing an unescaped alias pipe', async () => {
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue('| Early Access |\n| --- |\n| Other text |\n'));
    await select('Early Access'); const before = await text(); await command('Link selected text to file');
    assert.equal(await page.locator('.prompt-input').count(), 0); assert.equal(await text(), before);
    assert((await page.locator('.notice').allTextContents()).some(t => t.includes('表格')));
    await page.evaluate(original => app.workspace.getLeavesOfType('markdown')[0].view.editor.setValue(original), original);
  });
  await check('display toggle only saves UI preferences and never changes Markdown', async () => {
    await command('Toggle margin links'); await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 0);
    assert.equal(await text(), original); await command('Toggle margin links');
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-card').length === 7);
  });
  await check('disable/enable cleans every overlay and highlight, then restores existing reading links', async () => {
    await mode('preview'); const owner = await settings('Community plugins');
    const toggle = owner.locator('.setting-item').filter({ hasText: 'MarginLink contributors' }).locator('.checkbox-container');
    await toggle.focus(); await owner.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('.margin-link-overlay, .margin-link-host, .margin-link-anchor-active'));
    await toggle.focus(); await owner.keyboard.press('Space'); await closeSettings(owner);
    await page.waitForFunction(() => document.querySelectorAll('.margin-link-overlay').length === 1 && document.querySelectorAll('.margin-link-card').length === 7);
    await mode('source', false); assert.equal(await text(), original);
  });
  // This exact native Electron/CDP diagnostic is also reproduced after removing
  // ALL community plugins and reloading (MARGINLINK_THEME_CONTROL=1). Keep it visible
  // in the report, but do not mislabel it as a failure of plugin behavior assertions.
  // Every other uncaught error remains fatal.
  const isKnownHostWarning = error => error.message === 'illegal access' && error.stack === ''
    && ['theme: closing light settings', 'theme: closing dark settings'].includes(error.scenario)
    && runtimeErrors.some(event => event.scenario === error.scenario
      && event.details.scriptId === '1' && event.details.lineNumber === 0
      && event.details.url === 'app://obsidian.md/index.html'
      && event.details.exception?.value === 'illegal access');
  const hostWarnings = errors.filter(isKnownHostWarning);
  const unexpectedErrors = errors.filter(error => !isKnownHostWarning(error));
  assert.deepEqual(unexpectedErrors, []);
  await mode('source', false);
  await page.evaluate(() => app.workspace.getLeavesOfType('markdown')[0].view.editor.setCursor({ line: 0, ch: 0 }));
  await page.locator('.margin-link-card').first().hover();
  await page.screenshot({ path: 'artifacts/final-preview.png' });
  await persist();
  await writeFile('artifacts/desktop-results.json', JSON.stringify({ results, errors: unexpectedErrors, hostWarnings, controlRun: process.env.MARGINLINK_THEME_CONTROL === '1' }, null, 2));
  console.log(`${results.length} desktop scenarios passed; ${hostWarnings.length} known host/CDP warnings (also reproduced without the plugin).`);
} finally {
  if (errors.length) await writeFile('artifacts/desktop-diagnostics.json', JSON.stringify({ errors, runtimeErrors }, null, 2));
  await browser.close();
}
