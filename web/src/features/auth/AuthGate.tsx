import type { ReactNode } from 'react';
import { ErrorBox, Loading } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { LoginPage } from './LoginPage';

/** Render aplikasi hanya untuk user yang sudah login; selain itu tampilkan halaman login. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (error && !user)
    return (
      <div className="auth-page">
        <div className="auth-card">
          <ErrorBox error={error} />
        </div>
      </div>
    );
  return user ? <>{children}</> : <LoginPage />;
}
