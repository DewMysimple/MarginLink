import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('dist/margin-link');
await mkdir(output, { recursive: true });
for (const file of ['manifest.json', 'main.js', 'styles.css']) await copyFile(file, path.join(output, file));
await copyFile('LICENSE', path.join(output, 'LICENSE'));
const meta = JSON.parse(await readFile('artifacts/bundle-meta.json', 'utf8'));
const packages = new Set(Object.keys(meta.inputs).map(file => /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(file)?.[1]).filter(Boolean));
const notices = [];
for (const name of [...packages].sort()) {
  let license = '';
  for (const filename of ['license', 'LICENSE', 'license.md', 'LICENSE.md', 'LICENSE-MIT', 'LICENSE.txt']) {
    try { license = await readFile(path.join('node_modules', name, filename), 'utf8'); break; } catch { /* Try the next conventional license filename. */ }
  }
  if (!license) throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(`${name}\n${'='.repeat(name.length)}\n${license}`);
}
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'), 'utf8');
await writeFile('dist/INSTALL.txt', '将 margin-link 文件夹复制到 <Vault>/.obsidian/plugins/，然后在设置 → 第三方插件中启用 MarginLink。\n详见项目 README.md。\n', 'utf8');
console.log(`Installable plugin: ${output}`);
