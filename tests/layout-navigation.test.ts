import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '../src/types';
import { LayoutStore } from '../src/core/layout-store';
import { layoutIdentities } from '../src/core/layout-identity';
import { parseWikilinks } from '../src/core/wikilink-parser';
import { MarginOverlay } from '../src/view/margin-overlay';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));

describe('navigation while the old editor is still mounted', () => {
  it('does not reconcile A with B’s old links or a temporarily empty editor', () => {
    const sourceA = 'A context [[Target|shared]] A tail';
    const keyA = [...layoutIdentities(sourceA, parseWikilinks(sourceA)).values()][0];
    const store = new LayoutStore([], () => {});
    const position = { side: 'right' as const, xNormalized: 0.7, yOffset: 8 };
    store.set('A.md', keyA, position);
    for (const oldText of ['B context [[Target|shared]] B tail', '']) {
      // Obsidian may update MarkdownView.file before replacing the CM document.
      // Stop rendering at its absent body, exactly as during that transition.
      const staleBridge = { alive: true, revision: 4, identities: layoutIdentities(oldText, parseWikilinks(oldText)), cm: { dom: {}, scrollDOM: {}, contentDOM: undefined } };
      const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, {
        view: { file: { path: 'A.md' }, getMode: () => 'source', previewMode: { containerEl: { querySelector: () => undefined } }, contentEl: { contains: () => true, getBoundingClientRect: () => ({ width: 1200, height: 800 }) } },
        host: { preferences: DEFAULT_PREFERENCES, layouts: store, bridges: new Set([staleBridge]), app: { vault: { cachedRead: () => new Promise(() => {}) } } },
        root: {}, path: 'B.md', mode: 'source', revision: 3, sourceGeneration: 0, win: { clearTimeout: vi.fn() }, legacyLayoutKeys: new Map(),
        cancelInteractions: vi.fn(), clearCards: vi.fn(), cardDrag: { cancel: vi.fn() }
      }) as unknown as { render(): void };
      overlay.render();
      expect(store.get('A.md', keyA)).toEqual(position);
    }
  });
  it('waits for this source’s complete editor text and ignores an obsolete read', async () => {
    vi.useFakeTimers();
    let text = 'B context [[Target]]';
    const schedule = vi.fn(), fullText = 'A context\n[[Target]]';
    const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, {
      view: { file: { path: 'A.md' }, getMode: () => 'source' },
      host: { app: { vault: { cachedRead: async () => fullText.replaceAll('\n', '\r\n') } }, layouts: { migrateAliases: vi.fn() } },
      bridge: () => ({ text }), path: 'A.md', sourceGeneration: 0, checkingSource: false, sourceRetries: 0, schedule,
      win: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
    }) as unknown as { sourceReady(): boolean; confirmedSource: string; sourceGeneration: number; path: string };
    expect(overlay.sourceReady()).toBe(false);
    await Promise.resolve();
    expect(schedule).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(schedule).toHaveBeenCalledTimes(1);
    text = fullText;
    expect(overlay.sourceReady()).toBe(false);
    await Promise.resolve();
    expect(overlay.sourceReady()).toBe(true); expect(schedule).toHaveBeenCalledTimes(2);
    overlay.confirmedSource = ''; overlay.path = 'B.md';
    expect(overlay.sourceReady()).toBe(false);
    // A later navigation invalidates the read before its promise completes.
    overlay.sourceGeneration++; overlay.path = 'C.md';
    await Promise.resolve();
    expect(overlay.confirmedSource).toBe(''); expect(schedule).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
