// Called only by desktop-test.mjs after it verifies the isolated test vault.
/* global app */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function runFileRecognitionScenario({ page, mode, settings, closeSettings, flipToggle }) {
  const files = ['References/stages.html', 'MarginLink 测试.HTM', 'MarginLink 导图.XMind'];
  const readFixtures = () => Promise.all(files.map(file => readFile(`test-vault/${file}`)));
  const before = await readFixtures();
  await mode('source', false);
  const previous = await page.evaluate(() => ({
    source: app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file?.path === 'MarginLink Demo.md').id,
    explorer: app.workspace.getLeavesOfType('file-explorer')[0]?.id,
    collapsed: app.workspace.leftSplit.collapsed,
    showAll: !!app.vault.getConfig('showUnsupportedFiles')
  }));
  assert.equal(previous.showAll, false, 'Run setup-test-vault.mjs with Show all file types disabled');
  const row = file => page.locator(`.nav-files-container .nav-file-title[data-path="${file}"]`);
  const folder = page.locator('.nav-files-container .nav-folder-title[data-path="References"]');
  let expandedFolder = false;
  const restoreSource = () => page.evaluate(async id => {
    const source = app.workspace.getLeafById(id);
    await source.setViewState({ type: 'markdown', state: { file: 'MarginLink Demo.md', mode: 'source', source: false } });
    for (const leaf of app.workspace.getLeavesOfType('margin-link-attachment')) if (leaf !== source) leaf.detach();
    app.workspace.setActiveLeaf(source, { focus: true });
  }, previous.source);
  const waitForAttachment = file => page.waitForFunction(path => {
    const view = app.workspace.activeLeaf?.view;
    return view?.getViewType() === 'margin-link-attachment' && view.file?.path === path
      && view.contentEl.querySelector('h2')?.textContent === view.file.name
      && !view.contentEl.querySelector('iframe,webview,script,.cm-editor,[contenteditable=true]');
  }, file);
  const reloadPlugin = () => page.evaluate(async () => {
    await app.plugins.disablePluginAndSave('margin-link');
    await app.plugins.enablePluginAndSave('margin-link');
  });
  const changeHtml = async () => {
    const owner = await settings('MarginLink');
    try {
      const html = owner.locator('[data-margin-key="recognizeHtml"]');
      await owner.locator('[data-margin-key="recognizeXmind"]').waitFor();
      await flipToggle(owner, html.locator('.checkbox-container'));
      await html.getByText(/关闭再启用 MarginLink/).waitFor();
      await page.evaluate(() => app.plugins.plugins['margin-link'].flush());
    } finally { await closeSettings(owner); }
  };
  try {
    await page.evaluate(async () => {
      app.workspace.leftSplit.expand();
      await app.workspace.ensureSideLeaf('file-explorer', 'left', { reveal: true });
    });
    await folder.waitFor();
    expandedFolder = await folder.evaluate(el => el.parentElement.classList.contains('is-collapsed'));
    if (expandedFolder) await folder.click();
    for (const file of files) await row(file).waitFor();
    await row(files[2]).click();
    await waitForAttachment(files[2]);
    await restoreSource();
    await page.locator('.margin-link-card').filter({ hasText: 'Early Access HTML' }).click();
    await waitForAttachment(files[0]);
    await restoreSource();

    await changeHtml();
    await row(files[0]).waitFor(); // Saved preference only takes effect on reload.
    await reloadPlugin();
    for (const file of files.slice(0, 2)) await row(file).waitFor({ state: 'hidden' });
    await row(files[2]).waitFor();
    assert.equal(await page.evaluate(() => !!app.vault.getConfig('showUnsupportedFiles')), false);

    await changeHtml();
    await reloadPlugin();
    for (const file of files) await row(file).waitFor();
    assert.deepEqual(await readFixtures(), before);
  } finally {
    // Preserve a reusable SOURCE leaf even on hosts that reused it to open
    // the attachment. Restore the presentation before the rest of the suite.
    await restoreSource();
    if (expandedFolder && await folder.isVisible()) await folder.click();
    await page.evaluate(({ explorer, collapsed }) => {
      if (!explorer) app.workspace.getLeavesOfType('file-explorer').forEach(leaf => leaf.detach());
      if (collapsed) app.workspace.leftSplit.collapse();
    }, previous);
  }
}
