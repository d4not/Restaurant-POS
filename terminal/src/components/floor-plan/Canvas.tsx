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
  children?: ReactNode;
}

export interface CanvasHandle {
  // Scale of the *outer* canvas (only non-1 in all-zones mode, where the
  // canvas itself is scaled). In single-zone mode this is 1 — the zone scales
  // individually, ask `getZoneScale` for that one.
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
    const padding = 32;
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
    const scale = Math.min(availW / contentW, availH / contentH, 1.6);
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
  const padding = 48;
  const availW = wrapWidth - padding * 2;
  const availH = wrapHeight - padding * 2;
  const scale = Math.min(availW / target.width, availH / target.height);
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

export const FloorCanvas = forwardRef<CanvasHandle, CanvasProps>(function FloorCanvas(
  { zones, focusedZoneId, renderZones, canvasWidth, canvasHeight, children },
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

  useImperativeHandle(ref, () => ({
    getCanvasScale: () => layout.canvasScale,
    getZoneScale: (zoneId: string) => layout.zoneScales.get(zoneId) ?? 1,
    wrapEl: wrapRef.current,
    canvasEl: canvasRef.current,
  }));

  const innerStyle: CSSProperties = {
    ...innerStyleBase,
    width: canvasWidth,
    height: canvasHeight,
    transform: layout.canvasTransform,
  };

  return (
    <div ref={wrapRef} style={wrapStyle}>
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
