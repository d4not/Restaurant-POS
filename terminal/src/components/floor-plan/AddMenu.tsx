import type { CSSProperties } from 'react';
import { useEffect, useRef } from 'react';

const menu: CSSProperties = {
  position: 'absolute',
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  padding: 4,
  minWidth: 200,
  zIndex: 30,
};

const sub: CSSProperties = {
  fontSize: 10,
  color: 'var(--text3)',
  padding: '8px 12px 4px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  fontWeight: 600,
};

const item: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 12px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--text1)',
  background: 'transparent',
  border: 'none',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'inherit',
  minHeight: 38,
};

const swatch = (style: CSSProperties): CSSProperties => ({
  width: 22,
  height: 22,
  border: '1.5px solid var(--text1)',
  background: '#fff',
  flexShrink: 0,
  ...style,
});

export type AddKind =
  | 'table-rect'
  | 'table-circle'
  | 'zone'
  | 'bar-counter'
  | 'plant';

interface Props {
  // Anchor coords are page-space (clientX/clientY of the trigger button) so we
  // render via fixed positioning relative to the viewport. Saves us threading
  // canvas-scale math through the menu.
  anchorX: number;
  anchorY: number;
  canCreateZone: boolean;
  canCreateDecor: boolean;
  onSelect: (kind: AddKind) => void;
  onClose: () => void;
}

export function AddMenu({
  anchorX,
  anchorY,
  canCreateZone,
  canCreateDecor,
  onSelect,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape. Mounted in a useEffect with a small
  // setTimeout so the same click that opened the menu doesn't immediately
  // close it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{ ...menu, position: 'fixed', left: anchorX, top: anchorY }}
    >
      <div style={sub}>Table</div>
      <button type="button" style={item} onClick={() => onSelect('table-rect')}>
        <span style={swatch({})} /> Square
      </button>
      <button type="button" style={item} onClick={() => onSelect('table-circle')}>
        <span style={swatch({ borderRadius: '50%' })} /> Round
      </button>
      {(canCreateZone || canCreateDecor) && <div style={sub}>Other</div>}
      {canCreateZone && (
        <button type="button" style={item} onClick={() => onSelect('zone')}>
          <span style={swatch({ borderStyle: 'dashed' })} /> New zone
        </button>
      )}
      {canCreateDecor && (
        <>
          <button type="button" style={item} onClick={() => onSelect('bar-counter')}>
            <span
              style={swatch({
                backgroundImage:
                  'repeating-linear-gradient(45deg, var(--text1) 0 2px, transparent 2px 5px)',
              })}
            />{' '}
            Bar / counter
          </button>
          <button type="button" style={item} onClick={() => onSelect('plant')}>
            <span
              style={swatch({
                borderRadius: '50%',
                background: 'rgba(74,140,92,0.25)',
                borderColor: 'rgba(74,140,92,0.6)',
              })}
            />{' '}
            Plant
          </button>
        </>
      )}
    </div>
  );
}
