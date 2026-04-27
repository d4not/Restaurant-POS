import type { CSSProperties, ReactNode } from 'react';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FloorZone } from '../../api/floors';

export const ALL_ZONES = '__all__';

interface CanvasProps {
  zones: FloorZone[];
  // The currently-focused tab. ALL_ZONES → fit-to-bounds. Otherwise we render
  // an identity transform on the canvas and let each zone scale individually
  // via the per-zone transforms passed to renderZones so the chosen one fills
  // the viewport.
  focusedZoneId: string;
  // Render-prop: caller draws the zone bodies; we hand them per-zone transform
  // strings + the "faded" flag so non-focused zones can dim cleanly.
  renderZones: (ctx: {
    zoneTransforms: Map<string, string>;
    fadedZoneIds: Set<string>;
  }) => ReactNode;
  canvasWidth: number;
  canvasHeight: number;
  // Edit mode disables pinch/pan so the cashier can drag/resize tables and
  // zones without two-finger gestures hijacking their work.
  editing?: boolean;
  children?: ReactNode;
}

export interface CanvasHandle {
  // Scale of the *outer* canvas (only non-1 in all-zones mode, where the
  // canvas itself is scaled). In single-zone mode this is 1 — the zone scales
  // individually, ask `getZoneScale` for that one. In both modes this includes
  // any active user pinch on top of the auto-fit.
  getCanvasScale: () => number;
  getZoneScale: (zoneId: string) => number;
  wrapEl: HTMLDivElement | null;
  canvasEl: HTMLDivElement | null;
}

const wrapStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  backgroundColor: 'var(--bg)',
  backgroundImage:
    'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)',
  backgroundSize: '32px 32px',
  borderRadius: 14,
  border: '1px solid var(--border)',
};

const innerStyleBase: CSSProperties = {
  position: 'relative',
  transformOrigin: '0 0',
  transition: 'transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1)',
};

interface Layout {
  canvasTransform: string;
  canvasScale: number;
  zoneTransforms: Map<string, string>;
  zoneScales: Map<string, number>;
  fadedZoneIds: Set<string>;
}

function computeLayout(
  zones: FloorZone[],
  focusedZoneId: string,
  wrapWidth: number,
  wrapHeight: number,
): Layout {
  const dineZones = zones.filter((z) => z.kind !== 'TAKEOUT');
  const empty: Layout = {
    canvasTransform: '',
    canvasScale: 1,
    zoneTransforms: new Map(),
    zoneScales: new Map(),
    fadedZoneIds: new Set(),
  };
  if (dineZones.length === 0 || wrapWidth === 0 || wrapHeight === 0) return empty;

  if (focusedZoneId === ALL_ZONES) {
    // Fit-to-bounds: scale the entire canvas so every zone is visible.
    // Bounds are taken from the zone containers (which already encompass any
    // overflowing tables thanks to effectiveZones). We use a small padding so
    // tables hit the largest readable size on a tablet, and lift the scale
    // cap so a sparse layout (few zones, few tables) doesn't render at a
    // postage-stamp size just because the math allows it.
    const padding = 16;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const z of dineZones) {
      minX = Math.min(minX, z.pos_x);
      minY = Math.min(minY, z.pos_y);
      maxX = Math.max(maxX, z.pos_x + z.width);
      maxY = Math.max(maxY, z.pos_y + z.height);
    }
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const availW = wrapWidth - padding * 2;
    const availH = wrapHeight - padding * 2;
    const scale = Math.min(availW / contentW, availH / contentH, 2.4);
    const scaledW = contentW * scale;
    const scaledH = contentH * scale;
    const tx = (wrapWidth - scaledW) / 2 - minX * scale;
    const ty = (wrapHeight - scaledH) / 2 - minY * scale;
    return {
      canvasTransform: `translate(${tx}px, ${ty}px) scale(${scale})`,
      canvasScale: scale,
      zoneTransforms: new Map(),
      zoneScales: new Map(),
      fadedZoneIds: new Set(),
    };
  }

  // Single-zone focus: identity on the canvas, scale the chosen zone.
  const target = dineZones.find((z) => z.id === focusedZoneId);
  if (!target) return empty;
  const padding = 24;
  const availW = wrapWidth - padding * 2;
  const availH = wrapHeight - padding * 2;
  const scale = Math.min(availW / target.width, availH / target.height, 2.4);
  const scaledW = target.width * scale;
  const scaledH = target.height * scale;
  const tx = (wrapWidth - scaledW) / 2 - target.pos_x;
  const ty = (wrapHeight - scaledH) / 2 - target.pos_y;
  const zoneTransforms = new Map<string, string>();
  const zoneScales = new Map<string, number>();
  const fadedZoneIds = new Set<string>();
  for (const z of dineZones) {
    if (z.id === target.id) {
      zoneTransforms.set(z.id, `translate(${tx}px, ${ty}px) scale(${scale})`);
      zoneScales.set(z.id, scale);
    } else {
      fadedZoneIds.add(z.id);
    }
  }
  return {
    canvasTransform: '',
    canvasScale: 1,
    zoneTransforms,
    zoneScales,
    fadedZoneIds,
  };
}

// User pinch transform applied on top of the auto-fit. Identity when null
// (the auto-fit alone governs). Scale here is *additional* zoom on top of
// whatever auto-fit chose; tx/ty are screen-space pixel offsets.
type UserTransform = { scale: number; tx: number; ty: number };

const PINCH_MIN = 0.5;
const PINCH_MAX = 4;
// Below this user-scale we snap back to auto-fit. Slightly above 1 so a
// small accidental pinch-in doesn't strand the user at a near-fit zoom.
const PINCH_SNAP_BACK = 1.04;
const DOUBLE_TAP_MS = 280;
const TAP_SUPPRESSION_MS = 250;

function clampPan(
  t: UserTransform,
  wrapW: number,
  wrapH: number,
): UserTransform {
  // Auto-fit always covers the wrap; any over-pan would pull cream void into
  // view. Lock translate so the scaled content edges can't cross the wrap
  // edges. When the content is exactly sized (scale === 1) tx/ty must be 0.
  const scaledW = wrapW * t.scale;
  const scaledH = wrapH * t.scale;
  const minX = wrapW - scaledW;
  const minY = wrapH - scaledH;
  let tx = t.tx;
  let ty = t.ty;
  if (scaledW <= wrapW) tx = (wrapW - scaledW) / 2;
  else tx = Math.min(0, Math.max(minX, tx));
  if (scaledH <= wrapH) ty = (wrapH - scaledH) / 2;
  else ty = Math.min(0, Math.max(minY, ty));
  return { scale: t.scale, tx, ty };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function mid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export const FloorCanvas = forwardRef<CanvasHandle, CanvasProps>(function FloorCanvas(
  { zones, focusedZoneId, renderZones, canvasWidth, canvasHeight, editing, children },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Track viewport size with ResizeObserver — handles split-screen, sidebar
  // toggles, and DPI changes that the bare `window.resize` listener misses.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        setSize((prev) =>
          prev.w !== width || prev.h !== height ? { w: width, h: height } : prev,
        );
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => computeLayout(zones, focusedZoneId, size.w, size.h),
    [zones, focusedZoneId, size.w, size.h],
  );

  // ─── User pinch / pan state ─────────────────────────────────────────────
  const [userT, setUserT] = useState<UserTransform | null>(null);
  // Live-gesture flag turns off the CSS transition so pinch tracks the
  // fingers 1-to-1 instead of easing 450ms behind. Refs (not state) so
  // touchmove doesn't trigger re-renders just to flip the flag.
  const liveRef = useRef(false);
  const pinchRef = useRef<{
    startDist: number;
    startMid: { x: number; y: number };
    startT: UserTransform;
    pointers: Map<number, { x: number; y: number }>;
  } | null>(null);
  const panRef = useRef<{
    startMid: { x: number; y: number };
    startT: UserTransform;
  } | null>(null);
  const tapRef = useRef<{
    startMid: { x: number; y: number };
    startTime: number;
    moved: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const pinchEndedAtRef = useRef<number>(0);
  // Tracking ALL active pointers (not just pinch ones) so we can decide
  // between "no touches", "pan candidate", and "pinch" in one place.
  const activeTouchesRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );

  // Reset user transform when the user changes which zone they're focused on
  // or when entering edit mode (drag/resize math wants the auto-fit baseline).
  useEffect(() => {
    setUserT(null);
  }, [focusedZoneId]);
  useEffect(() => {
    if (editing) setUserT(null);
  }, [editing]);

  // ─── Touch handlers ─────────────────────────────────────────────────────
  function getRect(): DOMRect | null {
    return wrapRef.current?.getBoundingClientRect() ?? null;
  }

  // Structural type — works for both DOM Touch and React.Touch (which differ
  // in optional fields like radiusX/force).
  function localPoint(
    t: { clientX: number; clientY: number },
    rect: DOMRect,
  ) {
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  function onTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (editing) return;
    const rect = getRect();
    if (!rect) return;

    // Refresh the active-touches map from the authoritative event list so we
    // don't drift when a touch is added/removed while we weren't watching.
    activeTouchesRef.current.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      activeTouchesRef.current.set(t.identifier, localPoint(t, rect));
    }

    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]].map((t) => localPoint(t, rect));
      pinchRef.current = {
        startDist: Math.max(1, dist(a, b)),
        startMid: mid(a, b),
        startT: userT ?? { scale: 1, tx: 0, ty: 0 },
        pointers: new Map([
          [e.touches[0].identifier, a],
          [e.touches[1].identifier, b],
        ]),
      };
      panRef.current = null;
      tapRef.current = null;
      liveRef.current = true;
    } else if (e.touches.length === 1) {
      const a = localPoint(e.touches[0], rect);
      // Only start a pan if the user has already pinched in. Otherwise this
      // single-touch is just a tap (or a drag that some child handles).
      if (userT && userT.scale > 1.001) {
        panRef.current = { startMid: a, startT: userT };
        liveRef.current = true;
      }
      tapRef.current = { startMid: a, startTime: performance.now(), moved: false };
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (editing) return;
    const rect = getRect();
    if (!rect) return;

    // Refresh local cache for ALL still-active touches. We only act on the
    // ones relevant to our current gesture (pinch or pan).
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];
      activeTouchesRef.current.set(t.identifier, localPoint(t, rect));
    }

    if (pinchRef.current && e.touches.length >= 2) {
      const ids = Array.from(pinchRef.current.pointers.keys());
      // Find the two touches we started with. If one was lifted, fall back
      // to whatever two we have — better than freezing.
      let a: { x: number; y: number } | undefined;
      let b: { x: number; y: number } | undefined;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const p = localPoint(t, rect);
        if (t.identifier === ids[0]) a = p;
        else if (t.identifier === ids[1]) b = p;
      }
      if (!a) a = localPoint(e.touches[0], rect);
      if (!b) b = localPoint(e.touches[1], rect);

      const newDist = Math.max(1, dist(a, b));
      const newMid = mid(a, b);
      const { startDist, startMid, startT } = pinchRef.current;
      const factor = newDist / startDist;
      const newScale = Math.min(PINCH_MAX, Math.max(PINCH_MIN, startT.scale * factor));
      // Anchor zoom around the midpoint at gesture start. Standard "scale
      // about a point" formula in screen space:
      //   final = (start - anchor) * (newScale / startScale) + anchor + drift
      const ratio = newScale / startT.scale;
      const tx =
        (startT.tx - startMid.x) * ratio + startMid.x + (newMid.x - startMid.x);
      const ty =
        (startT.ty - startMid.y) * ratio + startMid.y + (newMid.y - startMid.y);
      const next = clampPan({ scale: newScale, tx, ty }, rect.width, rect.height);
      // Suppress synthetic clicks for any pinch movement, even tiny.
      tapRef.current = null;
      e.preventDefault();
      setUserT(next);
      return;
    }

    if (panRef.current && e.touches.length >= 1) {
      const a = localPoint(e.touches[0], rect);
      const dx = a.x - panRef.current.startMid.x;
      const dy = a.y - panRef.current.startMid.y;
      const start = panRef.current.startT;
      const next = clampPan(
        { scale: start.scale, tx: start.tx + dx, ty: start.ty + dy },
        rect.width,
        rect.height,
      );
      // Threshold so a tap doesn't cancel itself due to pixel-level finger
      // jitter (4px is roughly under WCAG's reasonable-tap tolerance).
      if (Math.hypot(dx, dy) > 4 && tapRef.current) tapRef.current.moved = true;
      e.preventDefault();
      setUserT(next);
      return;
    }

    // Single-finger move with no active pan — still update tap "moved" so
    // a tap that drifted gets disqualified for double-tap matching.
    if (tapRef.current && e.touches.length === 1) {
      const a = localPoint(e.touches[0], rect);
      if (Math.hypot(a.x - tapRef.current.startMid.x, a.y - tapRef.current.startMid.y) > 6) {
        tapRef.current.moved = true;
      }
    }
  }

  function onTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (editing) return;
    const rect = getRect();

    // Drop lifted touches from the cache.
    for (let i = 0; i < e.changedTouches.length; i++) {
      activeTouchesRef.current.delete(e.changedTouches[i].identifier);
    }

    if (pinchRef.current && e.touches.length < 2) {
      pinchEndedAtRef.current = performance.now();
      pinchRef.current = null;
      // Promote the surviving touch to a pan so the user can keep adjusting
      // without lifting and re-touching.
      if (e.touches.length === 1 && rect && userT && userT.scale > 1.001) {
        const a = localPoint(e.touches[0], rect);
        panRef.current = { startMid: a, startT: userT };
      }
    }

    if (panRef.current && e.touches.length === 0) {
      panRef.current = null;
    }

    // Snap back to auto-fit when the user pinches all the way back.
    if (e.touches.length === 0 && userT && userT.scale <= PINCH_SNAP_BACK) {
      setUserT(null);
    }

    // Double-tap detection. Only counts when the touch was a clean tap
    // (single finger, didn't move more than a few px, finished quickly).
    const tap = tapRef.current;
    if (
      tap &&
      e.touches.length === 0 &&
      !tap.moved &&
      performance.now() - tap.startTime < 300
    ) {
      const now = performance.now();
      const last = lastTapRef.current;
      if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(last.x - tap.startMid.x, last.y - tap.startMid.y) < 28) {
        // Double-tap → reset to auto-fit.
        setUserT(null);
        lastTapRef.current = null;
        // Stamp pinchEndedAt so the synthetic click that follows is
        // suppressed by the same dead-zone we use after pinch.
        pinchEndedAtRef.current = now;
      } else {
        lastTapRef.current = { x: tap.startMid.x, y: tap.startMid.y, t: now };
      }
    }
    tapRef.current = null;

    // Re-enable the CSS transition after the gesture fully ends, on the
    // next frame so the last setUserT can paint without easing first.
    if (e.touches.length === 0) {
      requestAnimationFrame(() => {
        liveRef.current = false;
      });
    }
  }

  function onClickCapture(e: React.MouseEvent<HTMLDivElement>) {
    // Suppress the synthetic click that a tap-after-pinch can generate so
    // table-tap-to-open doesn't fire when the user was just zooming.
    if (performance.now() - pinchEndedAtRef.current < TAP_SUPPRESSION_MS) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  // Effective scale exposed to consumers: includes the user pinch on top of
  // the auto-fit. FloorPlan's drag math divides pointer deltas by this so
  // dragging a table during edit-after-pinch (we reset on edit-enter, but
  // the multiplier matters if any other consumer reads scale).
  useImperativeHandle(ref, () => ({
    getCanvasScale: () => layout.canvasScale * (userT?.scale ?? 1),
    getZoneScale: (zoneId: string) =>
      (layout.zoneScales.get(zoneId) ?? 1) * (userT?.scale ?? 1),
    wrapEl: wrapRef.current,
    canvasEl: canvasRef.current,
  }));

  const baseTransform = layout.canvasTransform;
  const finalTransform = userT
    ? `translate(${userT.tx}px, ${userT.ty}px) scale(${userT.scale}) ${baseTransform}`
    : baseTransform;

  const innerStyle: CSSProperties = {
    ...innerStyleBase,
    width: canvasWidth,
    height: canvasHeight,
    transform: finalTransform,
    transition: liveRef.current ? 'none' : innerStyleBase.transition,
  };

  return (
    <div
      ref={wrapRef}
      style={wrapStyle}
      data-pinchable
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onClickCapture={onClickCapture}
    >
      <div ref={canvasRef} style={innerStyle} data-floor-canvas>
        {renderZones({
          zoneTransforms: layout.zoneTransforms,
          fadedZoneIds: layout.fadedZoneIds,
        })}
        {children}
      </div>
    </div>
  );
});
