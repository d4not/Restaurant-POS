import type { CSSProperties } from 'react';

const toolbar: CSSProperties = {
  position: 'absolute',
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 10,
  boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
  display: 'flex',
  alignItems: 'center',
  padding: 4,
  gap: 2,
  zIndex: 18,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const btn: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
  color: 'var(--text1)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 30,
};

const dangerBtn: CSSProperties = { ...btn, color: 'var(--red)' };

const sep: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  background: 'var(--border)',
  margin: '4px 2px',
};

export interface ToolbarAction {
  key: string;
  icon: string;
  label?: string;
  danger?: boolean;
  onClick: () => void;
  hidden?: boolean;
}

interface Props {
  // Anchor point — caller computes element-relative pixel coords inside the
  // canvas inner container and we render at top: anchorY - height - 8.
  anchorX: number;
  anchorY: number;
  title: string;
  actions: ToolbarAction[];
}

export function FloatingToolbar({ anchorX, anchorY, title, actions }: Props) {
  return (
    <div
      style={{ ...toolbar, left: anchorX, top: anchorY }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        style={{
          ...btn,
          fontWeight: 600,
          cursor: 'default',
          color: 'var(--text2)',
        }}
      >
        {title}
      </span>
      <div style={sep} />
      {actions
        .filter((a) => !a.hidden)
        .map((a, idx, arr) => {
          const isLast = idx === arr.length - 1;
          const prevWasDanger = idx > 0 && arr[idx - 1].danger === false && a.danger;
          return (
            <span key={a.key} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {prevWasDanger && <div style={sep} />}
              <button
                type="button"
                style={a.danger ? dangerBtn : btn}
                onClick={a.onClick}
                title={a.label}
              >
                <span aria-hidden>{a.icon}</span>
                {a.label && <span>{a.label}</span>}
              </button>
              {!isLast && idx === 0 && <div style={sep} />}
            </span>
          );
        })}
    </div>
  );
}
