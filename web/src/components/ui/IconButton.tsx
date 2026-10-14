import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '../Icon';

/** Tombol berisi ikon saja. `label` wajib: dipakai sebagai tooltip dan nama untuk screen reader. */
export function IconButton({
  icon,
  label,
  size = 14,
  className,
  ...props
}: { icon: IconName; label: string; size?: number } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
>) {
  return (
    <button
      type="button"
      className={`icon-btn ${className ?? ''}`}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
