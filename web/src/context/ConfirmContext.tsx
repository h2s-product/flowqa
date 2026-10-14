import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';

export interface ConfirmOptions {
  title: string;
  /** Penjelasan dampaknya, mis. apa yang ikut terhapus / tetap tersimpan. */
  message?: ReactNode;
  /** Label tombol konfirmasi (default "Delete"). */
  confirmLabel?: string;
  /** danger = tombol merah (hapus/buang); normal = tombol biru. */
  tone?: 'danger' | 'normal';
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Popup konfirmasi seragam untuk aksi berisiko (hapus, buang). Dipakai lewat
 * `const confirm = useConfirm(); if (await confirm({ title: 'Delete …?' })) …`.
 * Tombol Cancel mendapat fokus lebih dulu supaya Enter tidak menghapus tanpa sengaja.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );
  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const danger = (options?.tone ?? 'danger') === 'danger';
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Modal
          title={
            <span className="row" style={{ gap: 8 }}>
              {danger && (
                <span className="confirm-icon" aria-hidden="true">
                  <Icon name="trash" size={16} />
                </span>
              )}
              {options.title}
            </span>
          }
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" autoFocus onClick={() => close(false)}>
                Cancel
              </button>
              <button className={`btn ${danger ? 'danger-solid' : 'primary'}`} onClick={() => close(true)}>
                {options.confirmLabel ?? 'Delete'}
              </button>
            </>
          }
        >
          {options.message ? <div className="confirm-message">{options.message}</div> : null}
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
