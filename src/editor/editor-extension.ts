import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { parseDocument, type ParsedDocument } from '../core/wikilink-parser';
import { textFragments } from '../view/text-fragments';
import type { Anchor, WikilinkOccurrence } from '../types';
import { layoutIdentities } from '../core/layout-identity';

export interface EditorHost {
  bridges: Set<EditorBridge>;
  refresh(bridge?: EditorBridge): void;
  documentChanged?(bridge: EditorBridge): void;
}
export class EditorBridge {
  parsed: ParsedDocument;
  revision = 0;
  alive = true;
  text: string;
  identities = new Map<number, string>();
  private hint?: { from: number; target: string; side: 'left' | 'right'; revision: number };
  constructor(readonly cm: EditorView, readonly host: EditorHost) {
    this.text = cm.state.doc.toString();
    this.parsed = parseDocument(this.text);
    this.identities = layoutIdentities(this.text, this.parsed.links);
    host.bridges.add(this);
    host.refresh();
  }
  update(update: ViewUpdate): void {
    if (update.docChanged) {
      this.revision++;
      this.text = update.state.doc.toString();
      this.parsed = parseDocument(this.text);
      this.identities = layoutIdentities(this.text, this.parsed.links);
      this.hint = undefined;
      this.host.documentChanged?.(this);
      this.host.refresh();
    } else if (update.selectionSet || update.viewportChanged || update.geometryChanged || update.focusChanged) {
      this.host.refresh(this);
    }
  }
  prefer(from: number, target: string, side: 'left' | 'right'): void {
    this.hint = { from, target, side, revision: this.revision };
  }
  preferred(from: number, target: string): 'left' | 'right' | undefined {
    return this.hint?.from === from && this.hint.target === target && this.hint.revision === this.revision ? this.hint.side : undefined;
  }
  private range(from: number, to: number): Range | undefined {
    try {
      const start = this.cm.domAtPos(from);
      const end = this.cm.domAtPos(to);
      const range = this.cm.dom.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return range;
    } catch { return; }
  }
  linkSyntaxVisible(occurrence: WikilinkOccurrence): boolean {
    const range = this.range(occurrence.start, occurrence.start + 2);
    return !!range && range.toString() === '[[' && Array.from(range.getClientRects()).some(rect => rect.width > 0.5 && rect.height > 0.5);
  }
  rangeRects(from: number, to: number): DOMRect[] {
    try {
      const range = this.range(from, to);
      if (!range) return [];
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0);
      if (rects.length) return rects;
      const coord = this.cm.coordsAtPos(from);
      if (coord) return [new DOMRect(coord.left, coord.top, Math.max(1, coord.right - coord.left), coord.bottom - coord.top)];
    } catch { /* A CM viewport can be replaced between measurement requests. */ }
    return [];
  }
  anchors(): Anchor[] {
    const result: Anchor[] = [];
    const links = this.parsed.links;
    let next = 0;
    for (const { from, to } of this.cm.visibleRanges) {
      // Both links and visible spans are in document order. Keep the cursor
      // past measured links so a link crossing a folded gap is visited once.
      let low = next, high = links.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (links[middle].end <= from) low = middle + 1;
        else high = middle;
      }
      next = low;
      while (next < links.length && links[next].start < to) {
        const occurrence = links[next++];
        const aliasAt = occurrence.raw.indexOf('|');
        const start = occurrence.start + (aliasAt >= 0 ? aliasAt + 1 : 2);
        const range = this.range(start, occurrence.end - 2);
        if (!range) continue;
        const fragments = textFragments(range);
        // Preserve the original layout reference independently of the chosen port.
        const rect = Array.from(range.getClientRects()).filter(r => r.width > 0.5 && r.height > 0).at(-1);
        if (rect && fragments.length) result.push({ key: String(occurrence.start), occurrence, rect, fragments, layoutKey: this.identities.get(occurrence.start) });
      }
    }
    return result;
  }
  destroy(): void {
    this.alive = false;
    this.host.bridges.delete(this);
    this.host.refresh();
  }
}
export function editorExtension(host: EditorHost) {
  return ViewPlugin.define(view => new EditorBridge(view, host));
}
