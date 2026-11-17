import type { ChangeSpec, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { Editor } from 'obsidian';

/** Obsidian's Editor.transaction always requests that the old cursor be made
 * visible. Relinking changes a target, not the reader's location. Override that
 * target with CM's native document-relative snapshot in the same event turn.
 * This effect changes no text or selection and creates no additional undo step. */
export function preserveRelinkViewport(editor: Editor, cm: EditorView | undefined, change: ChangeSpec): () => void {
  const pixels = typeof editor.getScrollInfo === 'function' ? editor.getScrollInfo() : undefined;
  let before: Text | undefined, after: Text | undefined;
  let original: ReturnType<EditorView['scrollSnapshot']> | undefined, mapped: typeof original;
  // Capability guard for older hosts; the public Editor pixel API remains a
  // synchronous fallback, never a delayed loop that can steal a user's scroll.
  if (cm && typeof cm.scrollSnapshot === 'function') {
    before = cm.state.doc;
    const changes = cm.state.changes(change);
    after = changes.apply(before); original = cm.scrollSnapshot(); mapped = original.map(changes);
  }
  return () => {
    if (cm && original && before && after) {
      const snapshot = cm.state.doc.eq(after) ? mapped : cm.state.doc.eq(before) ? original : undefined;
      if (snapshot) { cm.dispatch({ effects: snapshot }); return; }
      return; // A different edit owns this document now; do not pin stale pixels.
    }
    if (pixels && typeof editor.scrollTo === 'function') editor.scrollTo(pixels.left, pixels.top);
  };
}
