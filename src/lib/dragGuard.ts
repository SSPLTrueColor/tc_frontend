/**
 * Clicks that end a text selection / drag must not open records.
 * Tracks the last pointer-down position; `isDragClick(e)` is true when the pointer moved more than a few px
 * or text is selected.
 */
let down: { x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => (down = { x: e.clientX, y: e.clientY }), true);
}
export function isDragClick(e: { clientX: number; clientY: number }): boolean {
  if (typeof window !== 'undefined' && window.getSelection()?.toString()) return true;
  return !!down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
}
