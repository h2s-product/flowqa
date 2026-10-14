# Katalog Komponen UI Testora

Pegangan untuk menyusun halaman agar tampilan & perilaku konsisten. **Sebelum membuat elemen baru, cek dulu di sini.**

```ts
import { EmptyState, IconButton, SearchInput, Stat, StatGrid, StatusBadge } from '@/components/ui';
```

## Aturan umum

1. **Pakai komponen, bukan markup ulang.** Tombol ikon → `IconButton`, kotak cari → `SearchInput`, kotak angka → `Stat`. Jangan menyalin `<button className="icon-btn">`.
2. **Warna hanya dari token** (`var(--brand)`, `var(--red)`, …) di `styles/tokens.css`. Jangan menulis hex di komponen; mode gelap otomatis mengikuti.
3. **Style inline hanya untuk nilai sekali pakai** (lebar kolom, dsb.). Pola yang berulang → class di `styles/`.
4. **Aksesibilitas**: tombol tanpa teks wajib punya `label`; status tidak boleh hanya warna (badge selalu berteks).
5. **Tanggal/waktu** selalu lewat `<DateTime>`; angka/durasi lewat `formatNumber` / `formatMs` / `formatDuration` di `lib/format.ts`; jamak lewat `plural(n, 'run')`.
6. **Error aksi** (mutation) sudah otomatis jadi toast. Pakai `useToast()` hanya untuk pesan sukses/info.

## `components/ui`

| Komponen         | Props                                                                    | Kapan dipakai                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BackLink`       | `to`, `label`                                                            | Tautan "← Kembali" di atas halaman detail.                                                                                                                   |
| `MethodBadge`    | `method`                                                                 | Label metode HTTP berwarna (GET/POST/…).                                                                                                                     |
| `StatusBadge`    | `status: AnyStatus`, `children?`                                         | Status run/step/rekaman. `children` mengganti teks default.                                                                                                  |
| `StatusIcon`     | `status`                                                                 | Ikon status kecil di baris step.                                                                                                                             |
| `EmptyState`     | `title`, `children?`, `action?`                                          | Daftar kosong / filter tanpa hasil. `action` untuk tombol ajakan.                                                                                            |
| `Loading`        | –                                                                        | Placeholder saat query pertama kali dimuat.                                                                                                                  |
| `ErrorBox`       | `error?`, `children?`                                                    | Error query yang menghalangi halaman (`role="alert"`).                                                                                                       |
| `Field`          | `label`, `hint?`, `children`, `group?`                                   | Pembungkus input form (label + petunjuk). Pakai `group` untuk isian yang berisi beberapa tombol, supaya klik label tidak diteruskan ke tombol pertama.       |
| `EmailListInput` | `value: string[]`, `onChange`, `label`, `placeholder?`, `max?`           | Banyak alamat email sebagai chip (Enter / koma / paste daftar). Alamat tidak valid ditandai merah, duplikat dibuang. Bungkus dengan `<Field group>`.         |
| `SearchInput`    | `value`, `onChange(value)`, `placeholder`, `width?`                      | Kotak pencarian di toolbar.                                                                                                                                  |
| `IconButton`     | `icon: IconName`, `label` (wajib), `size?`, + atribut `<button>`         | Tombol berisi ikon saja; `label` jadi tooltip & `aria-label`.                                                                                                |
| `RunCounts`      | `passed`, `failed?`, `skipped?`, `noun?`                                 | Ringkasan "12 passed · 1 failed".                                                                                                                            |
| `SelectCell`     | `checked`, `onChange`, `label`, `disabled?`, `indeterminate?`, `header?` | Kolom centang di tabel. Kliknya tidak membuka baris. `header` + `indeterminate` untuk centang "pilih semua". Pasangkan dengan hook `useSelection`.           |
| `StatGrid`       | `children`, `className?`, `columns?`                                     | Grid tile. Tanpa `columns` jumlah kolom mengikuti lebar layar (dashboard). Dengan `columns` grid tetap N kolom, turun ke 2 di layar sempit (halaman detail). |
| `Stat`           | `label`, `value`, `tone?: 'g' \| 'r'`, `size?: 'md' \| 'sm'`, `sub?`     | Kartu angka KPI. `tone` hijau/merah untuk nilai baik/buruk, `size="sm"` untuk teks/tanggal, `sub` untuk keterangan kecil (waktu relatif, versi, durasi).     |
| `Tabs`           | `tabs: {id,label,count?}[]`, `active`, `onChange`                        | Pindah panel dalam satu halaman/modal.                                                                                                                       |
| `Segmented`      | `options: {id,label}[]`, `value`, `onChange`                             | Filter pilihan tunggal yang pendek (status, periode). Punya `aria-pressed`.                                                                                  |
| `Toggle`         | `checked`, `onChange`, `label?`, `children?`, `disabled?`                | Saklar on/off. Dengan `children` → satu baris yang seluruhnya bisa diklik.                                                                                   |

## Komponen bersama lainnya

| Komponen / folder                   | Keterangan                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Modal`                             | `title`, `subtitle?`, `onClose`, `footer?`, `wide?`, `tabs?`. Esc/klik backdrop menutup, fokus dikelola otomatis.                             |
| `Icon`                              | `name: IconName`, `size?`, `strokeWidth?`. Ikon baru ditambahkan di `PATHS` (tipe ikut).                                                      |
| `features/ui/MobileAppFields`       | Isian aplikasi Android (upload/pilih APK, package, activity, perangkat, capabilities). Dipakai modal & editor.                                |
| `features/ui/mobileMode`            | `ExecutionModePicker` + `useExecutionMode` (Mock / Android Emulator / Android Device), `MobileErrorHelp` (kode error + tombol tindak lanjut). |
| `DateTime`                          | `value`, `relative?`, `timeOnly?`, `empty?`. Tooltip berisi waktu lengkap + zona.                                                             |
| `JsonView`                          | Menampilkan JSON dengan highlight key.                                                                                                        |
| `KeyValueEditor`, `BodyFieldEditor` | Editor header/query/body di form API & step.                                                                                                  |
| `charts/`                           | `DonutChart`, `RunTrendChart`, `FailureRateChart`, `TimeSeriesChart` (SVG, tanpa library).                                                    |
| `folders/`                          | `FolderBrowser` + `useFolderBrowser` (pohon folder, drag & drop, pindah massal), `FolderSelect`, `FolderFormModal`.                           |
| `runs/`                             | `RunTable` (opsional `selection`), `RunBulkBar`, `useRunDeletion` (konfirmasi + toast), `StepResultRow`, `FailureBox`, `ResponseViewerModal`. |
| `Layout`                            | Sidebar, mode switch, judul halaman (`NAV`, `TITLES`).                                                                                        |

## Konfirmasi (`useConfirm`)

Semua aksi yang menghapus atau membuang data wajib dikonfirmasi dengan popup seragam, bukan dengan `window.confirm()`:

```tsx
const confirm = useConfirm();
const remove = async () =>
  (await confirm({ title: `Delete “${item.name}”?`, message: 'Its run history stays.' })) &&
  mutation.mutate(item.id);
```

Opsi yang tersedia: `title`, `message?`, `confirmLabel?` (default "Delete"), dan `tone?` (`danger` untuk tombol merah, default; `normal` untuk tombol biru). Tombol Cancel mendapat fokus lebih dulu. Popup bisa muncul di atas modal lain, dan Esc hanya menutup modal paling atas. Provider-nya (`ConfirmProvider`) dipasang di `main.tsx`.

## Class CSS primitif

| Class                                                                          | Fungsi                                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `.btn` + `.primary` / `.ghost` / `.danger` / `.danger-solid` / `.blue` / `.sm` | Tombol teks.                                                                  |
| `.panel` > `.panel-h` + `.panel-b`                                             | Kartu dengan header & isi.                                                    |
| `.tbl-wrap` > `table.t`                                                        | Tabel; `tr.click` untuk baris yang bisa diklik, `td.num` angka rata kanan.    |
| `.row`, `.row.wrap`, `.grow`, `.grid`, `.grid.two`                             | Layout flex/grid dasar; `.grid.two` = dua kolom (satu kolom di layar sempit). |
| `.toolbar`                                                                     | Baris filter/aksi di atas konten (`row wrap toolbar`).                        |
| `.detail-bar`                                                                  | Baris judul + aksi di halaman detail.                                         |
| `.chip` (`.plain`, `.var-in`, `.var-out`)                                      | Label kecil / variabel.                                                       |
| `.muted`, `.small`, `.code`                                                    | Tipografi sekunder, kecil, monospace.                                         |
| `.text-pass`, `.text-fail`                                                     | Teks hijau/merah untuk angka hasil.                                           |
| `.mt-12`, `.mb-12`, `.mb-14`, `.mb-16`                                         | Jarak atas/bawah standar.                                                     |
| `.link-btn`                                                                    | Tombol yang tampil seperti tautan, untuk aksi kecil di teks petunjuk.         |
| `.bulk-bar` (`.danger`)                                                        | Bar aksi untuk item yang dicentang.                                           |
| `.banner`, `.empty`                                                            | Pesan info di atas halaman, area kosong.                                      |

## Token warna (`styles/tokens.css`)

| Token                                                        | Pakai untuk                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `--brand`, `--brand-ink`, `--brand-soft`, `--brand-gradient` | Warna utama logo Testora: tombol primary, link, menu aktif.                          |
| `--accent`, `--accent-ink`, `--accent-soft`                  | Aksen teal (UI Tester, highlight sekunder).                                          |
| `--green` / `--red` / `--amber` / `--blue` (+ `-soft`)       | **Khusus status** (passed/failed/warning/running) — jangan dipakai sebagai dekorasi. |
| `--violet` (+ `-soft`)                                       | Variabel/capture.                                                                    |
| `--bg`, `--surface`, `--surface2`, `--line`, `--line2`       | Latar & garis.                                                                       |
| `--ink`, `--ink2`, `--ink3`                                  | Teks utama, sekunder, redup.                                                         |

Mode gelap mendefinisikan ulang token yang sama; komponen tidak perlu kode khusus dark mode.

## Struktur file CSS

`styles/index.css` mengimpor berurutan: `tokens` → `base` → `components/*` → `layout/*` → `features/*` → `utilities` (utilitas terakhir agar bisa menimpa). Satu file per kelompok; CSS fitur baru masuk `styles/features/<fitur>.css`.

## Contoh susunan halaman daftar

```tsx
<>
  <div className="row wrap toolbar">
    <SearchInput value={q} onChange={setQ} placeholder="Search tests" />
    <Segmented options={STATUS_OPTIONS} value={status} onChange={setStatus} />
    <div className="grow" />
    <button className="btn primary" onClick={create}>
      New test
    </button>
  </div>
  <StatGrid className="mb-16">
    <Stat label="Pass rate" value="96%" tone="g" />
    <Stat label="Failed" value={3} tone="r" />
  </StatGrid>
  {items.length ? <Table items={items} /> : <EmptyState title="No tests yet" />}
</>
```
