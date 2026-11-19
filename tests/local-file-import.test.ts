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

describe('explicitly approved same-path replacement', () => {
  async function conflict(name = 'Report.HTML', bytes: Buffer | string = 'source', overrides: Partial<typeof fs> = {}) {
    const f = await fixture(bytes, name, overrides);
    const targetPath = '资料/' + name, destination = path.join(f.root, targetPath);
    await fs.writeFile(destination, 'original');
    const approval = (await f.importer.inspectTarget(f.inspection, f.root, targetPath))!;
    const move = (signal?: AbortSignal) => f.importer.move(f.inspection, targetPath, f.host, signal, approval);
    const entries = () => fs.readdir(path.dirname(destination));
    return { ...f, bytes, targetPath, destination, approval, move, entries };
  }

  it.each(['HTML', 'htm', 'xmind', 'pdf', 'png', 'JPEG', 'mp3', 'md'])('publishes complete %s bytes only at the selected path', async ext => {
    const bytes = /html?|md/i.test(ext) ? Buffer.from('内容\r\n🌐\r\n') : Buffer.alloc(3 * 1024 * 1024 + 259);
    if (!/html?|md/i.test(ext)) for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const name = 'Case.' + ext, f = await conflict(name, bytes);
    const other = path.join(f.root, name); await fs.writeFile(other, 'other folder');
    f.host.resolve = async (actual, published) => {
      const stat = await fs.stat(f.destination, { bigint: true });
      expect(actual).toBe(f.targetPath); expect(published).toEqual({ size: bytes.length, mtime: Number(stat.mtimeMs) });
      expect(digest(await fs.readFile(f.source))).toBe(digest(bytes));
      return actual;
    };
    const result = await f.move();
    expect(result.sourceRemoved).toBe(true); expect(f.commit).toHaveBeenCalledExactlyOnceWith(f.targetPath);
    expect(digest(await fs.readFile(f.destination))).toBe(digest(bytes)); expect(await f.entries()).toEqual([name]);
    expect(await fs.readFile(other, 'utf8')).toBe('other folder'); await expect(fs.stat(f.source)).rejects.toThrow();
  });

  it.each(['source edit', 'source delete', 'target edit', 'target move', 'target delete', 'target swap'])('rejects %s after the confirmation snapshot', async variant => {
    const f = await conflict();
    const changed = variant.startsWith('source') ? f.source : f.destination;
    if (variant.endsWith('edit')) await fs.writeFile(changed, 'modified');
    else if (variant.endsWith('delete')) await fs.unlink(changed);
    else { await fs.rename(changed, changed + '.moved'); if (variant.endsWith('swap')) await fs.writeFile(changed, 'original'); }
    const before = await fs.readFile(f.destination).catch(() => undefined);
    await expect(f.move()).rejects.toThrow(); expect(f.commit).not.toHaveBeenCalled();
    expect(await fs.readFile(f.destination).catch(() => undefined)).toEqual(before);
    if (variant !== 'source delete') expect(await fs.stat(f.source)).toBeTruthy();
    expect((await f.entries()).filter(x => x.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects self hardlinks, a directory, a junction outside the Vault and a different approved path', async () => {
    const f = await conflict();
    await fs.link(f.source, path.join(f.root, 'alias'));
    await fs.symlink(f.directory, path.join(f.root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
    for (const target of ['alias', '资料', 'junction/Report.HTML']) {
      await expect(f.importer.inspectTarget(f.inspection, f.root, target)).rejects.toThrow();
    }
    await expect(f.importer.move(f.inspection, 'other', f.host, undefined, f.approval)).rejects.toThrow('已改变');
    expect(await fs.readFile(f.source, 'utf8')).toBe('source'); expect(await f.entries()).toEqual(['Report.HTML']);
  });

  it.each(['wx', 'write', 'space', 'digest', 'rename', 'cancel', 'late target edit', 'foreign staging'])('preserves both sides and respects staging ownership on %s', async failure => {
    const controller = new AbortController();
    let stage = '';
    const f = await conflict('Report.HTML', Buffer.alloc(2 * 1024 * 1024 + 33, 0xff), {
      open: async (...args) => {
        const name = String(args[0]);
        if (name.endsWith('.tmp') && args[1] === 'wx' && failure === 'wx') throw Object.assign(new Error(), { code: 'EACCES' });
        const handle = await fs.open(...args);
        if (name.endsWith('.tmp') && args[1] === 'wx') {
          stage = name;
          const write = handle.write.bind(handle);
          Object.assign(handle, { write: async (...values: Parameters<typeof handle.write>) => {
            const written = await write(...values);
            if (failure === 'write' || failure === 'space') throw Object.assign(new Error('写入中断'), { code: failure === 'space' ? 'ENOSPC' : 'EIO' });
            if (failure === 'cancel') controller.abort();
            return written;
          } });
        } else if (name.endsWith('.tmp') && args[1] === 'r' && failure === 'digest') {
          const read = handle.read.bind(handle);
          Object.assign(handle, { read: async (...values: Parameters<typeof handle.read>) => {
            const result = await read(...values); if (result.bytesRead) (result.buffer as Buffer)[0] ^= 0xff; return result;
          } });
        }
        return handle;
      },
      rename: async (...args) => {
        if (failure === 'rename') throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        if (failure === 'foreign staging') {
          await fs.rename(stage, stage + '.held'); await fs.writeFile(stage, 'another transaction');
          throw new Error('stage exchanged');
        }
        return fs.rename(...args);
      }
    });
    if (failure === 'late target edit') f.host.validate = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => fs.writeFile(f.destination, 'new independent edit'));
    await expect(f.move(controller.signal)).rejects.toThrow();
    expect(await fs.readFile(f.destination, 'utf8')).toBe(failure === 'late target edit' ? 'new independent edit' : 'original');
    expect((await fs.stat(f.source)).size).toBe(2 * 1024 * 1024 + 33); expect(f.commit).not.toHaveBeenCalled();
    if (failure === 'foreign staging') expect(await fs.readFile(stage, 'utf8')).toBe('another transaction');
    else expect(await f.entries()).toEqual(['Report.HTML']);
  });

  it.each(['source', 'target'])('detects equal-length %s edits even if the filesystem reports an identical version stamp', async side => {
    const f = await conflict();
    const changed = side === 'source' ? f.source : f.destination;
    const initial = await fs.lstat(changed, { bigint: true });
    const fake = new LocalFileImporter({ ...runtime, fs: { ...fs,
      lstat: vi.fn(async (...args: Parameters<typeof fs.lstat>) => String(args[0]) === changed ? initial : fs.lstat(...args)) as typeof fs.lstat,
      open: async (...args) => {
        const handle = await fs.open(...args);
        if (String(args[0]) === changed) Object.assign(handle, { stat: async () => initial });
        return handle;
      }
    } });
    await fs.writeFile(changed, side === 'source' ? 'SOURCE' : 'ORIGINAL');
    await expect(fake.move(f.inspection, f.targetPath, f.host, undefined, f.approval)).rejects.toThrow('已改变');
    expect(await fs.readFile(f.destination, 'utf8')).toBe(side === 'target' ? 'ORIGINAL' : 'original');
    expect(await fs.stat(f.source)).toBeTruthy(); expect(await f.entries()).toEqual(['Report.HTML']);
  });

  it('refuses a readonly target and never truncates it', async () => {
    const f = await conflict(); await fs.chmod(f.destination, 0o444);
    try {
      const approval = await f.importer.inspectTarget(f.inspection, f.root, f.targetPath);
      await expect(f.importer.move(f.inspection, f.targetPath, f.host, undefined, approval)).rejects.toThrow('只读');
      expect(await fs.readFile(f.destination, 'utf8')).toBe('original');
    } finally { await fs.chmod(f.destination, 0o666); }
  });

  it.each(['refresh', 'validation after publish', 'commit'])('reports the published target and retained source on %s failure', async phase => {
    const f = await conflict();
    if (phase === 'refresh') f.host.resolve = async () => { throw new Error('watcher timeout'); };
    if (phase === 'validation after publish') f.validate.mockImplementationOnce(() => {}).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('文档已改变'); });
    if (phase === 'commit') f.commit.mockRejectedValue(new Error('editor closed'));
    await expect(f.move()).rejects.toThrow(/目标内容已替换.*来源已保留/);
    expect(await fs.readFile(f.destination, 'utf8')).toBe('source'); expect(await fs.readFile(f.source, 'utf8')).toBe('source');
    expect(await f.entries()).toEqual(['Report.HTML']); expect(f.commit).toHaveBeenCalledTimes(phase === 'commit' ? 1 : 0);
  });

  it('allows only one competing transaction even across importer instances', async () => {
    const f = await conflict();
    const other = new LocalFileImporter(runtime);
    const results = await Promise.allSettled([f.move(), other.move(f.inspection, f.targetPath, f.host, undefined, f.approval)]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(f.commit).toHaveBeenCalledOnce(); expect(await f.entries()).toEqual(['Report.HTML']);
  });

  it('preserves the actual casing of an existing NTFS name', async () => {
    if (process.platform !== 'win32') return;
    const f = await conflict();
    const approval = (await f.importer.inspectTarget(f.inspection, f.root, f.targetPath.toLowerCase()))!;
    expect(approval.targetPath).toBe(f.targetPath);
    await f.importer.move(f.inspection, approval.targetPath, f.host, undefined, approval);
    expect(await f.entries()).toEqual(['Report.HTML']);
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
