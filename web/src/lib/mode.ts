/**
 * Mode Testora yang sedang dipakai: API Tester, UI Tester, atau E2E Flow.
 * Ditentukan dari URL (/ui/* = UI Tester, /e2e/* = E2E Flow). Halaman bersama (Projects,
 * Environments, Users) memakai mode terakhir yang dipilih user.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export type ProductMode = 'api' | 'ui' | 'e2e';

const STORAGE_KEY = 'flowqa.mode';
const SHARED = [/^\/projects/, /^\/environments/, /^\/users/];

/** Nama platform. */
export const PLATFORM = { name: 'Testora', tagline: 'Testing, Without the Complexity.' };

export const PRODUCTS: Record<ProductMode, { name: string; tagline: string; home: string }> = {
  api: { name: 'API Tester', tagline: 'No-code API & end-to-end testing', home: '/' },
  ui: { name: 'UI Tester', tagline: 'Record & replay web UI tests', home: '/ui/tests' },
  e2e: { name: 'E2E Flow', tagline: 'Cross-platform end-to-end flows', home: '/e2e/flows' },
};

function readStored(): ProductMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'ui' || saved === 'e2e' ? saved : 'api';
  } catch {
    return 'api';
  }
}

export function useProductMode(): ProductMode {
  const { pathname } = useLocation();
  const mode: ProductMode = pathname.startsWith('/ui')
    ? 'ui'
    : pathname.startsWith('/e2e')
      ? 'e2e'
      : SHARED.some((re) => re.test(pathname))
        ? readStored()
        : 'api';
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* storage tidak tersedia */
    }
  }, [mode]);
  return mode;
}
