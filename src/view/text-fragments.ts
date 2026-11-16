import type { Box } from '../types';

// DOM ranges may also report the boxes of fully selected elements. Measure text
// nodes only so links with nested markup do not acquire an enclosing blank box.
export function textFragments(range: Range): Box[] {
  const root = range.commonAncestorContainer;
  const doc = root.ownerDocument;
  if (!doc) return [];
  const textRange = doc.createRange();
  const boxes: Box[] = [];
  const collect = (node: Node) => {
    textRange.selectNodeContents(node);
    if (range.startContainer === node) textRange.setStart(node, range.startOffset);
    if (range.endContainer === node) textRange.setEnd(node, range.endOffset);
    for (const rect of textRange.getClientRects()) {
      if (rect.width > 0.5 && rect.height > 0) boxes.push(rect);
    }
  };
  if (root.nodeType === Node.TEXT_NODE) collect(root);
  else {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, node => {
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    });
    while (walker.nextNode()) collect(walker.currentNode);
  }
  return mergeTextFragments(boxes);
}

export function mergeTextFragments(boxes: Box[]): Box[] {
  const lines: Box[] = [];
  for (const box of boxes.sort((a, b) => a.top - b.top || a.left - b.left)) {
    const last = lines.at(-1);
    if (last && Math.abs(last.top - box.top) < 1 && Math.abs(last.bottom - box.bottom) < 1 &&
        box.left <= last.right + 1 && box.right >= last.left - 1) {
      last.left = Math.min(last.left, box.left);
      last.right = Math.max(last.right, box.right);
      last.top = Math.min(last.top, box.top);
      last.bottom = Math.max(last.bottom, box.bottom);
    } else {
      lines.push({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
    }
  }
  return lines;
}
