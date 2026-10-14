import type { ReactNode } from 'react';

/**
 * Saklar on/off. Beri `children` sebagai teks label (seluruh baris bisa diklik),
 * atau `label` untuk nama yang hanya dibaca screen reader. Jangan membungkus
 * Toggle dengan <label> lain.
 */
export function Toggle({
  checked,
  onChange,
  label,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const control = (
    <span className="toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={children ? undefined : label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span />
    </span>
  );
  return (
    <label className={children ? 'toggle-row' : 'toggle-only'}>
      {control}
      {children}
    </label>
  );
}
