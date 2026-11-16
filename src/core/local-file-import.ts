import type { BigIntStats } from 'node:fs';
import type * as FileSystem from 'node:fs/promises';
import type * as Path from 'node:path';
import type * as Crypto from 'node:crypto';
import { formatWikilink } from './link-formatter';

/** Loaded only for an explicit local path in a desktop Vault. No disk scanning. */
export interface LocalFileRuntime {
  fs: typeof FileSystem;
  path: typeof Path;
  createHash: typeof Crypto.createHash;
  platform: NodeJS.Platform;
}
export interface LocalFileInspection {
  source: string;
  canonical: string;
  name: string;
  size: number;
  vaultPath?: string;
  identity: BigIntStats;
}
export interface ImportHost<T> {
  root: string;
  resolve(path: string): Promise<T>;
  validate?(): void;
  commit(file: T): void | Promise<void>;
}
export interface ImportedFile<T> {
  file: T;
  targetPath: string;
  source: string;
  sourceRemoved: boolean;
  removalError?: string;
  retryRemoval(): Promise<void>;
}

export function desktopFileRuntime(): LocalFileRuntime {
  // Indirection keeps Node modules out of the browser bundle and mobile startup.
  if (typeof require !== 'function') throw new Error('库外文件移动仅支持桌面文件系统仓库。');
  const load = require;
  return { fs: load('fs/promises'), path: load('path'), createHash: load('crypto').createHash, platform: process.platform };
}

/** A search term is never interpreted as a path. Quotes must enclose the whole input. */
export function absoluteLocalPath(input: string, platform: NodeJS.Platform): string | null {
  let value = input.trim();
  if (!value) return null;
  const quoted = value[0] === '"' || value[0] === "'";
  if (quoted) {
    if (value.at(-1) !== value[0]) throw new Error('路径外围引号未配对，请粘贴完整路径。');
    value = value.slice(1, -1);
  }
  const absolute = platform === 'win32' ? /^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(value) : value.startsWith('/');
  if (!absolute) {
    if (quoted || (platform === 'win32' && /^(?:[a-z]:|[\\/])/i.test(value))) throw new Error('请输入完整的本地绝对路径。');
    return null;
  }
  if (!value || [...value].some(char => char.charCodeAt(0) < 32) || (platform === 'win32' && /["<>|?*]/.test(value))) throw new Error('本地路径含有非法字符。');
  return value;
}

export function attachmentPath(folder: string, name: string): string {
  if (!name || name.trim() !== name || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name) || /^\./.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('请输入有效文件名，保留原文件扩展名。');
  if (folder !== '/' && (!folder || folder.includes('\\') || folder.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('请选择当前仓库中的目标文件夹。');
  }
  const target = (folder === '/' ? '' : folder + '/') + name;
  formatWikilink(target, 'file');
  return target;
}

function sameIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function readableError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return '源文件或目标目录已不存在。';
  if (code === 'EACCES' || code === 'EPERM') return '没有读取、写入或删除所需的权限，原文件已保留。';
  if (code === 'EEXIST') return '目标已有同名文件，请改名或选择“使用已有文件”。';
  if (code === 'EBUSY') return '文件正被占用，原文件已保留。';
  if (code === 'ENOSPC') return '目标磁盘空间不足，原文件已保留。';
  return error instanceof Error ? error.message : '文件操作失败，原文件已保留。';
}

/** Owns every filesystem mutation. The picker only previews and invokes this transaction. */
export class LocalFileImporter {
  constructor(private runtime: LocalFileRuntime) {}
  private samePath(a: string, b: string): boolean {
    const normalize = (p: string) => this.runtime.path.normalize(p).replace(/[\\/]+$/, '') || this.runtime.path.parse(p).root;
    return this.runtime.platform === 'win32' ? normalize(a).toLowerCase() === normalize(b).toLowerCase() : normalize(a) === normalize(b);
  }
  private relative(root: string, file: string): string | undefined {
    const rel = this.runtime.path.relative(root, file);
    return rel && rel !== '..' && !rel.startsWith('..' + this.runtime.path.sep) && !this.runtime.path.isAbsolute(rel) ? rel.split(this.runtime.path.sep).join('/') : undefined;
  }
  async inspect(input: string, root: string): Promise<LocalFileInspection | null> {
    const source = absoluteLocalPath(input, this.runtime.platform);
    if (!source) return null;
    try {
      const { fs, path } = this.runtime;
      const canonical = await fs.realpath(source);
      const vaultRoot = await fs.realpath(root);
      const identity = await fs.stat(canonical, { bigint: true });
      if (!identity.isFile()) throw new Error('该路径是文件夹或特殊文件，请选择普通文件。');
      const vaultPath = this.relative(vaultRoot, canonical);
      // A symlink into this Vault is safe to associate; never move an external link.
      if (!vaultPath && (!this.samePath(source, canonical) || (await fs.lstat(source)).isSymbolicLink())) {
        throw new Error('来源经过符号链接或重解析点，无法验证移动语义；请使用真实文件路径，原件已保留。');
      }
      const handle = await fs.open(canonical, 'r');
      try { if (!sameIdentity(identity, await handle.stat({ bigint: true }))) throw new Error('源文件已改变，请重新输入路径。'); }
      finally { await handle.close(); }
      return { source: path.resolve(source), canonical, name: path.basename(canonical), size: Number(identity.size), vaultPath, identity };
    } catch (error) { throw new Error(readableError(error)); }
  }
  private async sourceIdentity(source: LocalFileInspection): Promise<void> {
    const { fs } = this.runtime;
    if (!this.samePath(await fs.realpath(source.source), source.canonical)) throw new Error('源文件路径已改变，原件已保留。');
    const current = await fs.lstat(source.source, { bigint: true });
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(source.identity, current)) throw new Error('源文件在操作期间已改变，原件已保留。');
  }
  private async digest(file: string, expected: BigIntStats): Promise<string> {
    const handle = await this.runtime.fs.open(file, 'r');
    try {
      if (!sameIdentity(expected, await handle.stat({ bigint: true }))) throw new Error('文件身份已改变。');
      const hash = this.runtime.createHash('sha256');
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
      if (BigInt(position) !== expected.size || !sameIdentity(expected, await handle.stat({ bigint: true }))) throw new Error('文件内容在校验期间已改变。');
      return hash.digest('hex');
    } finally { await handle.close(); }
  }
  async move<T>(source: LocalFileInspection, targetPath: string, host: ImportHost<T>, signal?: AbortSignal): Promise<ImportedFile<T>> {
    const { fs, path } = this.runtime;
    let destination: string | undefined;
    let targetIdentity: BigIntStats | undefined;
    let cleanupIdentity: BigIntStats | undefined;
    let complete = false;
    let committed = false;
    const canceled = () => { if (signal?.aborted) throw new Error('操作已取消，原文件已保留。'); };
    try {
      canceled(); host.validate?.();
      if (source.vaultPath) throw new Error('该文件已在仓库中，请直接关联。');
      await this.sourceIdentity(source);
      const root = await fs.realpath(host.root);
      destination = path.resolve(root, ...targetPath.split('/'));
      if (this.relative(root, destination) !== targetPath) throw new Error('目标必须位于当前仓库中。');
      const parent = path.dirname(destination);
      if (!this.samePath(await fs.realpath(parent), parent)) throw new Error('目标目录经过符号链接或重解析点，请重新选择存放位置。');
      if (this.samePath(destination, source.canonical)) throw new Error('源文件与目标文件相同。');
      const sourceHandle = await fs.open(source.canonical, 'r');
      try {
        if (!sameIdentity(source.identity, await sourceHandle.stat({ bigint: true }))) throw new Error('源文件已改变，原件已保留。');
        const targetHandle = await fs.open(destination, 'wx');
        const writtenHash = this.runtime.createHash('sha256');
        let writtenLength = 0;
        try {
          targetIdentity = await targetHandle.stat({ bigint: true });
          const hash = this.runtime.createHash('sha256');
          const buffer = Buffer.alloc(1024 * 1024);
          let position = 0;
          for (;;) {
            canceled();
            const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
            if (!bytesRead) break;
            hash.update(buffer.subarray(0, bytesRead));
            let written = 0;
            while (written < bytesRead) {
              const result = await targetHandle.write(buffer, written, bytesRead - written, position + written);
              if (!result.bytesWritten) throw new Error('复制中断，原文件已保留。');
              writtenHash.update(buffer.subarray(written, written + result.bytesWritten));
              writtenLength += result.bytesWritten;
              written += result.bytesWritten;
            }
            position += bytesRead;
          }
          if (BigInt(position) !== source.identity.size || !sameIdentity(source.identity, await sourceHandle.stat({ bigint: true }))) throw new Error('源文件在复制期间已改变，原件已保留。');
          await targetHandle.sync();
          targetIdentity = await targetHandle.stat({ bigint: true });
          const expectedDigest = hash.digest('hex');
          if (await this.digest(destination, targetIdentity) !== expectedDigest) throw new Error('目标副本内容校验失败，原文件已保留。');
          complete = true;
          const verifyCopies = async () => {
            await this.sourceIdentity(source);
            if (!this.samePath(await fs.realpath(destination!), destination!) || !sameIdentity(targetIdentity!, await fs.lstat(destination!, { bigint: true }))) throw new Error('目标副本已改变，原文件已保留。');
            if (await this.digest(destination!, targetIdentity!) !== expectedDigest || await this.digest(source.canonical, source.identity) !== expectedDigest) throw new Error('源文件或目标副本内容已改变，原文件已保留。');
          };
          canceled();
          const file = await host.resolve(targetPath);
          canceled(); host.validate?.();
          await verifyCopies();
          canceled();
          await host.commit(file);
          committed = true;
          const remove = async () => {
            await verifyCopies();
            // The source path is checked again immediately before deletion.
            await this.sourceIdentity(source);
            await fs.unlink(source.source);
          };
          const result: ImportedFile<T> = { file, targetPath, source: source.source, sourceRemoved: false, retryRemoval: remove };
          try { await remove(); result.sourceRemoved = true; }
          catch (error) { result.removalError = readableError(error); }
          return result;
        } catch (error) {
          // Exclusive creation alone does not prove nobody modified the output.
          // Clean up only when its entire current content is exactly our writes.
          if (!complete && targetIdentity) {
            try {
              const current = await targetHandle.stat({ bigint: true });
              if (sameFile(targetIdentity, current) && current.size === BigInt(writtenLength)
                && await this.digest(destination, current) === writtenHash.digest('hex')) cleanupIdentity = current;
            } catch { /* Identity/content cannot be proved: keep this output. */ }
          }
          throw error;
        } finally { await targetHandle.close(); }
      } finally { await sourceHandle.close(); }
    } catch (error) {
      // Remove only our incomplete, exclusively-created output; preserve full copies.
      let retainedOutput = !!targetIdentity;
      if (!complete && destination && cleanupIdentity) {
        try {
          if (sameIdentity(cleanupIdentity, await fs.lstat(destination, { bigint: true }))) {
            await fs.unlink(destination); retainedOutput = false;
          }
        }
        catch { /* Another owner or a failed cleanup: preserve rather than overwrite. */ }
      }
      const retained = complete ? ` 完整副本保留在仓库：${targetPath}。` : retainedOutput ? ` 未确认完整的副本保留在仓库：${targetPath}。` : '';
      throw new Error(`${committed ? '已关联，原文件仍保留。' : '未完成关联，原文件已保留。'}${retained} ${readableError(error)}`);
    }
  }
}
