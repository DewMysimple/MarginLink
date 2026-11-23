import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';

const pluginId = 'margin-link';
const releaseVersion = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
const manifestBytes = await readFile('manifest.json');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.id !== pluginId || typeof manifest.version !== 'string' || manifest.version !== packageInfo.version ||
  !new RegExp(`^${releaseVersion}$`).test(manifest.version)) {
  throw new Error('manifest.json and package.json must agree on the plugin version.');
}

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
const files = {
  'manifest.json': manifestBytes,
  'main.js': await readFile('main.js'),
  'styles.css': await readFile('styles.css'),
  LICENSE: await readFile('LICENSE'),
  'THIRD_PARTY_NOTICES.txt': Buffer.from(notices.join('\n\n'), 'utf8')
};
const distribution = path.join(await realpath(process.cwd()), 'dist');
await mkdir(distribution, { recursive: true });
if (await realpath(distribution) !== distribution) throw new Error('dist must be a local project directory.');

const output = path.join(distribution, pluginId);
const zipName = `${pluginId}-${manifest.version}.zip`;
const zipPath = path.join(distribution, zipName);
const windows = process.platform === 'win32';
const sameName = (a, b) => windows ? a.toLowerCase() === b.toLowerCase() : a === b;
const entries = await readdir(distribution, { withFileTypes: true });
const previousDirectory = entries.find(entry => sameName(entry.name, pluginId));
const previousArchive = entries.find(entry => sameName(entry.name, zipName));
if (previousDirectory && !previousDirectory.isDirectory()) throw new Error(`Expected a generated directory at ${output}`);
if (previousArchive && !previousArchive.isFile()) throw new Error(`Expected a ZIP file at ${zipPath}`);

const staging = await mkdtemp(path.join(distribution, '.margin-link-package-'));
const stagedDirectory = path.join(staging, pluginId);
const stagedArchive = path.join(staging, zipName);
const backupDirectory = path.join(staging, 'previous');
const clearStaging = async () => {
  if (await realpath(staging) !== staging) throw new Error(`Invalid package staging directory: ${staging}`);
  await rm(staging, { recursive: true, force: true });
};
let preserveStaging = false;
let removed = 0;
try {
  const archiveFiles = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`${pluginId}/${name}`, bytes]));
  await writeFile(stagedArchive, zipSync(archiveFiles, { level: 9 }));
  const extracted = unzipSync(await readFile(stagedArchive));
  if (Object.keys(extracted).length !== Object.keys(archiveFiles).length) throw new Error('Unexpected ZIP contents.');
  await mkdir(stagedDirectory);
  for (const [name, bytes] of Object.entries(files)) {
    const unpacked = extracted[`${pluginId}/${name}`];
    if (!unpacked || !bytes.equals(unpacked)) throw new Error(`ZIP verification failed for ${name}`);
    await writeFile(path.join(stagedDirectory, name), unpacked);
  }

  if (previousDirectory) {
    if (await realpath(output) !== path.join(distribution, previousDirectory.name)) throw new Error(`Invalid plugin output directory: ${output}`);
    await rename(output, backupDirectory);
  }
  let directoryPublished = false;
  try {
    await rename(stagedDirectory, output);
    directoryPublished = true;
    await rename(stagedArchive, zipPath);
  } catch (error) {
    try {
      if (directoryPublished) await rename(output, stagedDirectory);
      if (previousDirectory) await rename(backupDirectory, output);
    } catch (recoveryError) {
      preserveStaging = true;
      throw new Error(`Unable to restore the previous package. Recovery files are in ${staging}`,
        { cause: new AggregateError([error, recoveryError]) });
    }
    throw error;
  }

  const versionedArchive = new RegExp(`^${pluginId}-${releaseVersion}\\.zip$`, windows ? 'i' : '');
  for (const entry of entries) {
    if (entry.isFile() && !sameName(entry.name, zipName) && versionedArchive.test(entry.name)) {
      await unlink(path.join(distribution, entry.name));
      removed++;
    }
  }
  await writeFile(path.join(distribution, 'INSTALL.txt'), '将 margin-link 文件夹复制到 <Vault>/.obsidian/plugins/，然后在设置 → 第三方插件中启用 MarginLink。\n详见项目 README.md。\n', 'utf8');
} finally {
  if (!preserveStaging) await clearStaging();
}
console.log(`Installable plugin: ${output}`);
console.log(`Verified ZIP: ${zipPath}`);
console.log(`Superseded version ZIPs removed: ${removed}`);
