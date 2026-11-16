interface TooltipSession { owner: HTMLElement; close: () => void }
const sessions = new WeakMap<Document, TooltipSession>();

// A document owns at most one pending or visible MarginLink card tooltip.
// Nothing is left attached to the document after it closes.
export const cardTooltip = {
  show(owner: HTMLElement): void {
    const doc = owner.ownerDocument, win = doc.defaultView;
    sessions.get(doc)?.close();
    const text = owner.dataset.tooltip;
    if (!win || !text) return;
    let element: HTMLDivElement | undefined;
    const close = () => {
      win.clearTimeout(timer); element?.remove();
      doc.removeEventListener('pointerdown', close, true); doc.removeEventListener('scroll', close, true);
      doc.removeEventListener('keydown', close, true); win.removeEventListener('blur', close); win.removeEventListener('resize', close);
      if (sessions.get(doc)?.owner === owner) sessions.delete(doc);
    };
    const timer = win.setTimeout(() => {
      if (!owner.isConnected) { close(); return; }
      const rect = owner.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) { close(); return; }
      element = doc.createElement('div'); element.className = 'margin-link-tooltip'; element.setAttribute('role', 'tooltip');
      element.textContent = text; doc.body.appendChild(element);
      const box = element.getBoundingClientRect();
      const left = Math.max(8, Math.min(win.innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2));
      const top = rect.bottom + box.height + 16 <= win.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8);
      Object.assign(element.style, { left: `${left}px`, top: `${top}px` });
    }, 500);
    sessions.set(doc, { owner, close });
    doc.addEventListener('pointerdown', close, true); doc.addEventListener('scroll', close, true);
    doc.addEventListener('keydown', close, true); win.addEventListener('blur', close); win.addEventListener('resize', close);
  },
  hideWithin(root: HTMLElement): void {
    const session = sessions.get(root.ownerDocument);
    if (session && (session.owner === root || root.contains(session.owner))) session.close();
  }
};
