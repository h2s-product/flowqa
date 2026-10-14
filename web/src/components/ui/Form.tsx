import type { ReactNode } from 'react';

/** Baris form: label, kontrol, dan petunjuk opsional di bawahnya. */
/**
 * Label + isian + petunjuk. `group` merender <div role="group"> alih-alih <label>,
 * untuk isian yang berisi beberapa tombol (mis. EmailListInput) — <label> akan
 * meneruskan klik ke tombol pertama di dalamnya.
 */
export function Field({
  label,
  hint,
  children,
  group,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  group?: boolean;
}) {
  const content = (
    <>
      <span>{label}</span>
      {children}
      {hint && <em>{hint}</em>}
    </>
  );
  return group ? (
    <div className="field" role="group" aria-label={label}>
      {content}
    </div>
  ) : (
    <label className="field">{content}</label>
  );
}

/** Kotak pencarian di toolbar halaman. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  width = 340,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  width?: number;
}) {
  return (
    <input
      className="in"
      type="search"
      style={{ maxWidth: width }}
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
