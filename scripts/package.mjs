import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
const output = path.resolve('dist/margin-link');
await mkdir(output, { recursive: true });
for (const file of ['manifest.json', 'main.js', 'styles.css']) await copyFile(file, path.join(output, file));
await copyFile('LICENSE', path.join(output, 'LICENSE'));
const meta = JSON.parse(await readFile('artifacts/bundle-meta.json', 'utf8'));
// esbuild can resolve a junction-backed node_modules outside the build root.
// Find each input's actual package owner instead of assuming a relative prefix.
const packages = new Map();
const owners = new Map();
for (const file of Object.keys(meta.inputs)) {
  let directory = path.dirname(path.resolve(file));
  const visited = [];
  let owner;
  while (directory !== path.dirname(directory)) {
    if (owners.has(directory)) { owner = owners.get(directory); break; }
    visited.push(directory);
    try {
      const info = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      owner = { directory, name: info.name };
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    directory = path.dirname(directory);
  }
  for (const location of visited) owners.set(location, owner);
  if (owner && owner.directory !== process.cwd()) packages.set(owner.directory, owner.name);
}
const notices = [];
for (const [directory, name] of [...packages].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)) {
  let license = '';
  for (const filename of ['license', 'LICENSE', 'license.md', 'LICENSE.md', 'LICENSE-MIT', 'LICENSE.txt']) {
    try { license = await readFile(path.join(directory, filename), 'utf8'); break; } catch { /* Try the next conventional license filename. */ }
  }
  if (!license) throw new Error(`Missing bundled dependency license: ${name}`);
  notices.push(`${name}\n${'='.repeat(name.length)}\n${license}`);
}
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'), 'utf8');
await writeFile('dist/INSTALL.txt', '将 margin-link 文件夹复制到 <Vault>/.obsidian/plugins/，然后在设置 → 第三方插件中启用 MarginLink。\n详见项目 README.md。\n', 'utf8');
console.log(`Installable plugin: ${output}`);
