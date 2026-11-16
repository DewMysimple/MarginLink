import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Box } from '../src/types';
import { TextObstacles } from '../src/view/text-obstacles';

interface FakeNode {
  nodeType: number;
  textContent: string;
  children: FakeNode[];
  excluded?: boolean;
  rects: Box[];
  matches: () => boolean;
  getBoundingClientRect: () => Box;
}
function fixture() {
  vi.stubGlobal('Node', { ELEMENT_NODE: 1, TEXT_NODE: 3 });
  vi.stubGlobal('NodeFilter', { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 });
  const state = { scrollTop: 1000, hostLeft: 100, hostTop: 50, rangeReads: 0 };
  const screen = (box: Box) => ({
    left: box.left + state.hostLeft, right: box.right + state.hostLeft,
    top: box.top + state.hostTop - state.scrollTop, bottom: box.bottom + state.hostTop - state.scrollTop,
    width: box.right - box.left, height: box.bottom - box.top
  });
  const node = (rects: Box[], textContent = 'Text', children: FakeNode[] = [], excluded = false): FakeNode => ({
    nodeType: children.length ? 1 : 3, textContent, children, rects, excluded,
    matches: () => excluded,
    getBoundingClientRect: () => screen(rects[0])
  });
  const paragraph = (box: Box, text = 'Text', excluded = false) => {
    const result = node([box], text, [node([box], text)], excluded);
    return result;
  };
  const doc = {
    createRange: () => {
      let selected: FakeNode;
      return {
        selectNodeContents: (current: FakeNode) => { selected = current; },
        getClientRects: () => { state.rangeReads++; return selected.rects.map(screen); }
      };
    },
    createTreeWalker: (root: FakeNode, _what: number, filter: (node: FakeNode) => number) => {
      const accepted: FakeNode[] = [];
      const visit = (current: FakeNode) => {
        const answer = filter(current);
        if (answer === 2) return;
        if (answer === 1) accepted.push(current);
        current.children.forEach(visit);
      };
      root.children.forEach(visit);
      let index = -1;
      return { currentNode: root, nextNode() { index++; this.currentNode = accepted[index]; return !!this.currentNode; } };
    }
  };
  const root = Object.assign(node([{ left: 180, right: 820, top: 0, bottom: 10000 }]), { ownerDocument: doc, children: [] as FakeNode[] });
  const viewport = { left: 0, right: 1000, top: 20, bottom: 420 };
  const host = () => ({ left: state.hostLeft, top: state.hostTop }) as DOMRect;
  return { root, state, paragraph, viewport, host };
}
afterEach(() => vi.unstubAllGlobals());

describe('per-view rendered text obstacle cache', () => {
  it('stores content coordinates and reuses them across scroll and window movement', () => {
    const f = fixture(), cache = new TextObstacles();
    f.root.children.push(f.paragraph({ left: 240, right: 380, top: 1100, bottom: 1120 }));
    const first = cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop);
    expect(first).toEqual([{ left: 240, right: 380, top: 1100, bottom: 1120 }]);
    expect(f.state.rangeReads).toBe(1);
    f.state.scrollTop += 100; f.state.hostTop += 40; f.state.hostLeft += 80;
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop)).toBe(first);
    expect(f.state.rangeReads).toBe(1);
    expect(cache.revision).toBe(1);
    // Projection back into the current view preserves the glyph rectangle.
    expect(first[0].top + f.state.hostTop - f.state.scrollTop).toBe(90);
  });
  it('remeasures only when the viewport leaves the measured neighbourhood', () => {
    const f = fixture(), cache = new TextObstacles();
    f.root.children.push(f.paragraph({ left: 240, right: 380, top: 1800, bottom: 1820 }));
    const first = cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop);
    f.state.scrollTop = 1400;
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop)).toBe(first);
    f.state.scrollTop = 1401;
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop)).not.toBe(first);
    expect(cache.revision).toBe(2);
    expect(f.state.rangeReads).toBe(2);
  });
  it('keeps partially intersecting glyph boxes while pruning distant sections and editor decoration', () => {
    const f = fixture(), cache = new TextObstacles();
    f.root.children.push(
      f.paragraph({ left: 240, right: 380, top: 610, bottom: 630 }),
      f.paragraph({ left: 240, right: 380, top: 8000, bottom: 8020 }),
      f.paragraph({ left: 240, right: 380, top: 1100, bottom: 1120 }, 'Overlay or virtual gap', true),
      f.paragraph({ left: 240, right: 380, top: 1100, bottom: 1120 }, '    '),
      f.paragraph({ left: 240, right: 240, top: 1100, bottom: 1120 })
    );
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop))
      .toEqual([{ left: 240, right: 380, top: 610, bottom: 630 }]);
    expect(f.state.rangeReads).toBe(2);
  });
  it('measures visible descendants of an empty display-contents wrapper', () => {
    const f = fixture(), cache = new TextObstacles();
    f.state.hostTop = 800;
    const paragraph = f.paragraph({ left: 240, right: 380, top: 1100, bottom: 1120 });
    const wrapper = f.paragraph({ left: 0, right: 0, top: 0, bottom: 0 });
    wrapper.children = [paragraph];
    // Browsers report a zero screen-space element box for display:contents,
    // while a descendant text Range still has its real glyph geometry.
    wrapper.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    f.root.children.push(wrapper);
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop))
      .toEqual([{ left: 240, right: 380, top: 1100, bottom: 1120 }]);
  });
  it('remeasures changed glyph widths after explicit geometry invalidation', () => {
    const f = fixture(), cache = new TextObstacles();
    const box = { left: 240, right: 380, top: 1100, bottom: 1120 };
    f.root.children.push(f.paragraph(box));
    cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop);
    box.right = 460;
    cache.invalidate();
    expect(cache.read(f.root as unknown as HTMLElement, f.host(), f.viewport, f.state.scrollTop)[0].right).toBe(460);
    expect(cache.revision).toBe(2);
  });
});
