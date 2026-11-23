import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { LocalFileImporter, absoluteLocalPath, attachmentPath, type LocalFileRuntime, type ImportHost } from '../src/core/local-file-import';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
const runtime: LocalFileRuntime = { fs, path, createHash, platform: process.platform };
async function fixture(bytes: Buffer | string = '<html>中文 streams</html>', name = '含 空格 streams.html', overrides: Partial<typeof fs> = {}) {
  const testRoot = path.resolve('test-vault');
  await fs.mkdir(testRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(testRoot, '.import-test-'));
  directories.push(directory);
  const root = path.join(directory, 'vault');
  await fs.mkdir(path.join(root, '资料'), { recursive: true });
  const source = path.join(directory, name);
  await fs.writeFile(source, bytes);
  const importer = new LocalFileImporter({ ...runtime, fs: { ...fs, ...overrides } });
  const inspection = (await importer.inspect(source, root))!;
  const commit = vi.fn(async () => {});
  const validate = vi.fn();
  const host: ImportHost<string> = { root, resolve: async p => p, validate, commit };
  return { directory, root, source, importer, inspection, host, commit, validate };
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

describe('explicit local paths and attachment names', () => {
  it('treats native quoted and unquoted absolute paths identically without changing internal spaces or case', () => {
    const native = 'C:\\Users\\下载 文件\\Streams.HTML';
    expect(absoluteLocalPath(native, 'win32')).toBe(native);
    expect(absoluteLocalPath('"' + native + '"', 'win32')).toBe(native);
    expect(absoluteLocalPath("'" + native + "'", 'win32')).toBe(native);
    expect(absoluteLocalPath('"/Users/下载 文件/Streams.HTML"', 'darwin')).toBe('/Users/下载 文件/Streams.HTML');
    expect(absoluteLocalPath('\\\\server\\share\\文件.xmind', 'win32')).toBe('\\\\server\\share\\文件.xmind');
    expect(absoluteLocalPath('streams', 'win32')).toBeNull();
    expect(absoluteLocalPath('资料/streams.html', 'linux')).toBeNull();
  });
  it.each(['"C:\\Users\\a.html', 'C:relative.html', '\\Users\\a.html', 'C:\\bad?.html', '"relative.html"'])('rejects malformed explicit Windows paths %s', input => {
    expect(() => absoluteLocalPath(input, 'win32')).toThrow();
  });
  it('keeps arbitrary attachment extensions and uses the shared target folder without adding .md', () => {
    expect(attachmentPath('资料/网页', 'Streams.HTML')).toBe('资料/网页/Streams.HTML');
    expect(attachmentPath('/', '图谱.xmind')).toBe('图谱.xmind');
    for (const bad of ['../file.html', 'AUX.html', 'file#heading.html', 'x|y.html']) expect(() => attachmentPath('/', bad)).toThrow();
    expect(() => attachmentPath('../outside', 'safe.html')).toThrow();
  });
});

describe('read-only inspection', () => {
  it('recognizes exact in-Vault paths and makes no copy', async () => {
    const f = await fixture();
    const target = path.join(f.root, '资料', 'already.xmind');
    await fs.writeFile(target, Buffer.from([0, 255, 1]));
    const inspection = await f.importer.inspect('"' + target + '"', f.root);
    expect(inspection?.vaultPath).toBe('资料/already.xmind');
    expect(await fs.readFile(f.source, 'utf8')).toContain('streams');
    expect((await fs.readdir(path.join(f.root, '资料')))).toEqual(['already.xmind']);
  });
  it('rejects folders, vanished sources and denied read access before any mutation', async () => {
    const f = await fixture();
    await expect(f.importer.inspect(f.directory, f.root)).rejects.toThrow('文件夹');
    await expect(f.importer.inspect(path.join(f.directory, 'missing.html'), f.root)).rejects.toThrow('不存在');
    const denied = new LocalFileImporter({ ...runtime, fs: { ...fs, open: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' })) } });
    await expect(denied.inspect(f.source, f.root)).rejects.toThrow('权限');
    expect(await fs.readdir(path.join(f.root, '资料'))).toEqual([]);
  });
  it('refuses external junction ancestry while resolving a junction into the Vault as an exact existing file', async () => {
    const f = await fixture();
    const external = path.join(f.directory, 'external');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, 'test.html'), 'html');
    const junction = path.join(f.directory, 'junction');
    await fs.symlink(external, junction, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.importer.inspect(path.join(junction, 'test.html'), f.root)).rejects.toThrow('符号链接或重解析点');
    const vaultJunction = path.join(f.directory, 'vault-junction');
    await fs.writeFile(path.join(f.root, 'inside.html'), 'inside');
    await fs.symlink(f.root, vaultJunction, process.platform === 'win32' ? 'junction' : 'dir');
    expect((await f.importer.inspect(path.join(vaultJunction, 'inside.html'), f.root))?.vaultPath).toBe('inside.html');
  });
});

describe('copy, confirm one source transaction, then remove', () => {
  it.each(['html', 'xmind'])('preserves all %s bytes and deletes only after confirmed linking', async extension => {
    const bytes = extension === 'html' ? Buffer.from('<html>中文\r\nstreams</html>') : Buffer.alloc(2 * 1024 * 1024 + 733, 0xa9);
    const f = await fixture(bytes, 'source.' + extension);
    const targetPath = '资料/imported.' + extension;
    const destination = path.join(f.root, '资料', 'imported.' + extension);
    f.commit.mockImplementation(async () => {
      expect(digest(await fs.readFile(f.source))).toBe(digest(bytes));
      expect(digest(await fs.readFile(destination))).toBe(digest(bytes));
    });
    const result = await f.importer.move(f.inspection, targetPath, f.host);
    expect(result.sourceRemoved).toBe(true);
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(targetPath);
    expect(f.validate).toHaveBeenCalledTimes(2);
    expect(digest(await fs.readFile(destination))).toBe(digest(bytes));
    await expect(fs.stat(f.source)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('uses exclusive target creation and never overwrites a collision, even without a host index entry', async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, '资料', 'same.html'), 'existing');
    await expect(f.importer.move(f.inspection, '资料/same.html', f.host)).rejects.toThrow('同名');
    expect(await fs.readFile(path.join(f.root, '资料', 'same.html'), 'utf8')).toBe('existing');
    expect(await fs.readFile(f.source, 'utf8')).toContain('streams');
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('preserves both files when the captured selection or link is invalid at commit time', async () => {
    const f = await fixture();
    f.validate.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('选区已改变'); });
    await expect(f.importer.move(f.inspection, '资料/kept.html', f.host)).rejects.toThrow('选区已改变');
    expect(digest(await fs.readFile(path.join(f.root, '资料', 'kept.html')))).toBe(digest(await fs.readFile(f.source)));
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('keeps the original when Obsidian cannot resolve the complete destination', async () => {
    const f = await fixture();
    f.host.resolve = async () => { throw new Error('尚未识别'); };
    await expect(f.importer.move(f.inspection, '资料/kept.html', f.host)).rejects.toThrow('完整副本保留');
    expect(await fs.stat(f.source)).toBeTruthy();
    expect(await fs.stat(path.join(f.root, '资料', 'kept.html'))).toBeTruthy();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('preserves copies when the source transaction rejects and does not retry that transaction', async () => {
    const f = await fixture();
    f.commit.mockRejectedValue(new Error('正文写入失败'));
    await expect(f.importer.move(f.inspection, '资料/kept.html', f.host)).rejects.toThrow('正文写入失败');
    expect(f.commit).toHaveBeenCalledOnce();
    expect(await fs.stat(f.source)).toBeTruthy();
  });
  it('does not let a successful picker close cancel post-commit removal', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.commit.mockImplementation(async () => { controller.abort(); });
    expect((await f.importer.move(f.inspection, '资料/complete.html', f.host, controller.signal)).sourceRemoved).toBe(true);
    expect(f.commit).toHaveBeenCalledOnce();
  });
  it('aborts before copying when the picker has already closed', async () => {
    const f = await fixture();
    const controller = new AbortController(); controller.abort();
    await expect(f.importer.move(f.inspection, '资料/cancel.html', f.host, controller.signal)).rejects.toThrow('取消');
    expect(await fs.readdir(path.join(f.root, '资料'))).toEqual([]);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('detects source changes after preview before creating a target', async () => {
    const f = await fixture();
    await fs.appendFile(f.source, 'changed');
    await expect(f.importer.move(f.inspection, '资料/change.html', f.host)).rejects.toThrow('已改变');
    expect(await fs.readdir(path.join(f.root, '资料'))).toEqual([]);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('detects source changes during copying and removes only its own incomplete target', async () => {
    const f = await fixture(Buffer.alloc(2 * 1024 * 1024, 0xff));
    let changed = false;
    const fileSystem = { ...fs, open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (String(args[0]) === f.inspection.canonical && args[1] === 'r') {
        const read = handle.read.bind(handle);
        const wrapped = async (...readArgs: Parameters<typeof handle.read>) => {
          const result = await read(...readArgs);
          if (!changed) { changed = true; await fs.appendFile(f.source, 'changed'); }
          return result;
        };
        Object.assign(handle, { read: wrapped });
      }
      return handle;
    }) };
    const importer = new LocalFileImporter({ ...runtime, fs: fileSystem });
    await expect(importer.move(f.inspection, '资料/change.html', f.host)).rejects.toThrow('复制期间已改变');
    expect(await fs.readdir(path.join(f.root, '资料'))).toEqual([]);
    expect((await fs.stat(f.source)).size).toBeGreaterThan(2 * 1024 * 1024);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('preserves an incomplete output independently modified during an interrupted write', async () => {
    const f = await fixture(Buffer.alloc(2 * 1024 * 1024, 0xff));
    const destination = path.join(f.root, '资料', 'changed.html');
    const fileSystem = { ...fs, open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[1] === 'wx') {
        const write = handle.write.bind(handle);
        Object.assign(handle, { write: async (...writeArgs: Parameters<typeof handle.write>) => {
          await write(...writeArgs);
          await fs.writeFile(destination, 'independent content');
          throw new Error('模拟复制中断');
        } });
      }
      return handle;
    }) };
    const importer = new LocalFileImporter({ ...runtime, fs: fileSystem });
    await expect(importer.move(f.inspection, '资料/changed.html', f.host)).rejects.toThrow('未确认完整的副本保留');
    expect(await fs.readFile(destination, 'utf8')).toBe('independent content');
    expect(await fs.stat(f.source)).toBeTruthy();
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('preserves the full original and cleans its own partial output when canceled mid-copy', async () => {
    const f = await fixture(Buffer.alloc(2 * 1024 * 1024, 0xff));
    const controller = new AbortController();
    const fileSystem = { ...fs, open: vi.fn(async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (args[1] === 'wx') {
        const write = handle.write.bind(handle);
        Object.assign(handle, { write: async (...writeArgs: Parameters<typeof handle.write>) => {
          const result = await write(...writeArgs); controller.abort(); return result;
        } });
      }
      return handle;
    }) };
    const importer = new LocalFileImporter({ ...runtime, fs: fileSystem });
    await expect(importer.move(f.inspection, '资料/canceled.html', f.host, controller.signal)).rejects.toThrow('取消');
    expect(await fs.readdir(path.join(f.root, '资料'))).toEqual([]);
    expect((await fs.stat(f.source)).size).toBe(2 * 1024 * 1024);
    expect(f.commit).not.toHaveBeenCalled();
  });
  it('copies across a simulated EXDEV boundary without using rename', async () => {
    const rename = vi.fn().mockRejectedValue(Object.assign(new Error('cross device'), { code: 'EXDEV' }));
    const f = await fixture('attachment', 'cross.html', { rename });
    const result = await f.importer.move(f.inspection, '资料/cross.html', f.host);
    expect(result.sourceRemoved).toBe(true);
    expect(await fs.readFile(path.join(f.root, '资料', 'cross.html'), 'utf8')).toBe('attachment');
    expect(rename).not.toHaveBeenCalled();
  });
  it('reports a locked source as linked and retries only verified source deletion', async () => {
    const unlink = vi.fn().mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EBUSY' })).mockImplementation(fs.unlink);
    const f = await fixture('html', 'source.html', { unlink });
    const result = await f.importer.move(f.inspection, '资料/locked.html', f.host);
    expect(result.sourceRemoved).toBe(false);
    expect(result.removalError).toContain('占用');
    expect(await fs.stat(f.source)).toBeTruthy();
    await result.retryRemoval();
    await expect(fs.stat(f.source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.commit).toHaveBeenCalledOnce();
  });
  it('refuses a retry after either source or linked destination changed', async () => {
    const f = await fixture('html', 'source.html', { unlink: vi.fn().mockRejectedValue(Object.assign(new Error('locked'), { code: 'EBUSY' })) });
    const result = await f.importer.move(f.inspection, '资料/locked.html', f.host);
    await fs.writeFile(f.source, 'new original');
    await expect(result.retryRemoval()).rejects.toThrow('已改变');
    expect(await fs.readFile(f.source, 'utf8')).toBe('new original');
    expect(f.commit).toHaveBeenCalledOnce();
  });
  it('never deletes a source that changes after linking', async () => {
    const f = await fixture();
    f.commit.mockImplementation(async () => { await fs.appendFile(f.source, 'changed after commit'); });
    const result = await f.importer.move(f.inspection, '资料/linked.html', f.host);
    expect(result.sourceRemoved).toBe(false);
    expect(result.removalError).toContain('已改变');
    expect(await fs.readFile(f.source, 'utf8')).toContain('changed after commit');
  });
});

describe('external import filename conflicts', () => {
  const targetPath = '资料/场景.graph.HTML';
  const original = '<html>original in vault</html>';
  const incoming = Buffer.from('<html>替换内容\r\n</html>');
  async function conflictFixture() {
    const f = await fixture(incoming, '场景.graph.HTML');
    const folder = path.join(f.root, '资料');
    const destination = path.join(f.root, targetPath);
    await fs.writeFile(destination, original);
    const conflict = await f.importer.conflict(f.root, targetPath);
    expect(conflict?.replacement?.path).toBe(targetPath);
    return { ...f, folder, destination, replacement: conflict!.replacement! };
  }

  it('publishes verified replacement bytes at the same path and deletes the source only after commit', async () => {
    const f = await conflictFixture();
    f.commit.mockImplementation(async () => {
      expect(await fs.readFile(f.destination)).toEqual(incoming);
      expect(await fs.readFile(f.source)).toEqual(incoming);
    });
    const result = await f.importer.move(f.inspection, targetPath, f.host, undefined, f.replacement);
    expect(result).toMatchObject({ targetPath, sourceRemoved: true });
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(targetPath);
    await expect(fs.access(f.source)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(f.destination)).toEqual(incoming);
    expect(await fs.readdir(f.folder)).toEqual(['场景.graph.HTML']);
  });

  it('restores the former bytes and keeps the outside source when linking fails', async () => {
    const f = await conflictFixture();
    f.commit.mockImplementation(async () => {
      expect(await fs.readFile(f.destination)).toEqual(incoming);
      throw new Error('正文写入失败');
    });
    await expect(f.importer.move(f.inspection, targetPath, f.host, undefined, f.replacement)).rejects.toThrow('仓库中的旧文件已恢复');
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(targetPath);
    expect(await fs.readFile(f.destination, 'utf8')).toBe(original);
    expect(await fs.readFile(f.source)).toEqual(incoming);
    expect(await fs.readdir(f.folder)).toEqual(['场景.graph.HTML']);
  });

  it('rejects replacement if another edit changes the confirmed destination during staging', async () => {
    const f = await conflictFixture();
    f.host.resolve = async candidate => {
      await fs.writeFile(f.destination, 'concurrent edit before replacement');
      return candidate;
    };
    await expect(f.importer.move(f.inspection, targetPath, f.host, undefined, f.replacement)).rejects.toThrow('待覆盖的文件已改变');
    expect(f.commit).not.toHaveBeenCalled();
    expect(await fs.readFile(f.destination, 'utf8')).toBe('concurrent edit before replacement');
    expect(await fs.readFile(f.source)).toEqual(incoming);
    expect(await fs.readdir(f.folder)).toEqual(['场景.graph.HTML']);
  });

  it('keeps a concurrent edit and the old file backup when the source transaction fails', async () => {
    const f = await conflictFixture();
    f.commit.mockImplementation(async () => {
      await fs.writeFile(f.destination, 'new concurrent edit after replacement');
      throw new Error('正文写入失败');
    });
    await expect(f.importer.move(f.inspection, targetPath, f.host, undefined, f.replacement)).rejects.toThrow('仓库旧文件的备份位于');
    expect(await fs.readFile(f.destination, 'utf8')).toBe('new concurrent edit after replacement');
    expect(await fs.readFile(f.source)).toEqual(incoming);
    const entries = await fs.readdir(f.folder, { withFileTypes: true });
    const staging = entries.filter(entry => entry.isDirectory());
    expect(staging).toHaveLength(1);
    const recovery = path.join(f.folder, staging[0].name);
    const backup = await fs.readdir(recovery);
    expect(backup).toHaveLength(1);
    expect(await fs.readFile(path.join(recovery, backup[0]), 'utf8')).toBe(original);
  });

  it('skips existing numbered files and folders while preserving the final extension', async () => {
    const f = await conflictFixture();
    const first = path.join(f.folder, '场景.graph (1).HTML');
    const second = path.join(f.folder, '场景.graph (2).HTML');
    await fs.writeFile(first, 'keep numbered file');
    await fs.mkdir(second);
    const conflict = await f.importer.conflict(f.root, targetPath);
    expect(conflict?.safePath).toBe('资料/场景.graph (3).HTML');
    const result = await f.importer.move(f.inspection, conflict!.safePath, f.host);
    expect(result).toMatchObject({ targetPath: '资料/场景.graph (3).HTML', sourceRemoved: true });
    expect(f.commit).toHaveBeenCalledExactlyOnceWith(result.targetPath);
    expect(await fs.readFile(path.join(f.root, result.targetPath))).toEqual(incoming);
    expect(await fs.readFile(f.destination, 'utf8')).toBe(original);
    expect(await fs.readFile(first, 'utf8')).toBe('keep numbered file');
    expect((await fs.stat(second)).isDirectory()).toBe(true);
  });

  it('does not allow replacement of a directory and offers a numbered path instead', async () => {
    const f = await fixture(incoming);
    const destination = path.join(f.root, targetPath);
    await fs.mkdir(destination);
    expect(await f.importer.conflict(f.root, targetPath)).toEqual({ safePath: '资料/场景.graph (1).HTML' });
    expect((await fs.stat(destination)).isDirectory()).toBe(true);
    expect(await fs.readFile(f.source)).toEqual(incoming);
  });
});
