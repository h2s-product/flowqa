import { useMemo } from 'react';

interface Props {
  value: unknown;
  /** Nama key yang disorot (mis. field assertion yang gagal). */
  highlightKey?: string | null;
  raw?: boolean;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Viewer JSON dengan syntax highlight ringan. */
export function JsonView({ value, highlightKey, raw }: Props) {
  const html = useMemo(() => {
    if (typeof value === 'string') return escapeHtml(value);
    const text = JSON.stringify(value, null, raw ? 0 : 2) ?? '';
    if (raw) return escapeHtml(text);
    return escapeHtml(text)
      .replace(
        /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
        (_m, str, colon, bool, num) =>
          str
            ? colon
              ? `<span class="k">${str}</span>${colon}`
              : `<span class="s">${str}</span>`
            : bool
              ? `<span class="b">${bool}</span>`
              : `<span class="n">${num}</span>`,
      )
      .split('\n')
      .map((line) =>
        highlightKey && line.includes(`"${escapeHtml(highlightKey)}"</span>:`)
          ? `<span class="hl">${line}</span>`
          : line,
      )
      .join('\n');
  }, [value, highlightKey, raw]);

  return <pre className="json" dangerouslySetInnerHTML={{ __html: html }} />;
}
