import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { IconButton } from './IconButton';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Pemisah saat mengetik / paste: koma, titik koma, spasi, baris baru. */
const SEPARATORS = /[\s,;]+/;

export const isValidEmail = (value: string) => EMAIL.test(value);

/**
 * Input banyak alamat email sebagai chip. Enter / koma / spasi / keluar dari
 * kolom menambahkan alamat; paste daftar alamat sekaligus juga bisa. Alamat
 * tidak valid ditandai merah, duplikat dibuang.
 */
export function EmailListInput({
  value,
  onChange,
  placeholder = 'name@company.com',
  max,
  label,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  /** Batas jumlah alamat (opsional). */
  max?: number;
  /** Nama untuk pembaca layar. */
  label: string;
}) {
  const [draft, setDraft] = useState('');
  const full = max !== undefined && value.length >= max;

  const add = (text: string) => {
    const known = new Set(value.map((v) => v.toLowerCase()));
    const next = [...value];
    for (const part of text.split(SEPARATORS)) {
      const email = part.trim().replace(/^<|>$/g, '').toLowerCase();
      if (!email || known.has(email) || (max !== undefined && next.length >= max)) continue;
      known.add(email);
      next.push(email);
    }
    if (next.length !== value.length) onChange(next);
    setDraft('');
  };
  const remove = (email: string) => onChange(value.filter((v) => v !== email));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', ' ', 'Tab'].includes(e.key) && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (SEPARATORS.test(text.trim())) {
      e.preventDefault();
      add(`${draft} ${text}`);
    }
  };

  const invalid = value.filter((v) => !isValidEmail(v)).length;
  return (
    <div>
      <div
        className="email-list in"
        role="group"
        aria-label={label}
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.querySelector('input')?.focus()}
      >
        {value.map((email) => {
          const ok = isValidEmail(email);
          return (
            <span
              key={email}
              className={`email-chip ${ok ? '' : 'invalid'}`}
              title={ok ? email : 'Not a valid email address'}
            >
              {email}
              <IconButton icon="x" label={`Remove ${email}`} size={11} onClick={() => remove(email)} />
            </span>
          );
        })}
        <input
          value={draft}
          aria-label={label}
          placeholder={value.length ? '' : placeholder}
          disabled={full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>
        {value.length === 1 ? '1 address' : `${value.length} addresses`}
        {max !== undefined && ` (max ${max})`}
        {invalid > 0 && (
          <span className="text-fail"> · {invalid} not valid — fix or remove the red ones</span>
        )}
      </div>
    </div>
  );
}
