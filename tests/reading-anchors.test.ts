import { describe, expect, it, vi } from 'vitest';
import type { App, MarkdownRenderChild, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import * as parser from '../src/core/wikilink-parser';
import { ReadingAnchors } from '../src/reading/reading-anchors';
import { textFragments } from '../src/view/text-fragments';

vi.mock('obsidian', () => ({
  MarkdownRenderChild: class {
    private cleanup?: () => void;
    register(cleanup: () => void) { this.cleanup = cleanup; }
    unload() { this.cleanup?.(); }
  },
  parseLinktext: (path: string) => ({ path, subpath: '' })
}));
vi.mock('../src/view/text-fragments', () => ({ textFragments: vi.fn(() => [{ left: 10, right: 50, top: 3, bottom: 13 }]) }));

const box = (top: number, height = 10) => ({ left: 10, right: 50, top, bottom: top + height, width: 40, height });
class ElementStub {
  children: ElementStub[] = [];
  parent?: ElementStub;
  connectedRoot = false;
  embed = false;
  get isConnected(): boolean { return this.connectedRoot || this.parent?.isConnected === true; }
  classList = { contains: (name: string) => name === 'internal-link' && !!this.target };
  ownerDocument = { createRange: () => ({ selectNodeContents() {} }) };
  rects = [box(3)];
  getClientRects = vi.fn(() => this.rects);
  getBoundingClientRect = vi.fn(() => box(0, 100));
  querySelectorAll = vi.fn(() => this.children.filter(child => child.target !== undefined));
  constructor(readonly target?: string) {}
  append(element: ElementStub) {
    element.remove(); element.parent = this; this.children.push(element); return element;
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  contains(element: ElementStub): boolean { return this === element || this.children.some(child => child.contains(element)); }
  closest(selector: string): ElementStub | undefined {
    return selector.includes('embed') && this.embed ? this : this.parent?.closest(selector);
  }
  getAttribute() { return this.target; }
}

function fixture() {
  const changed = vi.fn(), resolves = vi.fn(() => null);
  const reading = new ReadingAnchors({ metadataCache: { getFirstLinkpathDest: resolves } } as unknown as App, changed);
  const pane = (path: string, text: string) => {
    const root = new ElementStub(); root.connectedRoot = true;
    const view = { file: { path }, data: text, previewMode: { containerEl: root, rerender: vi.fn() } };
    return { root, state: view, view: view as unknown as MarkdownView };
  };
  const process = (element: ElementStub, sourcePath: string, text: string, docId: string, lineStart = 0, lineEnd = lineStart) => {
    let child!: MarkdownRenderChild;
    const context = {
      sourcePath, docId, getSectionInfo: () => ({ text, lineStart, lineEnd }),
      addChild: (value: MarkdownRenderChild) => { child = value; }
    };
    reading.process(element as unknown as HTMLElement, context as unknown as MarkdownPostProcessorContext);
    return child;
  };
  return { reading, changed, resolves, pane, process };
}

describe('reading anchors across native section reconstruction', () => {
  it('shares source parsing between live render contexts while resolving links per source and pane', () => {
    const parse = vi.spyOn(parser, 'parseDocument');
    try {
      const f = fixture(), text = '[[Target]]';
      const a = f.pane('A.md', text), b = f.pane('A.md', text), c = f.pane('Other/B.md', text);
      const sections = [a, b, c].map(pane => pane.root.append(new ElementStub()));
      const links = sections.map(section => section.append(new ElementStub('Target')));
      const children = sections.map((section, index) => f.process(section, [a, b, c][index].state.file.path, text, String(index)));
      expect(parse).toHaveBeenCalledOnce();
      expect(f.resolves.mock.calls).toEqual([['Target', 'A.md'], ['Target', 'A.md'], ['Target', 'Other/B.md']]);
      expect(f.reading.anchors(a.view).map(anchor => anchor.element)).toEqual([links[0]]);
      expect(links.map(link => link.getClientRects.mock.calls.length)).toEqual([1, 0, 0]);
      expect(f.reading.anchors(b.view).map(anchor => anchor.element)).toEqual([links[1]]);
      expect(f.reading.anchors(c.view).map(anchor => anchor.element)).toEqual([links[2]]);
      for (const child of children) child.unload();
      f.process(sections[0], 'A.md', text, 'reload');
      expect(parse).toHaveBeenCalledTimes(2);
    } finally { parse.mockRestore(); }
  });

  it('keeps a recycled section’s new binding when the old host child unloads', () => {
    const f = fixture(), first = '[[Old]]', next = '[[New]]';
    const pane = f.pane('A.md', first), section = pane.root.append(new ElementStub());
    const oldLink = section.append(new ElementStub('Old'));
    const oldChild = f.process(section, 'A.md', first, 'old');
    oldLink.remove();
    const newLink = section.append(new ElementStub('New'));
    pane.state.file.path = 'B.md'; pane.state.data = next;
    const newChild = f.process(section, 'B.md', next, 'new');
    expect(f.changed.mock.calls).toEqual([['A.md'], ['A.md'], ['B.md']]);
    oldChild.unload(); oldChild.unload();
    expect(f.changed).toHaveBeenCalledTimes(3);
    const [anchor] = f.reading.anchors(pane.view);
    expect(anchor.element).toBe(newLink);
    expect(f.reading.sourceText(pane.view, anchor.occurrence)).toBe(next);

    // A connected anchor moved outside its registered section cannot authorize
    // navigation or an edit from a stale card in the former pane.
    f.pane('B.md', next).root.append(newLink);
    expect(f.reading.elementFor(pane.view, anchor.occurrence)).toBeUndefined();
    expect(f.reading.sourceText(pane.view, anchor.occurrence)).toBeUndefined();
    newChild.unload();
    expect(f.changed).toHaveBeenLastCalledWith('B.md');
    expect(f.reading.anchors(pane.view)).toEqual([]);
  });

  it('uses a link-free section as a stale-source witness without scanning its native HTML', () => {
    const f = fixture(), old = 'Plain [text](https://example.com)';
    const pane = f.pane('A.md', old), section = pane.root.append(new ElementStub());
    f.process(section, 'A.md', old, 'old');
    expect(section.querySelectorAll).not.toHaveBeenCalled();
    pane.state.data = '[[Replacement]]';
    expect(f.reading.anchors(pane.view)).toEqual([]);
    expect(f.reading.anchors(pane.view)).toEqual([]);
    expect(pane.state.previewMode.rerender).toHaveBeenCalledExactlyOnceWith(true);

    const replacement = section.append(new ElementStub('Replacement'));
    f.process(section, 'A.md', pane.state.data, 'refresh');
    expect(f.reading.anchors(pane.view).map(anchor => anchor.element)).toEqual([replacement]);
    expect(pane.state.previewMode.rerender).toHaveBeenCalledOnce();
  });

  it('uses the last inline rectangle for a multiline label and skips offscreen text Ranges', () => {
    vi.mocked(textFragments).mockClear();
    const f = fixture(), source = '[[Wrapped]]\n\n[[Far]]', pane = f.pane('A.md', source);
    const nearSection = pane.root.append(new ElementStub()), farSection = pane.root.append(new ElementStub());
    const wrapped = nearSection.append(new ElementStub('Wrapped')), far = farSection.append(new ElementStub('Far'));
    wrapped.rects = [box(90), box(112)]; far.rects = [box(800)];
    f.process(nearSection, 'A.md', source, 'read', 0);
    f.process(farSection, 'A.md', source, 'read', 2);
    expect(f.reading.anchors(pane.view, 0).map(anchor => anchor.rect)).toEqual([box(112)]);
    expect(wrapped.getClientRects).toHaveBeenCalledOnce();
    expect(far.getClientRects).toHaveBeenCalledOnce();
    expect(wrapped.getBoundingClientRect).not.toHaveBeenCalled();
    expect(far.getBoundingClientRect).not.toHaveBeenCalled();
    expect(textFragments).toHaveBeenCalledOnce();
  });
});
