import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSessionStore } from '../../store/session';

interface Props {
  children: ReactNode;
}

// Bounces to /login if there's no token in the session store. The session
// store is `persist`ed so a window reload doesn't kick a logged-in user.
export function ProtectedRoute({ children }: Props) {
  const token = useSessionStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
