// Simple inline spinner for loading states. CSS keyframes are injected once
// via a <style> tag so we don't need a global stylesheet rule for this.
const KEYFRAMES = `
@keyframes pos-spin {
  to { transform: rotate(360deg); }
}
@keyframes pos-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(1.18); }
}
`;

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  injected = true;
}

export function Spinner({ size = 18 }: { size?: number }) {
  ensureKeyframes();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid rgba(168,152,136,0.25)',
        borderTopColor: 'var(--gold)',
        animation: 'pos-spin 0.7s linear infinite',
      }}
    />
  );
}

export function PulsingDot({ color = 'var(--red)', size = 10 }: { color?: string; size?: number }) {
  ensureKeyframes();
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        animation: 'pos-pulse 1.6s ease-in-out infinite',
      }}
    />
  );
}
