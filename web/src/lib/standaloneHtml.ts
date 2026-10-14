/**
 * Mengubah sebagian halaman (mis. Reports) menjadi file HTML mandiri yang
 * tampil persis seperti di aplikasi: DOM yang sedang tampil + seluruh CSS
 * aplikasi, tema terang, tanpa script. Bisa dibuka di browser mana pun tanpa login.
 */

/** Semua CSS aplikasi sebagai teks; stylesheet lintas-origin (mis. Google Fonts) dijadikan <link>. */
function collectStyles(): { css: string; links: string[] } {
  let css = '';
  const links: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css += `${Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join('\n')}\n`;
    } catch {
      if (sheet.href) links.push(sheet.href);
    }
  }
  return { css, links };
}

/** Aturan tambahan untuk file ekspor: seperti mode cetak (kop tampil, filter & tombol aksi disembunyikan). */
const EXPORT_CSS = `
body { background: var(--bg); margin: 0; }
.export-page { max-width: 1200px; margin: 0 auto; padding: 28px 24px 40px; }
.no-print { display: none !important; }
.print-only { display: block !important; }
button { cursor: default; }
.export-foot { margin-top: 24px; color: var(--ink3); font-size: 12px; text-align: center; }
`;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function standaloneHtml(root: HTMLElement, options: { title: string; footer?: string }): string {
  const clone = root.cloneNode(true) as HTMLElement;
  // Tautan relatif (mis. "Open last run") diarahkan ke alamat Testora.
  clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    a.setAttribute('href', new URL(a.getAttribute('href')!, window.location.origin).href);
    a.setAttribute('target', '_blank');
  });
  clone.querySelectorAll('script, input, select, textarea').forEach((el) => el.remove());
  clone.querySelectorAll('[aria-expanded]').forEach((el) => el.removeAttribute('aria-expanded'));

  const { css, links } = collectStyles();
  const fonts = links.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('\n');
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Testora">
<title>${escapeHtml(options.title)}</title>
${fonts}
<style>${css}${EXPORT_CSS}</style>
</head>
<body>
<div class="export-page">
${clone.outerHTML}
${options.footer ? `<div class="export-foot">${escapeHtml(options.footer)}</div>` : ''}
</div>
</body>
</html>`;
}

/** Unduh teks sebagai file. */
export function downloadFile(content: string, fileName: string, type = 'text/html;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
