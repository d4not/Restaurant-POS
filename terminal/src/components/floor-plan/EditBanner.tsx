import type { CSSProperties } from 'react';

const banner: CSSProperties = {
  position: 'absolute',
  top: 14,
  left: '50%',
  transform: 'translateX(-50%)',
  background: 'var(--text1)',
  color: '#fff',
  padding: '7px 16px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
  pointerEvents: 'none',
};

const dot: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#4a90e2',
  animation: 'fp-edit-pulse 1.4s ease-in-out infinite',
};

// Inject the keyframes once. Defined inline because the global CSS file is
// admin/terminal-shared and we don't want to leak floor-plan animations into
// every page.
let keyframesInjected = false;
function ensureKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent =
    '@keyframes fp-edit-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }';
  document.head.appendChild(style);
}

export function EditBanner() {
  if (typeof document !== 'undefined') ensureKeyframes();
  return (
    <div style={banner}>
      <span style={dot} />
      Edit mode · drag to move · corner to resize
    </div>
  );
}
