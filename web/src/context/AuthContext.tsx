/**
 * Status login. Semua halaman aplikasi hanya dirender setelah user login;
 * bila server membalas 401 (sesi habis), UI otomatis kembali ke halaman login.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { AuthStatus, AuthUser } from '@flowqa/shared';
import { UNAUTHORIZED_EVENT, http } from '@/api/client';

interface Auth {
  user: AuthUser | null;
  setupRequired: boolean;
  loading: boolean;
  error: unknown;
  login: (email: string, password: string) => Promise<void>;
  setup: (input: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);
const STATUS_KEY = ['auth', 'status'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => http.get<AuthStatus>('/auth/status'),
    staleTime: Infinity,
    retry: 1,
  });

  useEffect(() => {
    const onUnauthorized = () =>
      client.setQueryData<AuthStatus>(STATUS_KEY, (s) => ({
        setupRequired: s?.setupRequired ?? false,
        user: null,
      }));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [client]);

  const value = useMemo<Auth>(() => {
    const signedIn = (next: AuthStatus) => {
      // Buang cache milik sesi sebelumnya, lalu simpan status baru.
      // Query status auth dipertahankan karena sedang diamati oleh provider ini.
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== STATUS_KEY[0] });
      client.setQueryData(STATUS_KEY, next);
    };
    return {
      user: status.data?.user ?? null,
      setupRequired: status.data?.setupRequired ?? false,
      loading: status.isLoading,
      error: status.error,
      login: async (email, password) =>
        signedIn(await http.post<AuthStatus>('/auth/login', { email, password })),
      setup: async (input) => signedIn(await http.post<AuthStatus>('/auth/setup', input)),
      logout: async () => {
        await http.post('/auth/logout').catch(() => undefined);
        signedIn({ user: null, setupRequired: false });
      },
    };
  }, [client, status.data, status.isLoading, status.error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
