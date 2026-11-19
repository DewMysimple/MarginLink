import { MarkdownRenderChild, parseLinktext, type App, type MarkdownPostProcessorContext, type MarkdownView } from 'obsidian';
import { parseDocument } from '../core/wikilink-parser';
import type { Anchor, WikilinkOccurrence } from '../types';
import { textFragments } from '../view/text-fragments';
import { mapReadingLinks, type SourceLink } from './source-mapping';
import { layoutIdentities } from '../core/layout-identity';

interface Entry { sourcePath: string; text: string; element: HTMLElement; identities: Map<number, string>; links: { element: HTMLElement; occurrence: WikilinkOccurrence }[] }

function indexDocument(text: string) {
  const parsed = parseDocument(text);
  const starts = [0];
  for (let offset = text.indexOf('\n'); offset !== -1; offset = text.indexOf('\n', offset + 1)) starts.push(offset + 1);
  const events: SourceLink[] = [
    ...parsed.links.map(occurrence => ({ start: occurrence.start, target: occurrence.target, occurrence })),
    ...parsed.markdownLinks.map(link => ({ start: link.start, target: link.target }))
  ].sort((a, b) => a.start - b.start);
  const firstEvent = (offset: number) => {
    let lo = 0, hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (events[mid].start < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return { text, identities: layoutIdentities(text, parsed.links), users: 0,
    section: (from: number, to: number) => events.slice(firstEvent(starts[from] ?? text.length), firstEvent(starts[to + 1] ?? text.length)) };
}
export class ReadingAnchors {
  private entries = new Map<HTMLElement, Entry>();
  private refreshing = new WeakMap<MarkdownView, string>();
  private children = new Set<MarkdownRenderChild>();
  // One current full source per rendered document, only in memory.
  private documents = new Map<string, ReturnType<typeof indexDocument>>();
  constructor(private app: App, private changed: () => void) {}
  process(element: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const info = ctx.getSectionInfo(element);
    if (!info) return;
    const existing = this.documents.get(ctx.docId);
    const document = existing?.text === info.text ? existing : indexDocument(info.text);
    this.documents.set(ctx.docId, document);
    const events = document.section(info.lineStart, info.lineEnd);
    const anchors = [...element.querySelectorAll<HTMLElement>('a.internal-link, a.external-link')]
      .filter(a => !a.closest('.internal-embed, .markdown-embed, pre, code'));
    const normalize = (value: string) => {
      let decoded = value;
      try { decoded = decodeURI(value); } catch { /* Preserve malformed URI text verbatim. */ }
      const { path, subpath } = parseLinktext(decoded);
      const file = path ? this.app.metadataCache.getFirstLinkpathDest(path, ctx.sourcePath) : this.app.vault.getFileByPath(ctx.sourcePath);
      return (file?.path ?? path.replace(/^\.\//, '')) + subpath;
    };
    const links = mapReadingLinks(events, anchors.map(anchor => ({ element: anchor, target: anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '' })), normalize)
      .filter(link => link.element.classList.contains('internal-link'));
    this.entries.set(element, { sourcePath: ctx.sourcePath, text: info.text, element, links, identities: document.identities });
    document.users++;
    const child = new MarkdownRenderChild(element);
    this.children.add(child);
    child.register(() => {
      this.children.delete(child);
      const current = this.entries.get(element);
      if (current?.links === links) this.entries.delete(element);
      document.users--;
      if (document.users <= 0 && this.documents.get(ctx.docId) === document) this.documents.delete(ctx.docId);
      this.changed();
    });
    ctx.addChild(child);
    this.changed();
  }
  elementFor(view: MarkdownView, occurrence: WikilinkOccurrence): HTMLElement | undefined {
    for (const entry of this.entries.values()) {
      if (entry.text !== view.data || entry.sourcePath !== view.file?.path || !view.previewMode.containerEl.contains(entry.element)) continue;
      const link = entry.links.find(l => l.occurrence.start === occurrence.start && l.occurrence.raw === occurrence.raw);
      if (link?.element.isConnected) return link.element;
    }
  }
  sourceText(view: MarkdownView, occurrence: WikilinkOccurrence): string | undefined {
    for (const entry of this.entries.values()) {
      if (entry.text === view.data && entry.sourcePath === view.file?.path && view.previewMode.containerEl.contains(entry.element) &&
        entry.links.some(link => link.occurrence.start === occurrence.start && link.occurrence.raw === occurrence.raw)) return entry.text;
    }
  }
  anchors(view: MarkdownView, overscan = 2400): Anchor[] {
    const viewport = view.previewMode.containerEl.getBoundingClientRect();
    const result: Anchor[] = [];
    const seen = new Set<HTMLElement>();
    let stale = false;
    for (const entry of this.entries.values()) {
      if (entry.sourcePath !== view.file?.path || !view.previewMode.containerEl.contains(entry.element) || entry.element.closest('.internal-embed')) continue;
      // Obsidian can retain an unchanged paragraph after an earlier edit.
      // Its postprocessor still refers to offsets in the previous document.
      if (entry.text !== view.data) { stale = true; continue; }
      for (const { element, occurrence } of entry.links) {
        if (!element.isConnected || seen.has(element)) continue;
        seen.add(element);
        // Reading mode may keep an entire long document mounted. Measure full
        // text Ranges only near this pane; retain old slots in the overlay cache.
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom < viewport.top - overscan || bounds.top > viewport.bottom + overscan) continue;
        const rects = Array.from(element.getClientRects());
        const rect = rects.at(-1);
        if (!rect) continue;
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const fragments = textFragments(range);
        if (fragments.length) result.push({ key: String(occurrence.start), occurrence, rect, fragments, element, layoutKey: entry.identities.get(occurrence.start) });
      }
    }
    if (stale && this.refreshing.get(view) !== view.data) {
      this.refreshing.set(view, view.data);
      view.previewMode.rerender(true);
    } else if (!stale && result.length) this.refreshing.delete(view);
    return result;
  }
  clear(): void {
    for (const child of this.children) child.unload();
    this.children.clear(); this.entries.clear(); this.documents.clear();
  }
}
