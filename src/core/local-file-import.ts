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
  discardStageOnClose?(path: string, identity: BigIntStats): void;
}
export interface LocalFileInspection {
  source: string;
  canonical: string;
  name: string;
  size: number;
  vaultPath?: string;
  identity: BigIntStats;
}
interface TargetIdentity {
  source: LocalFileInspection;
  targetPath: string;
  destination: string;
  parent: BigIntStats;
  identity: BigIntStats;
}
export interface ReplacementTarget extends TargetIdentity { targetDigest: string; sourceDigest: string }
export interface PublishedStat { size: number; mtime: number }
export interface ImportHost<T> {
  root: string;
  resolve(path: string, published?: PublishedStat): Promise<T>;
  validate?(): void | Promise<void>;
  commit(file: T): void | Promise<void>;
}
/** The destination is already published. Retrying import would replace it again. */
export class PublishedImportError extends Error {}

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
  const sync: typeof import('node:fs') = load('fs');
  return { fs: load('fs/promises'), path: load('path'), createHash: load('crypto').createHash, platform: process.platform,
    discardStageOnClose(path, identity) {
      // pagehide can be the last JS turn. Leave unrelated/replaced entries alone.
      try {
        const current = sync.lstatSync(path, { bigint: true });
        if (ownedStage(identity, current)) sync.unlinkSync(path);
      } catch { /* The normal finally path can retry while this renderer remains alive. */ }
    }
  };
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
function checkCanceled(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('操作已取消。'); }
function ownedStage(a: BigIntStats, b: BigIntStats): boolean {
  return b.isFile() && sameFile(a, b) && a.birthtimeNs === b.birthtimeNs;
}
function readableError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return '源文件或目标目录已不存在。';
  if (code === 'EACCES' || code === 'EPERM') return '没有读取、写入或删除所需的权限，原文件已保留。';
  if (code === 'EEXIST') return '目标已有同名文件，请重新确认替换或取消。';
  if (code === 'EBUSY') return '文件正被占用，原文件已保留。';
  if (code === 'ENOSPC') return '目标磁盘空间不足，原文件已保留。';
  return error instanceof Error ? error.message : '文件操作失败，原文件已保留。';
}

/** Owns every filesystem mutation. The picker only previews and invokes this transaction. */
export class LocalFileImporter {
  private static replacing = new Set<string>();
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
  private async digest(file: string, expected: BigIntStats, signal?: AbortSignal): Promise<string> {
    const handle = await this.runtime.fs.open(file, 'r');
    try {
      if (!sameIdentity(expected, await handle.stat({ bigint: true }))) throw new Error('文件身份已改变。');
      const hash = this.runtime.createHash('sha256');
      const buffer = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        checkCanceled(signal);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        if (BigInt(position + bytesRead) > expected.size) throw new Error('文件内容在校验期间已改变。');
        hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
      if (BigInt(position) !== expected.size || !sameIdentity(expected, await handle.stat({ bigint: true }))) throw new Error('文件内容在校验期间已改变。');
      return hash.digest('hex');
    } finally { await handle.close(); }
  }
  private async destination(rootPath: string, targetPath: string) {
    const { fs, path } = this.runtime;
    const root = await fs.realpath(rootPath);
    const destination = path.resolve(root, ...targetPath.split('/'));
    if (this.relative(root, destination) !== targetPath) throw new Error('目标必须位于当前仓库中。');
    const parent = path.dirname(destination);
    if (!this.samePath(await fs.realpath(parent), parent)) throw new Error('目标目录经过符号链接或重解析点，请重新选择存放位置。');
    return { root, destination, parent };
  }

  /** Read-only. ENOENT on the leaf alone authorizes the ordinary wx branch. */
  private async targetAt(source: LocalFileInspection, rootPath: string, targetPath: string): Promise<TargetIdentity | undefined> {
    const { fs } = this.runtime;
    try {
      const { root, destination, parent } = await this.destination(rootPath, targetPath);
      const directory = await fs.stat(parent, { bigint: true });
      let identity: BigIntStats;
      try { identity = await fs.lstat(destination, { bigint: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      if (!identity.isFile() || identity.isSymbolicLink()) throw new Error('目标是目录、符号链接或特殊文件，请选择普通文件。');
      const canonical = await fs.realpath(destination);
      if (!this.samePath(canonical, destination)) throw new Error('目标路径经过重解析点。');
      if (!directory.ino || !identity.ino) throw new Error('文件系统未提供可核验的文件身份，无法安全替换。');
      if (sameFile(source.identity, identity)) throw new Error('来源与目标是同一个文件，无需替换，两者均已保留。');
      return { source, targetPath: this.relative(root, canonical)!, destination: canonical, parent: directory, identity };
    } catch (error) { throw new Error(readableError(error)); }
  }

  async inspectTarget(source: LocalFileInspection, root: string, path: string, signal?: AbortSignal): Promise<ReplacementTarget | undefined> {
    checkCanceled(signal);
    const target = await this.targetAt(source, root, path);
    if (!target) return;
    try {
      await this.sourceIdentity(source);
      const [targetDigest, sourceDigest] = await Promise.all([
        this.digest(target.destination, target.identity, signal), this.digest(source.canonical, source.identity, signal)
      ]);
      return { ...target, targetDigest, sourceDigest };
    } catch (error) { throw new Error(readableError(error)); }
  }

  private async checkReplacement(approved: ReplacementTarget, source: LocalFileInspection, root: string, path: string) {
    const current = await this.targetAt(source, root, path);
    if (!current || approved.source !== source || approved.destination !== current.destination || approved.targetPath !== path ||
      !sameFile(approved.parent, current.parent) || !sameIdentity(approved.identity, current.identity)) {
      throw new Error('目标文件或目录已改变，请重新选择并确认。');
    }
    if (!(current.identity.mode & 0o222n)) throw new Error('目标文件为只读，无法替换。');
  }

  /** The same bounded copy and read-back check serves both new files and staging. */
  private async copy(source: LocalFileInspection, output: string, replacement: ReplacementTarget | undefined, canceled: () => void, opened: (identity: BigIntStats) => void) {
    const { fs, createHash } = this.runtime;
    const input = await fs.open(source.canonical, 'r');
    try {
      if (!sameIdentity(source.identity, await input.stat({ bigint: true }))) throw new Error('源文件已改变，原件已保留。');
      const handle = await fs.open(output, 'wx', replacement ? 0o600 : undefined);
      try {
        const created = await handle.stat({ bigint: true });
        opened(created);
        const hash = createHash('sha256');
        let written = 0;
        try {
          const buffer = Buffer.alloc(1024 * 1024);
          for (;;) {
            canceled();
            const { bytesRead } = await input.read(buffer, 0, buffer.length, written);
            if (!bytesRead) break;
            if (BigInt(written + bytesRead) > source.identity.size) throw new Error('源文件在复制期间已改变。');
            let offset = 0;
            while (offset < bytesRead) {
              const { bytesWritten } = await handle.write(buffer, offset, bytesRead - offset, written);
              if (!bytesWritten) throw new Error('复制中断。');
              hash.update(buffer.subarray(offset, offset + bytesWritten));
              written += bytesWritten;
              offset += bytesWritten;
            }
          }
          if (BigInt(written) !== source.identity.size || !sameIdentity(source.identity, await input.stat({ bigint: true }))) throw new Error('源文件在复制期间已改变。');
          if (replacement) {
            await handle.chmod(Number(replacement.identity.mode & 0o777n));
            // Some watchers coalesce identical (mtime, size) writes.
            const stamp = (await handle.stat({ bigint: true })).mtimeMs;
            if (stamp === replacement.identity.mtimeMs) {
              const time = new Date(Number(stamp) + 1000);
              await handle.utimes(time, time);
            }
          }
          await handle.sync();
          const identity = await handle.stat({ bigint: true });
          const digest = hash.copy().digest('hex');
          if (await this.digest(output, identity) !== digest) throw new Error('目标副本内容校验失败。');
          return { identity, digest };
        } catch (error) {
          if (replacement) throw error;
          // A new visible file can have independent edits. Only discard our bytes.
          const current = await fs.lstat(output, { bigint: true }).catch(() => undefined);
          if (current && sameFile(created, current) && current.size === BigInt(written) &&
            await this.digest(output, current).catch(() => '') === hash.digest('hex') &&
            sameIdentity(current, await fs.lstat(output, { bigint: true }))) await fs.unlink(output);
          else throw new Error(`${readableError(error)} 未确认完整的副本保留在仓库。`);
          throw error;
        }
      } finally { await handle.close(); }
    } finally { await input.close(); }
  }

  private async discardStage(path: string, identity: BigIntStats): Promise<void> {
    const fs = this.runtime.fs;
    for (let attempt = 0; ; attempt++) {
      try {
        const current = await fs.lstat(path, { bigint: true });
        if (ownedStage(identity, current)) await fs.unlink(path);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return;
        if (attempt >= 3 || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) {
          throw new Error(`目标尚未替换，来源已保留。未能清理本次临时文件 ${this.runtime.path.basename(path)}。 ${readableError(error)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
  }

  async move<T>(source: LocalFileInspection, targetPath: string, host: ImportHost<T>, signal?: AbortSignal, approved?: ReplacementTarget): Promise<ImportedFile<T>> {
    const { fs, path } = this.runtime;
    const canceled = () => checkCanceled(signal);
    let staging: { path: string; identity: BigIntStats } | undefined;
    const discardOnClose = () => { if (staging) this.runtime.discardStageOnClose?.(staging.path, staging.identity); };
    let lock: string | undefined;
    let copied = false, published = false;
    try {
      canceled(); await host.validate?.(); canceled();
      if (source.vaultPath) throw new Error('该文件已在仓库中，请直接关联。');
      await this.sourceIdentity(source);
      const { destination, parent } = await this.destination(host.root, targetPath);
      if (this.samePath(destination, source.canonical)) throw new Error('源文件与目标文件相同。');
      let output = destination;
      if (approved) {
        const key = this.runtime.platform === 'win32' ? destination.toLowerCase() : destination;
        if (LocalFileImporter.replacing.has(key)) throw new Error('该目标正在替换，请等待本次操作完成。');
        LocalFileImporter.replacing.add(key); lock = key;
        await this.checkReplacement(approved, source, host.root, targetPath);
        await fs.access(destination, fs.constants.W_OK);
        output = path.join(parent, '.margin-link-' + globalThis.crypto.randomUUID() + '.tmp');
      }
      canceled();
      const copy = await this.copy(source, output, approved, canceled, identity => {
        if (approved) {
          staging = { path: output, identity };
          signal?.addEventListener('abort', discardOnClose, { once: true });
          process.once('exit', discardOnClose);
        }
      });
      let identity = copy.identity;
      if (approved) {
        await host.validate?.();
        if (copy.digest !== approved.sourceDigest || await this.digest(source.canonical, source.identity, signal) !== approved.sourceDigest) throw new Error('源文件已改变，请重新选择。');
        if (await this.digest(destination, approved.identity, signal) !== approved.targetDigest) throw new Error('目标内容已改变，请重新确认。');
        if (await this.digest(output, identity, signal) !== copy.digest) throw new Error('临时文件内容已改变。');
        await this.checkReplacement(approved, source, host.root, targetPath);
        await this.sourceIdentity(source);
        if (!sameIdentity(identity, await fs.lstat(output, { bigint: true }))) throw new Error('临时文件已改变。');
        if (!sameIdentity(approved.identity, await fs.lstat(destination, { bigint: true }))) throw new Error('目标文件已改变，请重新确认。');
        canceled();
        await fs.rename(output, destination);
        published = true; staging = undefined;
        const final = await fs.lstat(destination, { bigint: true });
        if (!sameFile(identity, final) || identity.size !== final.size || identity.mtimeNs !== final.mtimeNs) throw new Error('换入后的文件已改变。');
        identity = final;
      } else copied = true;

      const verifyCopies = async () => {
        await this.sourceIdentity(source);
        if (!this.samePath(await fs.realpath(destination), destination) || !sameIdentity(identity, await fs.lstat(destination, { bigint: true }))) throw new Error('目标副本已改变。');
        if (await this.digest(destination, identity) !== copy.digest || await this.digest(source.canonical, source.identity) !== copy.digest) throw new Error('源文件或目标副本内容已改变。');
      };
      canceled();
      const file = await host.resolve(targetPath, approved ? { size: Number(identity.size), mtime: Number(identity.mtimeMs) } : undefined);
      canceled(); await host.validate?.(); canceled();
      await verifyCopies();
      canceled();
      await host.commit(file);
      const remove = async () => {
        await verifyCopies();
        if (!sameIdentity(identity, await fs.lstat(destination, { bigint: true }))) throw new Error('已关联的目标已改变，来源已保留。');
        await this.sourceIdentity(source);
        await fs.unlink(source.source);
      };
      const result: ImportedFile<T> = { file, targetPath, source: source.source, sourceRemoved: false, retryRemoval: remove };
      try { await remove(); result.sourceRemoved = true; }
      catch (error) { result.removalError = readableError(error); }
      return result;
    } catch (error) {
      const atSource = await fs.lstat(source.source, { bigint: true }).catch(() => undefined);
      const sourceStatus = atSource && sameFile(atSource, source.identity) ? '库外来源已保留' : '库外来源路径无法确认，插件未删除来源';
      if (published) throw new PublishedImportError(`目标内容已替换：${targetPath}。关联尚未确认，${sourceStatus}。请核对笔记，若需补建链接可直接选择库内文件。 ${readableError(error)}`);
      const retained = copied ? ` 完整副本保留在仓库：${targetPath}。` : '';
      throw new Error(`未完成关联，${sourceStatus}。${retained} ${readableError(error)}`);
    } finally {
      signal?.removeEventListener('abort', discardOnClose);
      if (approved) process.removeListener('exit', discardOnClose);
      try {
        if (staging) await this.discardStage(staging.path, staging.identity);
      } finally { if (lock) LocalFileImporter.replacing.delete(lock); }
    }
  }
}
