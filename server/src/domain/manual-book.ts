/**
 * Manual Book: satu berkas HTML mandiri (gambar disisipkan sebagai data URI) yang
 * menjelaskan sebuah UI test case langkah demi langkah, lengkap dengan screenshot
 * dari sebuah run. Nilai rahasia sudah disamarkan oleh pemanggil (presentUiTest).
 */
import type { UiRun, UiStep, UiTestCase } from '@flowqa/shared';
import { UI_STEP_TYPES, parseSortOrder, uiRunTargetLabel } from '@flowqa/shared';

export interface ManualBookInput {
  /** Test dengan nilai sensitif sudah disamarkan. */
  test: UiTestCase;
  /** Run sumber screenshot (boleh tidak ada). */
  run?: UiRun;
  /** Screenshot run → data URI (null bila berkas tidak ada). */
  image: (file: string) => string | null;
  projectName: string;
  folderPath: string;
  generatedAt: Date;
}

const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const dateTime = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' WIB'
    : '-';

const STATUS_ID: Record<string, string> = {
  passed: 'Lulus',
  failed: 'Gagal',
  error: 'Error',
  stopped: 'Dihentikan',
  running: 'Berjalan',
  queued: 'Menunggu',
  skipped: 'Dilewati',
};

const DIRECTIONS: Record<string, string> = { up: 'atas', down: 'bawah', left: 'kiri', right: 'kanan' };

/** Kalimat petunjuk untuk satu langkah (Bahasa Indonesia). */
export function actionText(step: UiStep, mobile: boolean): string {
  const v = step.value ?? '';
  const q = (s: string) => `“${s}”`;
  const tap = mobile ? 'Tap' : 'Klik';
  switch (step.type) {
    case 'navigate':
      return mobile ? `Buka tautan ${q(v)}` : `Buka halaman ${q(v)}`;
    case 'click':
      return `${tap} elemen yang dimaksud`;
    case 'fill':
      return v ? `Isi kolom dengan ${q(v)}` : 'Kosongkan kolom';
    case 'select':
      return `Pilih ${q(v)}`;
    case 'check':
      return 'Centang kotak';
    case 'uncheck':
      return 'Hapus centang kotak';
    case 'press':
      return `Tekan tombol keyboard ${q(v || 'Enter')}`;
    case 'wait':
      return `Tunggu ${Number(v) ? `${Number(v) / 1000} detik` : 'sebentar'}`;
    case 'assertText':
      return `Pastikan teks ${q(v)} tampil`;
    case 'assertVisible':
      return 'Pastikan elemen tampil di layar';
    case 'assertNotVisible':
      return 'Pastikan elemen tidak tampil di layar';
    case 'assertUrl':
      return `Pastikan alamat halaman berisi ${q(v)}`;
    case 'assertEach':
      return `Pastikan setiap baris berisi ${q(v)}`;
    case 'assertSorted':
      return `Pastikan daftar terurut ${parseSortOrder(v) === 'descending' ? 'dari yang terbesar / terbaru' : 'dari yang terkecil / terdekat'}`;
    case 'pickOption': {
      const p = step.pick;
      const which =
        p?.mode === 'named'
          ? `opsi ${q(p.text)}`
          : p?.mode === 'first'
            ? 'opsi pertama yang tersedia'
            : 'salah satu opsi yang belum dipakai';
      return `Pilih ${which}${p?.saveAs ? `, catat sebagai {{${p.saveAs}}}` : ''}`;
    }
    case 'setVariable':
      return `Siapkan data {{${step.saveAs ?? ''}}} = ${q(v)}`;
    case 'saveText':
      return `Catat teks elemen sebagai {{${step.saveAs ?? ''}}}${step.unique ? ' (pilih yang belum pernah dites)' : ''}`;
    case 'uploadFile':
      return `Unggah berkas${v ? ` ${q(v)}` : ''}`;
    case 'assertColor':
      return `Pastikan warna elemen ${q(v)}`;
    case 'apiScenario':
      return 'Jalankan API scenario terkait';
    case 'longPress':
      return 'Tekan lama elemen';
    case 'swipe':
      return `Geser layar ke ${DIRECTIONS[v] ?? (v || 'atas')}`;
    case 'scrollTo':
      return 'Gulir sampai elemen terlihat';
    case 'back':
      return 'Tekan tombol Back';
    case 'pressKey':
      return `Tekan tombol ${q(v || 'ENTER')}`;
    case 'clearText':
      return 'Kosongkan kolom';
    case 'hideKeyboard':
      return 'Tutup keyboard';
    case 'launchApp':
      return 'Buka aplikasi';
    case 'closeApp':
      return 'Tutup aplikasi';
    case 'restartApp':
      return 'Buka ulang aplikasi';
    case 'installApk':
      return `Pasang aplikasi${v ? ` ${q(v)}` : ''}`;
    case 'assertAttribute':
      return `Pastikan ${step.attribute ?? 'atribut'} = ${q(v)}`;
    case 'takeScreenshot':
      return 'Ambil screenshot';
    case 'pageSource':
      return 'Simpan struktur layar (page source)';
    case 'drawPolygon':
      return `Gambar area di peta (${v || 4} titik)`;
  }
}

const isCheck = (step: UiStep) => step.type.startsWith('assert');

/** Variabel {{nama}} yang dipakai langkah-langkah test. */
function variablesUsed(test: UiTestCase): { name: string; source: string }[] {
  const made = new Map<string, string>();
  for (const s of test.steps) {
    if ((s.type === 'setVariable' || s.type === 'saveText') && s.saveAs)
      made.set(s.saveAs, 'dibuat saat test berjalan');
    if (s.pick?.saveAs) made.set(s.pick.saveAs, 'dibuat saat test berjalan');
  }
  const all = new Set<string>();
  const text = JSON.stringify([test.startUrl, test.steps.map((s) => [s.value, s.selectors, s.pick?.text])]);
  for (const m of text.matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) all.add(m[1]);
  return [...all].map((name) => ({
    name,
    source:
      made.get(name) ??
      (/^random_|^timestamp$|^uuid$/.test(name)
        ? 'nilai acak otomatis'
        : 'dari environment / langkah sebelumnya'),
  }));
}

export function manualBookFileName(test: UiTestCase): string {
  const base = `${test.code ? `${test.code} - ` : ''}${test.name}`.replace(/[\\/:*?"<>|]+/g, '-').trim();
  return `Manual Book - ${base}.html`;
}

export function renderManualBook(input: ManualBookInput): string {
  const { test, run } = input;
  const mobile = test.target === 'mobile';
  const typeLabel = (step: UiStep) => {
    const info = UI_STEP_TYPES.find((t) => t.id === step.type);
    return (mobile && info?.mobileLabel) || info?.label || step.type;
  };
  const results = new Map((run?.steps ?? []).map((r) => [r.stepId, r]));
  const shots = test.steps.map((s) => {
    const file = results.get(s.id)?.screenshot;
    return file ? input.image(file) : null;
  });
  const withShots = shots.filter(Boolean).length;
  const vars = variablesUsed(test);
  const platform = mobile
    ? `Android · ${esc(test.mobile?.appPackage || test.mobile?.app || '-')}`
    : `Web · ${esc(test.startUrl || '-')}`;

  const stepHtml = test.steps
    .map((step, i) => {
      const n = i + 1;
      const notes: string[] = [];
      if (step.disabled) notes.push('Langkah ini dinonaktifkan (tidak dijalankan).');
      if (step.sensitive) notes.push('Nilai rahasia disamarkan.');
      if (step.onFailPass)
        notes.push('Bila kondisi ini tidak terpenuhi, pengujian selesai dan dianggap lulus.');
      if (step.onFailSkip)
        notes.push(
          `Bila kondisi ini tidak terpenuhi, ${step.onFailSkip} langkah berikutnya dilewati dan pengujian berlanjut.`,
        );
      if (step.retryFrom) {
        const target = test.steps.findIndex((s) => s.id === step.retryFrom);
        notes.push(`Bila gagal, ulangi dari langkah ${target + 1} (maks. ${step.retryMax ?? 3} kali).`);
      }
      const shot = shots[i];
      return `
    <section class="step${isCheck(step) ? ' check' : ''}${step.disabled ? ' off' : ''}" id="step-${n}">
      <div class="num">${n}</div>
      <div class="body">
        <h3>${esc(step.description)}</h3>
        <p class="action"><span class="tag">${esc(typeLabel(step))}</span> ${esc(actionText(step, mobile))}</p>
        ${isCheck(step) ? `<p class="expect"><b>Hasil yang diharapkan:</b> ${esc(actionText(step, mobile).replace(/^Pastikan /, ''))}.</p>` : ''}
        ${notes.map((t) => `<p class="note">${esc(t)}</p>`).join('')}
        ${
          shot
            ? `<figure><img src="${shot}" alt="Screenshot langkah ${n}" loading="lazy"><figcaption>Screenshot langkah ${n}</figcaption></figure>`
            : step.type === 'setVariable' || step.type === 'wait' || step.type === 'apiScenario'
              ? ''
              : '<p class="noshot">Belum ada screenshot untuk langkah ini.</p>'
        }
        ${
          step.selectors.length
            ? `<details><summary>Detail teknis (selector)</summary><ul>${step.selectors
                .map((s) => `<li><code>${esc(s)}</code></li>`)
                .join('')}</ul></details>`
            : ''
        }
      </div>
    </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Manual Book · ${esc(test.code ?? '')} ${esc(test.name)}</title>
<style>
  :root { --ink:#1f2433; --muted:#6b7280; --line:#e5e7eb; --brand:#3b4cca; --check:#0f7a4a; --bg:#f7f8fb; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:var(--ink); background:var(--bg); }
  main { max-width: 980px; margin: 0 auto; padding: 32px 20px 64px; }
  header { background:#fff; border:1px solid var(--line); border-radius:14px; padding:24px 28px; margin-bottom:20px; }
  .code { display:inline-block; font:600 12px/1 ui-monospace, monospace; background:#eef0ff; color:var(--brand); padding:5px 8px; border-radius:6px; letter-spacing:.03em; }
  h1 { margin:10px 0 6px; font-size:26px; line-height:1.25; }
  .desc { color:var(--muted); margin:0 0 14px; white-space:pre-wrap; }
  dl { display:grid; grid-template-columns: max-content 1fr; gap:6px 16px; margin:0; font-size:14px; }
  dt { color:var(--muted); } dd { margin:0; word-break:break-word; }
  .box { background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px 24px; margin-bottom:20px; }
  .box h2 { font-size:16px; margin:0 0 10px; }
  .toc { columns: 2; column-gap: 28px; margin:0; padding-left: 20px; font-size:14px; }
  .toc a { color:var(--ink); text-decoration:none; } .toc a:hover { color:var(--brand); }
  table { border-collapse: collapse; width:100%; font-size:14px; } td, th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  .step { display:flex; gap:16px; background:#fff; border:1px solid var(--line); border-radius:14px; padding:18px 20px; margin-bottom:14px; page-break-inside: avoid; }
  .step.check { border-left:4px solid var(--check); } .step.off { opacity:.55; }
  .num { flex:0 0 34px; height:34px; border-radius:50%; background:var(--brand); color:#fff; font-weight:700; display:flex; align-items:center; justify-content:center; }
  .step.check .num { background: var(--check); }
  .body { flex:1; min-width:0; } h3 { margin:4px 0 6px; font-size:16px; }
  .action { margin:0 0 6px; } .tag { font:600 11px/1 system-ui; text-transform:uppercase; letter-spacing:.04em; background:#f1f2f6; color:var(--muted); padding:4px 6px; border-radius:5px; margin-right:6px; }
  .expect { margin:6px 0; color:var(--check); } .note { margin:4px 0; font-size:13px; color:#8a5a00; }
  figure { margin:12px 0 4px; } img { max-width:100%; max-height:620px; border:1px solid var(--line); border-radius:10px; display:block; }
  figcaption, .noshot { font-size:12px; color:var(--muted); margin-top:4px; }
  details { margin-top:8px; font-size:12px; color:var(--muted); } code { font-size:12px; word-break:break-all; }
  footer { color:var(--muted); font-size:12px; text-align:center; margin-top:28px; }
  @media print { body { background:#fff; } main { padding:0; } .box, header, .step { border-color:#ccc; } details { display:none; } }
  @media (max-width: 640px) { .toc { columns:1; } .step { flex-direction:column; } }
</style>
</head>
<body>
<main>
  <header>
    ${test.code ? `<span class="code">${esc(test.code)}</span>` : ''}
    <h1>${esc(test.name)}</h1>
    ${test.description ? `<p class="desc">${esc(test.description)}</p>` : ''}
    <dl>
      <dt>Project</dt><dd>${esc(input.projectName)}</dd>
      <dt>Folder</dt><dd>${esc(input.folderPath || '-')}</dd>
      <dt>Platform</dt><dd>${platform}</dd>
      <dt>Jumlah langkah</dt><dd>${test.steps.length} langkah (${test.steps.filter(isCheck).length} pengecekan)</dd>
      <dt>Sumber screenshot</dt><dd>${
        run
          ? `Run ${esc(dateTime(run.startedAt))} · ${esc(STATUS_ID[run.status] ?? run.status)} · ${esc(uiRunTargetLabel(run))} · ${withShots} screenshot`
          : 'Belum ada run — jalankan test sekali untuk menyertakan screenshot'
      }</dd>
      <dt>Dibuat</dt><dd>${esc(dateTime(input.generatedAt))}</dd>
    </dl>
  </header>
  ${
    vars.length
      ? `<div class="box"><h2>Data uji &amp; variabel</h2><table><tr><th>Variabel</th><th>Sumber</th></tr>${vars
          .map((v) => `<tr><td><code>{{${esc(v.name)}}}</code></td><td>${esc(v.source)}</td></tr>`)
          .join('')}</table></div>`
      : ''
  }
  <div class="box"><h2>Daftar langkah</h2><ol class="toc">${test.steps
    .map((s, i) => `<li><a href="#step-${i + 1}">${esc(s.description)}</a></li>`)
    .join('')}</ol></div>
  ${stepHtml}
  <footer>Manual Book dibuat otomatis oleh Testora · ${esc(test.code ?? '')} · ${esc(dateTime(input.generatedAt))}</footer>
</main>
</body>
</html>
`;
}
