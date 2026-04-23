import { useEffect } from 'react';

type KeyHandler = (event: KeyboardEvent) => void;

interface Options {
  /** Skip if the focused element is an <input>/<textarea>/contenteditable. */
  skipWhenTyping?: boolean;
  /** Use the capture phase so modals can listen first. */
  capture?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Small keyboard-shortcut binder. `key` matches `KeyboardEvent.key` exactly
 * (so "Enter", "Escape", "a", etc). Pass `skipWhenTyping` to avoid hijacking
 * Enter inside text inputs.
 *
 * The handler is wrapped so `event.preventDefault()` / `stopPropagation()` is
 * the caller's responsibility — we don't assume what they want.
 */
export function useKeyboardShortcut(
  key: string,
  handler: KeyHandler | null,
  { skipWhenTyping = true, capture = false }: Options = {},
) {
  useEffect(() => {
    if (!handler) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key !== key) return;
      if (skipWhenTyping && isTypingTarget(ev.target)) return;
      handler!(ev);
    }
    window.addEventListener('keydown', onKey, capture);
    return () => window.removeEventListener('keydown', onKey, capture);
  }, [key, handler, skipWhenTyping, capture]);
}
