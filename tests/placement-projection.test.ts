import { describe, expect, it, vi } from 'vitest';
import { MarginOverlay } from '../src/view/margin-overlay';
import type { Placement } from '../src/view/layout-engine';

vi.mock('obsidian', () => ({ MarkdownView: class {}, FileView: class {}, Menu: class {}, Notice: class {}, setIcon: vi.fn(), parseLinktext: vi.fn() }));

describe('native placement projection', () => {
  it('compares desired document coordinates rather than CSSOM rounded transform serialization', () => {
    let writes = 0;
    const style = new Proxy({} as Record<string, string>, {
      set: (target, key: string, value: string) => {
        writes++; target[key] = value.replace(/\d+\.\d+/g, number => Number(number).toPrecision(6)); return true;
      }
    });
    const card = { shell: { style, dataset: {} }, button: { classList: { toggle: vi.fn() } } };
    const overlay = Object.assign(Object.create(MarginOverlay.prototype) as object, { hostRect: {}, scrollTop: 0, geometryRevision: 0 }) as unknown as {
      scrollTop: number; geometryRevision: number; place(card: unknown, placement: Placement): void;
    };
    const placement: Placement = { key: 'a', side: 'right', x: 1238, y: 1264.3769, width: 84, height: 84, compact: false };
    overlay.place(card, placement);
    expect(style.transform).toBe('translate(1238px, 1264.38px)');
    const initialWrites = writes, initialGeometry = overlay.geometryRevision;
    for (const scrollTop of [0, 70, 20, 140, 1, 0]) {
      overlay.scrollTop = scrollTop;
      overlay.place(card, { ...placement, y: placement.y - scrollTop });
    }
    expect(writes).toBe(initialWrites); expect(overlay.geometryRevision).toBe(initialGeometry);
  });
});
