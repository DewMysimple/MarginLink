// Production card DOM/CSS in Chromium, isolated from any real Vault.
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'artifacts/html-icon-0.2.10');
await mkdir(output, { recursive: true });
process.env.TMPDIR = resolve(output, 'tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
const bundle = await build({
  entryPoints: [resolve(root, 'src/view/card-renderer.ts')], bundle: true, write: false,
  format: 'iife', globalName: 'cardRenderer', plugins: [{ name: 'obsidian-icons', setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function setIcon() {}' }));
  } }]
});
const css = await readFile(resolve(root, 'styles.css'), 'utf8');
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1060, height: 700 }, deviceScaleFactor: 1 });
  for (const theme of ['light', 'dark']) for (const zoom of [1, 1.5]) {
    await page.setContent(`<!doctype html><html><head><style>
      :root { --font-interface: Arial,sans-serif; --font-ui-small: 13px; --font-medium: 500; --interactive-accent: #8b6cef; --background-modifier-border: #777; --background-modifier-box-shadow: #0002; --margin-link-shadow: none; }
      body { margin: 24px; font-family: Arial,sans-serif; color: ${theme === 'light' ? '#222' : '#ddd'}; background: ${theme === 'light' ? '#f4f4f4' : '#222'}; --background-primary: ${theme === 'light' ? '#fff' : '#282828'}; --background-secondary: ${theme === 'light' ? '#eee' : '#333'}; --text-normal: ${theme === 'light' ? '#222' : '#ddd'}; --text-muted: ${theme === 'light' ? '#686868' : '#aaa'}; zoom: ${zoom}; }
      .row { display:flex; align-items:center; gap:24px; margin:24px 0; }
      .sample { display:flex; flex-direction:column; gap:8px; font-size:10px; }
      .sample .margin-link-card-shell { position:relative; }
      ${css}
      </style></head><body><h2>MarginLink HTML · ${theme} · ${zoom * 100}%</h2><p>Production HTML card rendering and stylesheet; isolated Chromium fixture.</p><div id="cards"></div></body></html>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      HTMLElement.prototype.createSpan = function ({ cls, text } = {}) {
        const node = document.createElement('span'); if (cls) node.className = cls; if (text) node.textContent = text;
        this.appendChild(node); return node;
      };
      const sizes = { horizontal: [196, 48], square: [84, 84], icon: [32, 32] };
      for (const [shape, [width, height]] of Object.entries(sizes)) {
        const row = document.createElement('div'); row.className = 'row'; document.querySelector('#cards').appendChild(row);
        for (const extension of ['html', 'HTM', 'HTML']) {
          const sample = document.createElement('div'); sample.className = 'sample'; row.appendChild(sample);
          const caption = document.createElement('span'); caption.textContent = `${shape} ${width}×${height} · .${extension}`; sample.appendChild(caption);
          const shell = document.createElement('div'); shell.className = 'margin-link-card-shell'; shell.dataset.shape = shape;
          Object.assign(shell.style, { width: `${width}px`, height: `${height}px` }); sample.appendChild(shell);
          const button = document.createElement('button'); shell.appendChild(button);
          window.cardRenderer.renderCard(button, { label: 'Early Access', target: `References/stages.${extension}`, raw: `[[References/stages.${extension}|Early Access]]`, alias: 'Early Access', start: 0, end: 40 }, { file: { name: `stages.${extension}`, path: `References/stages.${extension}`, extension }, target: '', subpath: '' });
          button.classList.toggle('margin-link-compact', shape === 'icon');
        }
      }
    });
    const checks = await page.locator('.margin-link-card').evaluateAll(buttons => buttons.map(button => {
      const label = button.querySelector('.margin-link-html-label'), svg = button.querySelector('.margin-link-html-icon svg'), icon = button.querySelector('.margin-link-html-icon');
      const cardBox = button.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(label);
      const boxes = [svg.getBoundingClientRect(), range.getBoundingClientRect()];
      const within = boxes.every(box => box.left >= cardBox.left + .5 && box.right <= cardBox.right - .5 && box.top >= cardBox.top + .5 && box.bottom <= cardBox.bottom - .5);
      return { shape: button.parentElement.dataset.shape, text: label.textContent, within,
        title: button.getAttribute('title'), ariaLabel: button.getAttribute('aria-label'),
        accessible: document.getElementById(button.getAttribute('aria-labelledby')).textContent,
        decorative: icon.getAttribute('aria-hidden'), opacity: getComputedStyle(button).opacity,
        border: getComputedStyle(label).borderTopWidth,
        fill: [...svg.querySelectorAll('path')].every(path => path.getAttribute('fill') === 'currentColor') };
    }));
    for (const check of checks) {
      assert.equal(check.text, 'HTML'); assert.equal(check.within, true, `${theme}/${zoom}/${check.shape}: clipped artwork or label`);
      assert.equal(check.title, null); assert.equal(check.ariaLabel, null); assert.match(check.accessible, /stages\.(?:html|HTM|HTML) · HTML 文件/);
      assert.equal(check.decorative, 'true'); assert.equal(check.opacity, '1'); assert.equal(check.border, '0px'); assert.equal(check.fill, true);
    }
    results.push({ theme, zoom, cards: checks.length, checks });
    await page.screenshot({ path: resolve(output, `${theme}-${zoom}.png`), fullPage: true });
  }
  const scenariosPassed = results.reduce((sum, result) => sum + result.cards, 0);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ status: 'passed', scenariosPassed, results }, null, 2));
  console.log(`HTML icon: ${scenariosPassed} actual DOM/CSS cases passed. Screenshots: ${output}`);
} catch (error) {
  const status = browser ? 'failed' : 'blocked';
  const message = error instanceof Error ? error.message : String(error);
  const scenariosPassed = results.reduce((sum, result) => sum + result.cards, 0);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ status, error: message, scenariosPassed, results }, null, 2));
  console.error(`HTML icon ${status}: ${message}`);
  process.exitCode = 1;
} finally { await browser?.close(); }

