import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';

const script = path.resolve('scripts/package.mjs');
const folders: string[] = [];
const version = '0.4.0-rc.1+build';
const zip = `margin-link-${version}.zip`;
const releaseFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'main.js', 'manifest.json', 'styles.css'];

afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (await realpath(folder) !== folder) throw new Error(`Unexpected path: ${folder}`);
    await rm(folder, { recursive: true, force: true });
  }
});

async function fixture(packageVersion = version) {
  const testRoot = path.resolve('test-profile');
  await mkdir(testRoot, { recursive: true });
  const root = await mkdtemp(path.join(await realpath(testRoot), '.package-test-'));
  folders.push(root);
  const dist = path.join(root, 'dist');
  const output = path.join(dist, 'margin-link');
  await mkdir(output, { recursive: true });
  await mkdir(path.join(root, 'artifacts'));
  await Promise.all([
    writeFile(path.join(root, 'manifest.json'), JSON.stringify({ id: 'margin-link', version })),
    writeFile(path.join(root, 'package.json'), JSON.stringify({ version: packageVersion })),
    writeFile(path.join(root, 'main.js'), 'new bundle'),
    writeFile(path.join(root, 'styles.css'), 'new styles'),
    writeFile(path.join(root, 'LICENSE'), 'license'),
    writeFile(path.join(root, 'artifacts/bundle-meta.json'), '{"inputs":{}}'),
    writeFile(path.join(output, 'stale.txt'), 'previous output'),
    writeFile(path.join(dist, zip), 'previous same-version archive'),
    writeFile(path.join(dist, 'margin-link-0.2.15.zip'), 'previous version'),
    writeFile(path.join(dist, 'build-notes.zip'), 'unrelated archive'),
    writeFile(path.join(dist, 'margin-link-backup.zip'), 'unrelated named backup')
  ]);
  const run = () => execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  return { dist, output, run };
}

describe('local plugin packaging', () => {
  it('publishes exactly the five current files and keeps only the versioned ZIP for the current build', async () => {
    const f = await fixture();
    expect(f.run()).toContain('Superseded version ZIPs removed: 1');
    expect((await readdir(f.dist)).sort()).toEqual(['INSTALL.txt', 'build-notes.zip', 'margin-link', zip, 'margin-link-backup.zip'].sort());
    expect((await readdir(f.output)).sort()).toEqual(releaseFiles);
    const contents = unzipSync(await readFile(path.join(f.dist, zip)));
    expect(Object.keys(contents).sort()).toEqual(releaseFiles.map(name => `margin-link/${name}`));
    for (const name of releaseFiles) {
      expect(Buffer.from(contents[`margin-link/${name}`])).toEqual(await readFile(path.join(f.output, name)));
    }
    expect(await readFile(path.join(f.output, 'main.js'), 'utf8')).toBe('new bundle');
    expect(await readFile(path.join(f.dist, 'margin-link-backup.zip'), 'utf8')).toBe('unrelated named backup');
    expect(f.run()).toContain('Superseded version ZIPs removed: 0');
  });

  it('preserves the previous directory and archives when the source version is inconsistent', async () => {
    const f = await fixture('0.3.2');
    expect(f.run).toThrow('must agree on the plugin version');
    expect(await readFile(path.join(f.output, 'stale.txt'), 'utf8')).toBe('previous output');
    expect(await readFile(path.join(f.dist, zip), 'utf8')).toBe('previous same-version archive');
    expect(await readFile(path.join(f.dist, 'margin-link-0.2.15.zip'), 'utf8')).toBe('previous version');
  });
});
