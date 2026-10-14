import type { ReactNode } from 'react';

/** Keadaan kosong: judul, penjelasan singkat, dan aksi opsional. */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export const Loading = () => (
  <div className="page-loading" role="status">
    Loading…
  </div>
);

/** Kotak error. Menerima Error, pesan string, atau nilai apa pun (pesan umum). */
export function ErrorBox({ error, children }: { error?: unknown; children?: ReactNode }) {
  const message =
    children ??
    (typeof error === 'string' ? error : error instanceof Error ? error.message : 'Something went wrong');
  return (
    <div className="error-box" role="alert">
      {message}
    </div>
  );
}
