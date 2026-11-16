import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedLink, WikilinkOccurrence } from '../src/types';
import { cardFileLabel } from '../src/view/card-renderer';
import { cardTooltip } from '../src/view/card-tooltip';

vi.mock('obsidian', () => ({ setIcon: vi.fn() }));
const occurrence = (target: string): WikilinkOccurrence => ({ raw: `[[${target}|Early Access]]`, target, alias: 'Early Access', label: 'Early Access', start: 0, end: target.length + 17 });
const resolved = (name: string, extension: string): ResolvedLink => ({ file: { name, extension, path: `详细分析/Attachments/${name}` } as ResolvedLink['file'], subpath: '#Heading', target: name });

describe('file-only card descriptions', () => {
  it.each([
    ['product_release_stages.html', 'html', 'HTML 文件'],
    ['很长的中文文件名保留扩展名.md', 'md', 'Markdown 文件'],
    ['Board.canvas', 'canvas', 'Canvas 文件'],
    ['Mixed.HTML', 'HTML', 'HTML 文件']
  ])('uses the resolved TFile name for %s', (name, extension, type) => {
    expect(cardFileLabel(occurrence('Different alias#^block'), resolved(name, extension))).toBe(`${name} · ${type}`);
  });
  it.each([
    ['folder/Missing.md#Heading', 'Missing.md · Markdown 文件'],
    ['目录/缺失.html#^block', '缺失.html · HTML 文件'],
    ['folder/No extension#Heading', 'No extension · 类型未知'],
    ['folder/unknown.weird', 'unknown.weird · 类型未知']
  ])('extracts only the native target basename for %s', (target, expected) => {
    expect(cardFileLabel(occurrence(target), { file: null, subpath: '', target })).toBe(expected);
  });
  it('uses the current file name for same-file headings and blocks, independent of alias', () => {
    for (const target of ['#Heading', '#^block']) expect(cardFileLabel(occurrence(target), resolved('Current.md', 'md'))).toBe('Current.md · Markdown 文件');
  });
});

// Only the platform contracts needed for timer, listener and text-node behavior.
class Events extends EventTarget {
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void {
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
}
function environment() {
  vi.useFakeTimers();
  const visible = new Set<object>();
  const win = Object.assign(new Events(), { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, innerWidth: 1000, innerHeight: 800 });
  const doc = Object.assign(new Events(), { defaultView: win,
    body: { appendChild: (node: object) => visible.add(node) },
    createElement: () => ({ style: {}, setAttribute: vi.fn(), textContent: '', remove() { visible.delete(this); }, getBoundingClientRect: () => ({ width: 180, height: 30 }) })
  });
  const owner = (text: string) => ({ ownerDocument: doc, dataset: { tooltip: text }, isConnected: true, contains: () => false, getBoundingClientRect: () => ({ left: 200, top: 100, bottom: 184, width: 84, height: 84 }) }) as unknown as HTMLElement;
  return { owner, doc, win, visible };
}
afterEach(() => vi.useRealTimers());
describe('one cancellable card tooltip per document', () => {
  it('replaces a pending tooltip and renders untrusted names as text', () => {
    const e = environment(), a = e.owner('A.md · Markdown 文件'), b = e.owner('<img onerror=bad>.html · HTML 文件');
    cardTooltip.show(a); vi.advanceTimersByTime(400); cardTooltip.show(b); vi.advanceTimersByTime(100);
    expect(e.visible.size).toBe(0); vi.advanceTimersByTime(400);
    expect(e.visible.size).toBe(1); expect([...e.visible][0]).toHaveProperty('textContent', b.dataset.tooltip);
    cardTooltip.hideWithin(a); expect(e.visible.size).toBe(1);
    cardTooltip.hideWithin(b); expect(e.visible.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['pointerdown', 'scroll', 'keydown', 'blur', 'resize'])('clears visible and pending tips on %s', event => {
    const e = environment(), a = e.owner('A.md · Markdown 文件');
    for (const delay of [100, 600]) {
      cardTooltip.show(a); vi.advanceTimersByTime(delay);
      (['blur', 'resize'].includes(event) ? e.win : e.doc).dispatchEvent(new Event(event));
      vi.advanceTimersByTime(1000); expect(e.visible.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    }
  });
  it('clears a removed card or a closed view before a pending tip can appear', () => {
    const e = environment(), a = e.owner('A.md · Markdown 文件'); cardTooltip.show(a); Object.assign(a, { isConnected: false });
    vi.advanceTimersByTime(600); expect(e.visible.size).toBe(0);
    Object.assign(a, { isConnected: true }); cardTooltip.show(a);
    cardTooltip.hideWithin({ ownerDocument: e.doc, contains: (node: unknown) => node === a } as unknown as HTMLElement);
    vi.advanceTimersByTime(600); expect(e.visible.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
