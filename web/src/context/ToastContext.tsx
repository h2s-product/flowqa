import { useEffect, useRef, useState, type ReactNode } from 'react';
import { showToast, subscribeToast } from '@/lib/toast';

const TOAST_MS = 2800;

/** Menampilkan satu toast sekaligus; toast baru menggantikan yang lama dan memulai ulang timer. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<number>();
  const counter = useRef(0);

  useEffect(
    () =>
      subscribeToast((message) => {
        window.clearTimeout(timer.current);
        setToast({ id: ++counter.current, message });
        timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
      }),
    [],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <>
      {children}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.message}
        </div>
      )}
    </>
  );
}

export const useToast = () => showToast;
