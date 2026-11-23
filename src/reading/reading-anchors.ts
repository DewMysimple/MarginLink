import { MarkdownRenderChild, parseLinktext, type App, type MarkdownPostProcessorContext, type MarkdownView } from 'obsidian';
import { parseDocument } from '../core/wikilink-parser';
import type { Anchor, WikilinkOccurrence } from '../types';
import { textFragments } from '../view/text-fragments';
import { mapReadingLinks, type SourceLink } from './source-mapping';
import { layoutIdentities } from '../core/layout-identity';

interface Entry { sourcePath: string; text: string; element: HTMLElement; identities: Map<number, string>; links: { element: HTMLElement; occurrence: WikilinkOccurrence }[] }
const inEmbed = (element: Element) => !!element.closest('.internal-embed, .markdown-embed');

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
  return { identities: layoutIdentities(text, parsed.links), users: 0,
    section: (from: number, to: number) => events.slice(firstEvent(starts[from] ?? text.length), firstEvent(starts[to + 1] ?? text.length)) };
}
export class ReadingAnchors {
  private entries = new Map<HTMLElement, Entry>();
  private bySource = new Map<string, Map<HTMLElement, Entry>>();
  private refreshing = new WeakMap<MarkdownView, { path: string; text: string }>();
  private children = new Set<MarkdownRenderChild>();
  // The parse is independent of the pane and source path. Keep indexes for
  // exact source snapshots only while a host component still uses them.
  private documents = new Map<string, ReturnType<typeof indexDocument>>();
  constructor(private app: App, private changed: (sourcePath: string) => void) {}
  process(element: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const info = ctx.getSectionInfo(element);
    if (!info) return;
    const { text } = info, { sourcePath } = ctx;
    const document = this.documents.get(text) ?? indexDocument(text);
    this.documents.set(text, document);
    const events = document.section(info.lineStart, info.lineEnd);
    const normalize = (value: string) => {
      let decoded = value;
      try { decoded = decodeURI(value); } catch { /* Preserve malformed URI text verbatim. */ }
      const { path, subpath } = parseLinktext(decoded);
      const file = path ? this.app.metadataCache.getFirstLinkpathDest(path, sourcePath) : this.app.vault.getFileByPath(sourcePath);
      return (file?.path ?? path.replace(/^\.\//, '')) + subpath;
    };
    // Link-free sections still track the source snapshot for stale detection.
    const anchors = events.some(event => event.occurrence) ? [...element.querySelectorAll<HTMLElement>('a.internal-link, a.external-link')]
      .filter(a => !a.closest('.internal-embed, .markdown-embed, pre, code')) : [];
    const links = anchors.length ? mapReadingLinks(events, anchors.map(anchor => ({ element: anchor, target: anchor.getAttribute('data-href') ?? anchor.getAttribute('href') ?? '' })), normalize)
      .filter(link => link.element.classList.contains('internal-link')) : [];
    const previous = this.entries.get(element);
    if (previous && previous.sourcePath !== sourcePath) this.removeEntry(previous);
    const entry: Entry = { sourcePath, text, element, links, identities: document.identities };
    this.entries.set(element, entry);
    const sections = this.bySource.get(sourcePath) ?? new Map<HTMLElement, Entry>();
    sections.set(element, entry); this.bySource.set(sourcePath, sections);
    document.users++;
    const child = new MarkdownRenderChild(element);
    this.children.add(child);
    child.register(() => {
      if (!this.children.delete(child)) return;
      const wasCurrent = this.entries.get(element) === entry;
      if (wasCurrent) this.removeEntry(entry);
      document.users--;
      if (document.users === 0 && this.documents.get(text) === document) this.documents.delete(text);
      if (wasCurrent) this.changed(sourcePath);
    });
    ctx.addChild(child);
    if (previous && previous.sourcePath !== sourcePath) this.changed(previous.sourcePath);
    this.changed(sourcePath);
  }
  private removeEntry(entry: Entry): void {
    this.entries.delete(entry.element);
    const sections = this.bySource.get(entry.sourcePath);
    sections?.delete(entry.element);
    if (sections?.size === 0) this.bySource.delete(entry.sourcePath);
  }
  private *sectionsIn(view: MarkdownView, path = view.file?.path): Iterable<Entry> {
    if (!path) return;
    const root = view.previewMode.containerEl;
    for (const entry of this.bySource.get(path)?.values() ?? []) {
      if (entry.element.isConnected && root.contains(entry.element) && !inEmbed(entry.element)) yield entry;
    }
  }
  elementFor(view: MarkdownView, occurrence: WikilinkOccurrence): HTMLElement | undefined {
    for (const entry of this.sectionsIn(view)) {
      if (entry.text !== view.data) continue;
      const link = entry.links.find(l => l.occurrence.start === occurrence.start && l.occurrence.raw === occurrence.raw &&
        l.element.isConnected && entry.element.contains(l.element));
      if (link) return link.element;
    }
  }
  sourceText(view: MarkdownView, occurrence: WikilinkOccurrence): string | undefined {
    if (this.elementFor(view, occurrence)) return view.data;
  }
  anchors(view: MarkdownView, overscan = 2400): Anchor[] {
    const path = view.file?.path, text = view.data;
    if (!path) return [];
    const viewport = view.previewMode.containerEl.getBoundingClientRect();
    const low = viewport.top - overscan, high = viewport.bottom + overscan;
    const result: Anchor[] = [];
    const seen = new Set<HTMLElement>();
    let stale = false, current = false;
    for (const entry of this.sectionsIn(view, path)) {
      // Obsidian can retain an unchanged paragraph after an earlier edit.
      // Its postprocessor still refers to offsets in the previous document.
      if (entry.text !== text) { stale = true; continue; }
      current = true;
      for (const { element, occurrence } of entry.links) {
        if (!element.isConnected || !entry.element.contains(element) || seen.has(element)) continue;
        seen.add(element);
        const rects = element.getClientRects(), rect = rects[rects.length - 1];
        if (!rect) continue;
        // Reuse the inline rect list for the bounding-box check. The final
        // inline rect is still the anchor reference for multiline labels.
        let top = Infinity, bottom = -Infinity, hasArea = false;
        for (const box of rects) {
          hasArea ||= box.width > 0 && box.height > 0;
          if (box.width || box.height) { top = Math.min(top, box.top); bottom = Math.max(bottom, box.bottom); }
        }
        if (!hasArea) { top = rects[0].top; bottom = rects[0].bottom; }
        if (bottom < low || top > high) continue;
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const fragments = textFragments(range);
        if (fragments.length) result.push({ key: String(occurrence.start), occurrence, rect, fragments, element, layoutKey: entry.identities.get(occurrence.start) });
      }
    }
    const requested = this.refreshing.get(view);
    if (stale && (requested?.path !== path || requested.text !== text)) {
      this.refreshing.set(view, { path, text });
      view.previewMode.rerender(true);
    } else if (!stale && (current || requested?.path !== path || requested.text !== text)) this.refreshing.delete(view);
    return result;
  }
  clear(): void {
    for (const child of this.children) child.unload();
    this.children.clear(); this.entries.clear(); this.bySource.clear(); this.documents.clear();
  }
}
