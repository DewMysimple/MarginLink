import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { PreviewSummaries, previewSpace, TargetPreview } from '../src/view/target-preview';

const file = (path: string, size = 512) => ({ path, extension: path.split('.').pop(), stat: { size, mtime: 10 } }) as TFile;
function fixture() {
  const files = new Map<string, TFile>();
  const read = vi.fn(async (_f: TFile) => '<script>text</script> ![[picture]]');
  const vault = { cachedRead: read, getFileByPath: (p: string) => files.get(p) ?? null };
  return { cache: new PreviewSummaries(vault), read, vault,
    add: (p: string, size?: number) => { const f = file(p, size); files.set(p, f); return f; } };
}
afterEach(() => vi.useRealTimers());
describe('bounded target summaries', () => {
  it('returns literal text, limits Unicode length and handles empty and failed reads', async () => {
    const { cache, read, add } = fixture(), f = add('Target.md');
    expect(await cache.read(f, () => true)).toBe('<script>text</script> ![[picture]]');
    cache.invalidate(f.path); read.mockResolvedValueOnce('🌿'.repeat(1000));
    const chars = Array.from(await cache.read(f, () => true));
    expect(chars).toHaveLength(700); expect(chars.at(-1)).toBe('…');
    cache.invalidate(); read.mockResolvedValueOnce('  ');
    expect(await cache.read(f, () => true)).toContain('空');
    cache.invalidate(); read.mockRejectedValueOnce(Error());
    expect(await cache.read(f, () => true)).toContain('无法读取');
  });
  it.each(['html', 'xmind', 'pdf', 'svg', 'png'])('never reads %s, oversized or missing targets', async ext => {
    const { cache, read, add } = fixture();
    expect(await cache.read(add('a.' + ext), () => true)).toContain('附件');
    expect(await cache.read(add('big.md', 262145), () => true)).toContain('256 KiB');
    expect(await cache.read(null, () => true)).toContain('未找到');
    expect(read).not.toHaveBeenCalled();
  });
  it('expires, invalidates directories, and evicts the least recently visited of 24 files', async () => {
    vi.useFakeTimers();
    const { cache, read, add } = fixture(), a = add('dir/0.md');
    for (let i = 0; i < 25; i++) await cache.read(i ? add('dir/' + i + '.md') : a, () => true);
    await cache.read(a, () => true); await cache.read(a, () => true);
    expect(read).toHaveBeenCalledTimes(26);
    vi.advanceTimersByTime(60_001); await cache.read(a, () => true);
    cache.invalidate('dir'); await cache.read(a, () => true);
    expect(read).toHaveBeenCalledTimes(28);
  });
  it('drops stale reads even if the old file name is reused', async () => {
    const { cache, read, add } = fixture(), f = add('a.md');
    let resolve!: (text: string) => void;
    read.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const pending = cache.read(f, () => true);
    const replacement = add('a.md'); resolve('stale');
    expect(await pending).toContain('已变化');
    expect(await cache.read(replacement, () => true)).not.toContain('stale');
  });
});
describe('preview lifetime and layout', () => {
  it('cancels delayed hover before resolving the target and cleans up on teardown', () => {
    vi.useFakeTimers();
    const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
    const root = { ownerDocument: Object.assign(new EventTarget(), { defaultView: win }) } as unknown as HTMLElement;
    const owner = { removeAttribute: vi.fn(), dataset: {} } as unknown as HTMLButtonElement;
    const controller = new TargetPreview(root, fixture().vault);
    const resolve = vi.fn(() => undefined);
    controller.request(owner, resolve); vi.advanceTimersByTime(499);
    controller.leave(owner); vi.advanceTimersByTime(1000);
    controller.request(owner, resolve); controller.invalidate();
    expect(resolve).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('aligns a preview alongside the card when the lane has room for both', () => {
    const lane = { left: 8, right: 465, top: 10, bottom: 700 };
    const card = { left: 413, right: 449, top: 240, bottom: 276 };
    expect(previewSpace(lane, card, [card])).toEqual({ left: 129, right: 409, top: 240, bottom: 450 });
  });
  it('selects a free lane interval without overlapping the owner, adjacent cards or body', () => {
    const lane = { left: 5, right: 190, top: 10, bottom: 500 };
    const card = { left: 90, right: 150, top: 60, bottom: 100 };
    const other = { ...card, top: 105, bottom: 170 };
    expect(previewSpace(lane, card, [card, other])).toEqual({ left: 5, right: 190, top: 174, bottom: 384 });
    expect(previewSpace(lane, card, [lane]).bottom).toBe(card.bottom);
  });
});
