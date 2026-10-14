import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './ui';

/** Urutan modal yang sedang terbuka (paling akhir = paling atas). */
const openModals: object[] = [];

interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  tabs?: ReactNode;
}

/**
 * Dialog modal. Menutup dengan Escape atau klik di luar, memindahkan fokus ke
 * dialog saat dibuka (kecuali ada field autoFocus), dan mengembalikan fokus saat ditutup.
 */
export function Modal({ title, subtitle, onClose, footer, wide, children, tabs }: ModalProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Escape hanya menutup modal paling atas (mis. popup konfirmasi di atas form).
  useEffect(() => {
    const token = {};
    openModals.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === token) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openModals.splice(openModals.indexOf(token), 1);
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialog}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-h">
          <div className="grow">
            <h3 id={titleId}>{title}</h3>
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          <IconButton icon="x" label="Close" size={18} onClick={onClose} />
        </div>
        {tabs}
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}
