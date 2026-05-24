import { useLayoutEffect, useState } from 'react';

export interface AnchorPos {
  top: number;
  /** Distance from viewport right edge — popover hugs the bottom-right of its
   *  trigger and grows leftward. */
  right: number;
}

/**
 * Viewport-fixed coordinates that pin a popover to the bottom-right of its
 * trigger. Returns null until the trigger is measurable.
 *
 * We use position:fixed (not absolute) because admin layout sits inside `.main`
 * with `overflow: hidden` — an absolute popover extending past that ancestor
 * gets clipped. Fixed escapes the overflow context entirely.
 */
export function useAnchoredPos(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // Capture-phase scroll catches scrolls in any ancestor (e.g. .content).
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, triggerRef]);

  return pos;
}
