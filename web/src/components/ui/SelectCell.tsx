/**
 * Sel centang untuk baris tabel yang bisa dipilih. Klik di sel tidak ikut
 * membuka baris (baris biasanya bisa diklik untuk membuka detail).
 */
export function SelectCell({
  checked,
  onChange,
  label,
  disabled,
  indeterminate,
  header,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  /** Sebagian baris terpilih (untuk centang "pilih semua"). */
  indeterminate?: boolean;
  /** Render sebagai <th> (centang "pilih semua" di kepala tabel). */
  header?: boolean;
}) {
  const Cell = header ? 'th' : 'td';
  return (
    <Cell className="select-cell" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked;
        }}
        onChange={onChange}
        aria-label={label}
      />
    </Cell>
  );
}
