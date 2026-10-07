/**
 * Keyboard routing. One window-level listener (installed by App) dispatches to:
 *  1. the active map tool (drafts consume Enter / Escape / Backspace first),
 *  2. global shortcuts.
 * Keeping a single listener makes priority explicit instead of relying on
 * listener registration order.
 */

type KeyHandler = (e: KeyboardEvent) => boolean;

let toolHandler: KeyHandler | null = null;

export function setToolKeyHandler(fn: KeyHandler | null): void {
  toolHandler = fn;
}

export function routeToTool(e: KeyboardEvent): boolean {
  return toolHandler ? toolHandler(e) : false;
}

/** True when the key event targets a text field, so shortcuts must stay out of the way. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (t as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset'].includes(type);
  }
  return false;
}
