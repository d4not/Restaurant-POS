import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastKind = 'info' | 'success' | 'error';

interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastApi {
  show(text: string, kind?: ToastKind): void;
  info(text: string): void;
  success(text: string): void;
  error(text: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

// Tiny singleton-by-context toast — one row stacks at the bottom of the
// viewport, auto-dismisses after 2.8s, and can be triggered from anywhere via
// useToast(). Built for the "backend rejected our optimistic tap" flow but
// usable for any transient confirmation/error message.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);
  const timeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    const t = timeoutsRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timeoutsRef.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (text: string, kind: ToastKind = 'info') => {
      const id = ++idRef.current;
      setMessages((prev) => [...prev, { id, kind, text }]);
      const t = setTimeout(() => dismiss(id), 2800);
      timeoutsRef.current.set(id, t);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      info: (text) => show(text, 'info'),
      success: (text) => show(text, 'success'),
      error: (text) => show(text, 'error'),
    }),
    [show],
  );

  useEffect(
    () => () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            role={m.kind === 'error' ? 'alert' : 'status'}
            style={{
              padding: '12px 18px',
              borderRadius: 10,
              background:
                m.kind === 'error'
                  ? 'var(--red, #c45040)'
                  : m.kind === 'success'
                  ? 'var(--green, #4a8c5c)'
                  : 'var(--text1, #2c2420)',
              color: '#fff',
              fontFamily: "'DM Sans', system-ui, sans-serif",
              fontSize: 14,
              fontWeight: 500,
              boxShadow: '0 8px 32px rgba(44,36,32,0.32)',
              pointerEvents: 'auto',
              minWidth: 220,
              maxWidth: 480,
              textAlign: 'center',
            }}
          >
            {m.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Soft fallback so a component used outside the provider doesn't crash —
    // logs to console instead. In practice the provider wraps <App /> so this
    // path only matters during tests or storybook isolation.
    return {
      show: (text, kind = 'info') => console.log(`[toast:${kind}]`, text),
      info: (text) => console.log('[toast:info]', text),
      success: (text) => console.log('[toast:success]', text),
      error: (text) => console.warn('[toast:error]', text),
    };
  }
  return ctx;
}
