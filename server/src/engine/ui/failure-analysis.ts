/**
 * Analisa kegagalan step UI test: dari pesan error teknis (termasuk call log
 * Playwright) + bukti dari halaman saat gagal, susun penjelasan berbahasa jelas —
 * apa yang terjadi, kemungkinan penyebab (urut dari yang paling mungkin), sumber
 * masalah yang paling mungkin (aplikasi / skrip test / environment / data uji),
 * dan langkah perbaikan.
 */
import type { Page } from 'playwright-core';
import type {
  UiFailureAnalysis,
  UiFailureEvidence,
  UiFailureKind,
  UiFailureSource,
  UiStep,
} from '@flowqa/shared';

export interface FailureContext {
  step: UiStep;
  /** Nomor step (0-based). */
  index: number;
  /** Pesan error lengkap (boleh berisi call log Playwright beberapa baris). */
  error: string;
  target: 'web' | 'mobile';
  /** Selector & nilai step setelah {{variabel}} diganti (bila bisa). */
  selectors?: string[];
  value?: string;
  evidence?: UiFailureEvidence;
  /** Step sebelumnya (maks. 3 terdekat) yang dilewati karena kondisi / dimatikan. */
  skippedBefore?: { index: number; description: string; reason: string }[];
  /** Jumlah pengulangan (retry) yang sudah dicoba sebelum dinyatakan gagal. */
  retries?: number;
}

/** Kata kerja per jenis step, untuk kalimat "Testora tidak dapat …". */
const ACTION: Partial<Record<UiStep['type'], string>> = {
  navigate: 'membuka halaman',
  click: 'mengklik elemen',
  fill: 'mengisi kolom',
  select: 'memilih opsi',
  check: 'mencentang checkbox',
  uncheck: 'menghapus centang checkbox',
  press: 'menekan tombol keyboard pada elemen',
  pickOption: 'memilih opsi',
  uploadFile: 'mengunggah berkas',
  saveText: 'menyimpan teks elemen',
  assertVisible: 'memastikan elemen tampil',
  assertText: 'memastikan teks elemen',
  longPress: 'menekan lama elemen',
  scrollTo: 'menggulir ke elemen',
  clearText: 'mengosongkan kolom',
};

/** Kutip teks dengan “…” (aman bila teksnya sendiri berisi tanda kutip). */
const quote = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return `“${t.length > max ? `${t.slice(0, max)}…` : t}”`;
};

/**
 * Step sebelumnya yang dilewati karena kondisi ("Bila gagal, lewati N step") / dimatikan
 * → satu kalimat sebab-akibat. `targetHidden`: elemen yang dituju ada tetapi tidak terlihat,
 * tanda bahwa step pembuka yang dilewati itu sebenarnya dibutuhkan.
 */
function describeSkipped(
  list: { index: number; description: string; reason: string }[],
  targetHidden: boolean,
): string | undefined {
  const bySkip = list.filter((s) => /^Not needed: the condition of step \d+/.test(s.reason));
  const condition = list.find((s) => /^Condition not met/.test(s.reason));
  const off = list.filter((s) => /^Step is turned off/.test(s.reason));
  if (bySkip.length) {
    const condNo = Number(/condition of step (\d+)/.exec(bySkip[0].reason)?.[1]);
    const condDesc = condition?.index === condNo - 1 ? ` (${quote(condition.description, 70)})` : '';
    const judged = condition
      ? /still shown/.test(condition.reason)
        ? ' menilai elemennya sudah tampil'
        : ' tidak terpenuhi'
      : ' tidak terpenuhi';
    return (
      `${bySkip.map((s) => `Step ${s.index + 1} (${quote(s.description, 70)})`).join(', ')} tidak dijalankan karena kondisi di step ${condNo}${condDesc}${judged}.` +
      (targetHidden
        ? ' Padahal saat gagal elemen yang dituju tidak terlihat — kemungkinan besar step yang dilewati itulah yang seharusnya membukanya, sehingga kondisi tersebut keliru menilai keadaan halaman.'
        : ' Bila step tersebut sebenarnya dibutuhkan agar step ini berhasil, periksa kembali kondisinya.')
    );
  }
  if (off.length)
    return `${off.map((s) => `Step ${s.index + 1} (${quote(s.description, 70)})`).join(', ')} sedang dimatikan, padahal mungkin dibutuhkan sebelum step ini.`;
  return undefined;
}

/** Petunjuk dari call log Playwright (baris "- …" di bawah pesan timeout). */
function playwrightHints(error: string) {
  const log = error.toLowerCase();
  return {
    blockedBy: /<([^>]{1,80})>[^\n]*intercepts pointer events/i.exec(error)?.[1],
    notVisible: /element is not visible|waiting for [^\n]* to be visible/.test(log),
    outsideViewport: /outside of the viewport/.test(log),
    notEnabled: /element is not enabled|element is disabled|not editable/.test(log),
    notStable: /element is not stable/.test(log),
    strict: /strict mode violation/.test(log),
    navigationTimeout: /page\.goto|navigating to/.test(log),
  };
}

/** Tentukan jenis kegagalan dari pesan error. */
export function classifyUiFailure(error: string, step: UiStep): UiFailureKind {
  const e = error;
  if (/^Unknown variable \{\{/m.test(e)) return 'missing-variable';
  if (/API scenario/i.test(e) && step.type === 'apiScenario') return 'api-scenario';
  if (
    /This step has no element selector|Give the (variable|value) a name|^Enter the |Choose a color|is not a full http|is not a deep link|is not a direction|Set the app package|Enter the APK|Choose the attribute|steps are not available in mobile tests/m.test(
      e,
    )
  )
    return 'step-config';
  if (
    /Appium session ended|invalid session id|has been closed|Target closed|browser has disconnected/i.test(e)
  )
    return 'session-lost';
  if (/net::ERR_|Could not open the page|ERR_NAME_NOT_RESOLVED|ECONNREFUSED/i.test(e))
    return 'page-unreachable';
  if (/^Expected text ".*", but the element shows/m.test(e)) return 'text-mismatch';
  if (/rows do not contain/.test(e)) return 'rows-mismatch';
  if (/^No rows were shown|^No dates or numbers were shown/m.test(e)) return 'no-rows';
  if (/^Not (ascending|descending)/m.test(e)) return 'not-sorted';
  if (/still shown/.test(e)) return 'still-shown';
  if (/^Expected the page URL to contain/m.test(e)) return 'url-mismatch';
  if (
    /does not match|has no text to save|matching values were already used|^Expected \w+, but the text is/m.test(
      e,
    )
  )
    return 'value-mismatch';
  if (
    /No option named|no options appeared|No visible options|options are already selected|did not accept it/.test(
      e,
    )
  )
    return 'option-missing';
  if (/exists but is not visible/.test(e)) return 'element-hidden';
  if (/Could not find the element|did not appear after scrolling|No file field found/.test(e))
    return 'element-not-found';
  const hints = playwrightHints(e);
  if (hints.blockedBy) return 'element-blocked';
  if (hints.notEnabled) return 'element-disabled';
  if (hints.notVisible || hints.outsideViewport) return 'element-hidden';
  if (/Timeout \d+ms exceeded|did not respond in time/i.test(e))
    return step.type === 'navigate' || hints.navigationTimeout ? 'page-timeout' : 'element-hidden';
  return 'unknown';
}

/** Analisa lengkap satu step gagal. */
export function analyzeUiFailure(ctx: FailureContext): UiFailureAnalysis {
  const { step, error } = ctx;
  const ev = ctx.evidence ?? {};
  let kind = classifyUiFailure(error, step);
  const hints = playwrightHints(error);
  const where = ctx.target === 'mobile' ? 'layar aplikasi' : 'halaman';
  const name = quote(step.description || step.type, 80);
  const action = ACTION[step.type] ?? 'menjalankan step';
  const firstLine = error.split('\n')[0];
  const sel = ev.selectors ?? [];
  const anyMatch = sel.some((s) => s.count > 0);
  const anyVisible = sel.some((s) => s.visible > 0);
  // Bukti halaman bisa memperjelas jenisnya: elemen ada tapi tak terlihat ≠ elemen tidak ada.
  // Elemen yang terpotong pembungkusnya (menu tertutup) membuat Playwright melapor
  // "<x> intercepts pointer events" — padahal elemennya sendiri yang tidak terlihat.
  if ((kind === 'element-not-found' || kind === 'element-blocked') && anyMatch && !anyVisible)
    kind = 'element-hidden';
  if (kind === 'element-hidden' && sel.length && !anyMatch) kind = 'element-not-found';

  const causes: string[] = [];
  const suggestions: string[] = [];
  let likely: UiFailureSource = 'unclear';
  let title = '';
  let summary = '';

  // ---- penyebab berbasis bukti (paling meyakinkan) ditaruh di depan ----
  const appMessages = (ev.messages ?? []).filter(Boolean);
  if (appMessages.length) {
    causes.push(
      `${where[0].toUpperCase()}${where.slice(1)} menampilkan pesan dari aplikasi: ${appMessages
        .slice(0, 2)
        .map((m) => quote(m, 140))
        .join(
          ' dan ',
        )}. Kegagalan ini kemungkinan besar berasal dari aplikasi (error / data tidak tersedia), bukan dari skrip test.`,
    );
  }
  if (ev.loginPage && step.type !== 'fill') {
    causes.push(
      'Yang tampil justru halaman login — sesi kemungkinan habis, login di awal test gagal, atau halaman ini butuh hak akses yang tidak dimiliki akun uji.',
    );
  }
  if (ev.loading) {
    causes.push(
      'Saat batas waktu habis, halaman masih menampilkan indikator memuat (spinner / skeleton / "Memuat…") — server merespons lambat sehingga elemen belum sempat muncul.',
    );
  }
  const skipped = describeSkipped(ctx.skippedBefore ?? [], anyMatch && !anyVisible);
  if (skipped) causes.push(skipped);

  const selectorList = (ctx.selectors ?? step.selectors).slice(0, 3);
  const selectorEvidence = sel.length
    ? ` Hasil pengecekan selector saat gagal: ${sel
        .map((s) => `${s.selector} → ${s.count} cocok, ${s.visible} terlihat`)
        .join('; ')}.`
    : '';

  switch (kind) {
    case 'missing-variable': {
      const vars = /Unknown variable ([^.]*)\./.exec(error)?.[1] ?? 'yang dipakai step ini';
      likely = 'test-script';
      title = `Variabel ${vars} belum punya nilai`;
      summary = `Step ${name} memakai variabel ${vars}, tetapi variabel itu belum terisi saat step dijalankan, sehingga Testora tidak tahu nilai apa yang harus dipakai.`;
      causes.push(
        'Step yang seharusnya mengisi variabel ini (Save element text / Set a value / Pick an option / API scenario) tidak berjalan, dilewati karena kondisi, atau memakai nama variabel yang berbeda.',
        'Variabel ini seharusnya berasal dari environment, tetapi belum ditambahkan di environment yang dipilih saat run.',
      );
      suggestions.push(
        'Pastikan ada step sebelumnya yang menyimpan variabel ini dan namanya sama persis (huruf besar/kecil berpengaruh).',
        'Atau tambahkan variabel ini di menu Environments untuk environment yang dipakai.',
      );
      break;
    }
    case 'step-config':
      likely = 'test-script';
      title = `Pengaturan step ${name} belum lengkap`;
      summary = `Step tidak bisa dijalankan karena isiannya belum lengkap atau tidak valid: ${quote(firstLine, 160)}.`;
      causes.push(
        'Ada isian wajib step yang kosong atau formatnya salah (selector, nilai, nama variabel, URL, dll.).',
      );
      suggestions.push(
        'Buka test di editor, lengkapi isian step ini sesuai pesan di atas, lalu jalankan ulang.',
      );
      break;
    case 'session-lost':
      likely = 'environment';
      title =
        ctx.target === 'mobile'
          ? 'Sesi aplikasi / perangkat terputus'
          : 'Browser tertutup saat test berjalan';
      summary =
        ctx.target === 'mobile'
          ? 'Sesi Appium berakhir di tengah test: aplikasi tertutup paksa (crash) atau perangkat terputus.'
          : 'Browser atau tab tertutup sebelum step selesai, sehingga step tidak bisa dilanjutkan.';
      causes.push(
        ctx.target === 'mobile'
          ? 'Aplikasi crash saat step ini dijalankan — cek ADB log (logcat) di bagian Artifacts untuk stack trace-nya; bila ada, ini bug aplikasi.'
          : 'Proses Chrome berhenti (kehabisan memori / ditutup manual) atau run dihentikan.',
        'Perangkat / emulator terputus atau restart.',
      );
      suggestions.push(
        'Jalankan ulang test. Bila berulang di step yang sama, laporkan sebagai crash dengan melampirkan log dari Artifacts.',
      );
      break;
    case 'page-unreachable':
      likely = 'environment';
      title = 'Halaman tidak bisa dibuka';
      summary = `Testora gagal membuka ${quote(ctx.value || step.value || '', 120)}: ${quote(firstLine, 160)}.`;
      causes.push(
        'Server aplikasi sedang mati / tidak bisa dijangkau dari komputer yang menjalankan Testora (jaringan, VPN, DNS).',
        'Alamat (URL) di environment salah atau berubah.',
      );
      suggestions.push(
        'Coba buka alamat tersebut di browser biasa dari komputer yang sama.',
        'Periksa variabel URL (mis. {{WEB_URL}}) di environment yang dipilih.',
      );
      break;
    case 'page-timeout':
      likely = 'environment';
      title = 'Halaman terlalu lama dimuat';
      summary = `Halaman tidak selesai dimuat dalam batas waktu step (${quote(firstLine, 120)}).`;
      causes.push(
        'Server aplikasi lambat atau sedang sibuk (mis. banyak test berjalan bersamaan).',
        'Koneksi jaringan ke server lambat / tidak stabil.',
      );
      suggestions.push(
        'Jalankan ulang test; bila hanya sesekali, naikkan "Timeout" step ini atau tambahkan pengulangan ("Bila gagal, ulangi dari step").',
        'Bila selalu lambat di halaman yang sama, laporkan ke tim pengembang sebagai masalah performa.',
      );
      break;
    case 'element-not-found':
      likely = appMessages.length || ev.loginPage ? 'application' : 'test-script';
      title = `Elemen untuk step ${name} tidak ditemukan`;
      summary = `Testora tidak dapat ${action} karena tidak ada elemen di ${where} yang cocok dengan selector step ini${ev.url ? ` (halaman saat itu: ${ev.url})` : ''}.${selectorEvidence}`;
      if (!appMessages.length && !ev.loginPage && !ev.loading)
        causes.push(
          'Tampilan aplikasi berubah (label, teks tombol, id, atau struktur halaman) sehingga selector lama tidak cocok lagi.',
          'Step sebelumnya belum membawa ke halaman / kondisi yang tepat (mis. menu belum dibuka, tab belum dipilih, data belum dimuat).',
          'Elemen bergantung pada data (mis. baris tertentu) yang tidak ada pada data uji saat ini.',
        );
      suggestions.push(
        'Bandingkan screenshot step ini dengan tampilan yang diharapkan.',
        'Bila tampilan memang berubah: perbarui selector step (rekam ulang langkah ini atau pilih elemen lewat editor).',
        'Bila tampilan benar tetapi elemen memang hilang: laporkan sebagai bug aplikasi.',
      );
      break;
    case 'element-hidden':
      likely = appMessages.length ? 'application' : 'test-script';
      title = `Elemen untuk step ${name} ada, tetapi tidak dapat dijangkau`;
      summary = `Elemen yang dituju ditemukan di ${where}, tetapi dalam keadaan tersembunyi${
        hints.outsideViewport ? ' / berada di luar area layar' : ''
      }, sehingga Testora tidak dapat ${action} sampai batas waktu habis.${selectorEvidence}`;
      causes.push(
        'Elemen berada di dalam bagian yang masih tertutup (menu / grup sidebar yang belum dibuka, dropdown, accordion, tab lain, atau dialog yang belum muncul) — elemennya ada di halaman tetapi terpotong / tidak terlihat.',
        'Selector cocok dengan elemen lain yang sedang tersembunyi (mis. elemen versi mobile / duplikat), bukan elemen yang terlihat.',
      );
      suggestions.push(
        'Lihat screenshot: bila bagian yang menampung elemen masih tertutup, tambahkan / perbaiki step yang membukanya terlebih dahulu.',
        'Bila step pembukanya memakai kondisi ("Bila gagal, lewati N step"), pastikan kondisi tersebut mendeteksi keadaan terbuka/tertutup dengan benar.',
        'Persempit selector agar hanya menunjuk elemen yang terlihat.',
      );
      break;
    case 'element-blocked':
      likely = 'test-script';
      title = `Elemen untuk step ${name} tertutup elemen lain`;
      summary = `Elemen ditemukan dan terlihat, tetapi klik tertahan karena ada elemen lain di atasnya${
        hints.blockedBy ? ` (<${hints.blockedBy.split(' ')[0]}…>)` : ''
      }.`;
      causes.push(
        'Ada dialog / popup / overlay / toast yang masih terbuka dan menutupi elemen.',
        'Halaman masih dalam animasi atau loading overlay saat step dijalankan.',
      );
      suggestions.push(
        'Tambahkan step untuk menutup dialog / popup terlebih dahulu, atau tunggu sampai loading selesai (Check element is not visible pada overlay).',
        'Bila overlay muncul tanpa alasan (mis. pesan error), periksa pesannya — bisa jadi bug aplikasi.',
      );
      break;
    case 'element-disabled':
      likely = 'test-data';
      title = `Elemen untuk step ${name} dalam keadaan nonaktif`;
      summary = `Elemen ditemukan, tetapi nonaktif (disabled / read-only) sehingga tidak dapat diisi atau diklik.`;
      causes.push(
        'Isian wajib sebelumnya belum terisi atau tidak valid, sehingga aplikasi menonaktifkan elemen ini (mis. tombol Simpan / Selanjutnya).',
        'Field bergantung pada pilihan lain (mis. Sub Regional menunggu Regional dipilih).',
        'Akun uji tidak punya hak untuk mengubah data ini.',
      );
      suggestions.push(
        'Periksa step-step pengisian sebelumnya di screenshot; lengkapi isian yang dibutuhkan sebelum step ini.',
      );
      break;
    case 'text-mismatch': {
      const m = /^Expected text "(.*)", but the element shows "(.*)"\.?$/m.exec(error);
      likely = 'application';
      title = `Teks pada elemen tidak sesuai harapan`;
      summary = `Step ${name} mengharapkan teks ${quote(m?.[1] ?? step.value)}, tetapi yang tampil ${quote(m?.[2] ?? '')}.`;
      causes.push(
        'Data / perhitungan di aplikasi berbeda dari yang diharapkan (kemungkinan bug bila nilai harapan sudah benar).',
        'Nilai harapan di test sudah tidak relevan (data uji berubah, atau nilai diambil dari variabel yang berbeda).',
        'Data belum selesai diperbarui saat dicek (tampilan masih nilai lama).',
      );
      suggestions.push(
        'Cek manual nilai yang benar di aplikasi. Bila aplikasi salah, laporkan sebagai bug; bila harapan test yang keliru, perbarui nilai di step.',
      );
      break;
    }
    case 'rows-mismatch': {
      const m = /(\d+) of (\d+) rows do not contain "(.*)", e\.g\. "(.*)"/.exec(error);
      likely = 'application';
      title = 'Hasil daftar / filter tidak sesuai';
      summary = m
        ? `${m[1]} dari ${m[2]} baris yang tampil tidak memuat ${quote(m[3])}. Contoh baris yang tidak sesuai: ${quote(m[4], 140)}.`
        : `Sebagian baris yang tampil tidak memuat teks yang diharapkan (${quote(firstLine, 160)}).`;
      causes.push(
        'Filter / pencarian di aplikasi tidak menyaring dengan benar (bug), atau mencocokkan kolom lain yang tidak terlihat di baris.',
        'Selector baris ikut mengambil baris lain (mis. baris ringkasan / total / tabel lain di halaman).',
        'Hasil filter belum selesai dimuat ulang saat dicek.',
      );
      suggestions.push(
        'Buka screenshot dan lihat baris contoh di atas: bila memang tidak sesuai filter, laporkan sebagai bug; bila itu baris yang bukan data (header/total), persempit selector baris.',
      );
      break;
    }
    case 'no-rows':
      likely = 'test-data';
      title = 'Tidak ada data yang bisa dicek';
      summary = `Daftar / tabel yang dicek kosong, sehingga step ${name} tidak punya data untuk diperiksa.${selectorEvidence}`;
      causes.push(
        'Data uji untuk kondisi / filter ini memang tidak ada (kosong).',
        'Data belum selesai dimuat, atau gagal dimuat dari server.',
        'Selector baris tidak cocok dengan struktur tabel saat ini.',
      );
      suggestions.push(
        'Pastikan data uji tersedia untuk filter yang dipakai, atau beri step sebelumnya opsi "Bila gagal, akhiri test sebagai lulus" bila data kosong memang wajar.',
      );
      break;
    case 'not-sorted':
      likely = 'application';
      title = 'Urutan data tidak sesuai';
      summary = `Data seharusnya berurutan, tetapi ditemukan urutan yang keliru: ${quote(firstLine, 200)}.`;
      causes.push(
        'Pengurutan di aplikasi tidak bekerja dengan benar (bug), atau format tanggal/angka tidak dikenali dengan benar.',
      );
      suggestions.push(
        'Cek manual urutan di aplikasi; bila salah, laporkan sebagai bug dengan screenshot step ini.',
      );
      break;
    case 'still-shown': {
      const m = /\(([^,]+?)(?:, e\.g\. "(.*)")?\)\.?$/.exec(firstLine);
      likely = 'application';
      title = 'Elemen yang seharusnya hilang masih tampil';
      summary = `Step ${name} memastikan sesuatu TIDAK tampil, tetapi elemen tersebut masih terlihat${m?.[2] ? `: ${quote(m[2])}` : ''}.`;
      causes.push(
        'Aplikasi masih menampilkan pesan / data yang seharusnya sudah hilang (mis. popup error, baris yang seharusnya tersaring).',
        'Proses sebelumnya belum selesai sehingga tampilan belum berubah.',
      );
      suggestions.push(
        'Lihat isi elemen yang masih tampil di atas: bila itu pesan error / data yang salah, laporkan sebagai bug; bila tampilan memang benar, perbarui harapan di step.',
      );
      break;
    }
    case 'url-mismatch': {
      const m = /contain "(.*)", but it was (\S+)/.exec(error);
      likely = ev.loginPage ? 'environment' : 'application';
      title = 'Halaman yang terbuka tidak sesuai';
      summary = `Step ${name} mengharapkan alamat halaman memuat ${quote(m?.[1] ?? step.value)}, tetapi halaman yang terbuka ${m?.[2] ?? 'berbeda'}.`;
      causes.push(
        'Navigasi / tombol sebelumnya tidak membawa ke halaman yang dituju (redirect, menu salah, atau aksi sebelumnya gagal tanpa pesan).',
        'Alamat halaman di aplikasi berubah (routing diperbarui).',
      );
      suggestions.push(
        'Cek screenshot step sebelumnya untuk melihat apakah klik/aksi terakhir benar-benar berhasil.',
        'Bila alamat memang berubah, perbarui nilai URL di step ini.',
      );
      break;
    }
    case 'value-mismatch':
      likely = /already used/.test(error) ? 'test-data' : 'test-script';
      title = /already used/.test(error)
        ? 'Semua data yang tersedia sudah pernah dipakai'
        : 'Nilai elemen tidak sesuai pola';
      summary = /already used/.test(error)
        ? 'Step mengambil data yang belum pernah dipakai run sebelumnya, tetapi semua data yang tampil sudah pernah dipakai.'
        : `Step ${name} tidak dapat mengambil / memeriksa nilai elemen: ${quote(firstLine, 200)}.`;
      causes.push(
        /already used/.test(error)
          ? 'Data uji habis untuk skenario ini (semua sudah dipakai run sebelumnya).'
          : 'Format teks di aplikasi berbeda dari pola (regex) yang diharapkan step, atau elemen yang diambil kosong.',
      );
      suggestions.push(
        /already used/.test(error)
          ? 'Tambah data uji baru, atau matikan opsi "unik" pada step ini.'
          : 'Bandingkan teks elemen di screenshot dengan pola pada step; sesuaikan pola atau selector.',
      );
      break;
    case 'option-missing':
      likely = 'test-data';
      title = 'Pilihan yang dibutuhkan tidak tersedia';
      summary = `Step ${name} tidak dapat memilih opsi: ${quote(firstLine, 200)}.`;
      causes.push(
        'Opsi yang dicari tidak ada pada data saat ini (sudah dihapus / diganti nama / tidak aktif).',
        'Daftar pilihan bergantung pada pilihan sebelumnya yang belum diisi atau berbeda.',
        'Daftar pilihan gagal dimuat dari server.',
      );
      suggestions.push(
        'Cek daftar pilihan yang tampil (lihat pesan di atas / screenshot) dan sesuaikan nama opsi atau data ujinya.',
      );
      break;
    case 'api-scenario':
      likely = 'application';
      title = 'Scenario API di dalam test gagal';
      summary = `${quote(firstLine, 220)}.`;
      causes.push('Salah satu request API pada scenario mengembalikan respons yang tidak sesuai assertion.');
      suggestions.push(
        'Buka tautan "Open API run" pada step ini untuk melihat request/response dan analisa kegagalannya.',
      );
      break;
    default:
      title = `Step ${name} gagal`;
      summary = `Testora tidak dapat ${action}: ${quote(firstLine, 200)}.`;
      causes.push('Penyebab tidak dikenali secara otomatis.');
      suggestions.push('Periksa screenshot step ini dan pesan error teknis di bawahnya.');
  }

  // Bukti mengalahkan dugaan berdasarkan jenis.
  if (appMessages.length && kind !== 'missing-variable' && kind !== 'step-config') likely = 'application';
  if (ev.loading && ['element-not-found', 'element-hidden', 'no-rows'].includes(kind)) likely = 'environment';
  if (ev.missingVariables?.length)
    causes.unshift(`Variabel ${ev.missingVariables.map((v) => `{{${v}}}`).join(', ')} pada step ini kosong.`);
  if (ctx.retries)
    summary += ` Step sudah diulang ${ctx.retries} kali dan tetap gagal, jadi ini bukan sekadar gangguan sesaat.`;
  if (ctx.target === 'mobile' && ['element-not-found', 'element-hidden'].includes(kind))
    suggestions.push(
      'Buka "Page source at failure" di bagian Artifacts untuk melihat elemen apa saja yang ada di layar saat gagal.',
    );
  if (!selectorList.length && kind === 'element-not-found')
    suggestions.unshift('Step ini belum punya selector.');

  return {
    kind,
    likely,
    title,
    summary,
    causes: dedupe(causes),
    suggestions: dedupe(suggestions),
    evidence: ctx.evidence,
  };
}

const dedupe = (list: string[]) => [...new Set(list)];

/* ------------------------- bukti dari halaman (web) ------------------------- */

const MESSAGE_SELECTORS = [
  '[role=alert]',
  '[role=alertdialog]',
  '.swal2-popup',
  '[data-sonner-toast]',
  '.Toastify__toast',
  '.toast',
  '.ant-message-notice',
  '.ant-notification-notice',
  '.MuiAlert-message',
  '.invalid-feedback',
].join(', ');
const ERROR_TEXT =
  /(404|not found|tidak ditemukan|terjadi kesalahan|kesalahan (sistem|server)|something went wrong|internal server error|gagal memuat|failed to (load|fetch)|unauthori[sz]ed|forbidden|akses ditolak|session (expired|habis))/i;
const LOADING_SELECTOR =
  '[role=progressbar], [aria-busy=true], [class*=skeleton], [class*=spinner], [class*=loading-overlay], text=/^\\s*(Memuat|Loading)\\b/i';

/** Batasi waktu pengumpulan bukti supaya halaman yang macet tidak menahan run. */
const within = <T>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

/**
 * Jumlah elemen cocok & yang benar-benar terlihat (dijalankan di browser). Terlihat =
 * punya ukuran, tidak disembunyikan CSS, dan tidak terpotong pembungkus ber-overflow
 * yang tingginya 0 (mis. menu / accordion yang tertutup tetapi isinya tetap di DOM).
 */
const countVisible = new Function(
  'els',
  String.raw`
  let visible = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    let clipped = false;
    for (let p = el.parentElement; p && !clipped; p = p.parentElement) {
      const ps = getComputedStyle(p);
      const pr = p.getBoundingClientRect();
      if (/hidden|clip/.test(ps.overflow + ps.overflowY) && (pr.height < 1 || pr.width < 1)) clipped = true;
    }
    if (r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !clipped) visible++;
  }
  return { count: els.length, visible };
`,
) as (els: unknown[]) => { count: number; visible: number };

/** Teks elemen yang tampil (dijalankan di browser). */
const shownTexts = new Function(
  'els',
  `return els.filter((el) => el.getClientRects().length > 0)
    .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean);`,
) as (els: unknown[]) => string[];

/** Ada elemen yang punya ukuran (dijalankan di browser). */
const anySized = new Function(
  'els',
  `return els.some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });`,
) as (els: unknown[]) => boolean;

/** Kumpulkan bukti dari halaman saat step gagal (aman: tidak pernah melempar error). */
export async function collectWebEvidence(page: Page, selectors: string[]): Promise<UiFailureEvidence> {
  const evidence: UiFailureEvidence = { url: page.url() };
  evidence.title = await within(page.title(), 1_500, '');
  evidence.selectors = [];
  for (const selector of selectors.slice(0, 3)) {
    const counted = await within(
      page.locator(selector).evaluateAll(countVisible),
      2_000,
      null as { count: number; visible: number } | null,
    );
    if (counted) evidence.selectors.push({ selector, ...counted });
  }
  const messages = await within(
    page.locator(MESSAGE_SELECTORS).evaluateAll(shownTexts),
    2_000,
    [] as string[],
  );
  const headings = await within(
    page.locator('h1, h2, [role=heading]').evaluateAll(shownTexts),
    1_500,
    [] as string[],
  );
  evidence.messages = [
    ...new Set([...messages, ...headings.filter((h) => ERROR_TEXT.test(h))].map((m) => m.slice(0, 200))),
  ].slice(0, 4);
  evidence.loading = await within(page.locator(LOADING_SELECTOR).evaluateAll(anySized), 1_500, false);
  evidence.loginPage =
    /^[a-z]+:\/\/[^/]+\/[^?#]*(login|signin|sign-in|auth)/i.test(evidence.url ?? '') &&
    (await within(page.locator('input[type=password]').first().isVisible(), 1_000, false));
  return evidence;
}

/** Variabel {{nama}} pada teks yang belum punya nilai di resolver. */
export function unresolvedVariables(texts: string[], resolve: (text: string) => string): string[] {
  const names = new Set<string>();
  for (const text of texts)
    for (const m of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
      try {
        resolve(m[0]);
      } catch {
        names.add(m[1]);
      }
    }
  return [...names];
}
