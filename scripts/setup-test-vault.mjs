import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const vault = path.resolve('test-vault');
await mkdir(path.join(vault, '.obsidian/plugins/margin-link'), { recursive: true });
for (const file of ['manifest.json', 'main.js', 'styles.css']) await copyFile(file, path.join(vault, '.obsidian/plugins/margin-link', file));
const fixtures = {
  'MarginLink Demo.md': await readFile(new URL('../tests/fixtures/demo.md', import.meta.url), 'utf8'),
  'Note A.md': '# Note A\n\n## Discussion\n\nAn existing note.\n\nReturn to [[MarginLink Demo]].\n',
  'Folder/Note A.md': '# Another Note A\n\nA distinct file with the same basename.\n',
  'Board.canvas': '{"nodes":[],"edges":[]}',
  'References/stages.html': '<!doctype html><title>Stages</title><p>This fixture is not executed by MarginLink.</p>',
  'pixel.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="currentColor"/></svg>',
  '.obsidian/community-plugins.json': '["margin-link"]',
  '.obsidian/plugins/margin-link/data.json': JSON.stringify({ enabled: true, lines: 'hover', density: 'auto', layout: 'balanced' }),
  '.obsidian/app.json': JSON.stringify({ readableLineLength: true, livePreview: true, defaultViewMode: 'source', useMarkdownLinks: false }),
  '.obsidian/appearance.json': JSON.stringify({ theme: 'obsidian', cssTheme: '' }),
  '.obsidian/core-plugins.json': '["file-explorer","switcher","command-palette"]',
  '.obsidian/workspace.json': JSON.stringify({ main: { id: 'main', type: 'split', children: [{ id: 'tabs', type: 'tabs', children: [{ id: 'demo', type: 'leaf', state: { type: 'markdown', state: { file: 'MarginLink Demo.md', mode: 'source', source: false } } }] }], direction: 'vertical' }, active: 'demo', lastOpenFiles: ['MarginLink Demo.md'] })
};
for (const [file, contents] of Object.entries(fixtures)) {
  await mkdir(path.dirname(path.join(vault, file)), { recursive: true });
  await writeFile(path.join(vault, file), contents, 'utf8');
}
console.log(vault);
