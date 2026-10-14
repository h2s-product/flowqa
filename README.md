# Testora

_Testing, Without the Complexity._

**No-code API & UI test automation.** Testora punya dua mode, yaitu **API Tester** dan **UI Tester**. Platform web untuk QA, BA, PM, dan tim UAT agar bisa membuat, menjalankan, dan memantau test API end-to-end tanpa menulis kode.

Runner menjalankan **HTTP request sungguhan** ke API Anda. Selain itu, tersedia demo API bawaan sehingga project contoh bisa langsung dicoba tanpa layanan eksternal.

---

## Prasyarat

- **Node.js ≥ 22.5** (disarankan Node 22 LTS atau 24). Versi ini dibutuhkan karena database memakai SQLite bawaan Node (`node:sqlite`), jadi tidak ada dependensi native yang perlu dikompilasi.
- npm 10+ (sudah termasuk dalam Node)

Cek versi dengan perintah:

```bash
node -v
```

Jika memakai nvm, jalankan `nvm use`; file `.nvmrc` sudah disediakan.

## Menjalankan di localhost

### Mode development (hot reload)

```bash
npm install
npm run dev
```

Setelah itu buka **http://localhost:5173**.

Perintah ini menjalankan dua proses sekaligus:

| Proses   | Port | Keterangan                                              |
| -------- | ---- | ------------------------------------------------------- |
| `server` | 4000 | REST API, test runner, scheduler, dan demo API          |
| `web`    | 5173 | UI React (Vite). Request `/api` diteruskan ke port 4000 |

### Mode produksi (satu proses)

```bash
npm install
npm run build
npm start
```

Setelah itu buka **http://localhost:4000**. Server menyajikan UI hasil build sekaligus API-nya.

## Mencoba demo

Saat pertama kali dijalankan dengan database kosong, Testora otomatis membuat project **"Maxxi Sales API"** yang berisi:

- **2 environment.** _Development_ mengarah ke `http://localhost:4000/demo-api/live`, dan _Staging_ mengarah ke `/demo-api/sandbox`.
- **10 API** di katalog (Login, Customer, Order, Payment).
- **3 scenario**: _Customer Purchase Flow_ (9 step berantai), _Cancel Before Payment_, dan _Login Smoke Test_.
- **2 jadwal.** _Login Smoke Test_ dijalankan setiap jam dan aktif. Jadwal harian di hari kerja dibuat dalam keadaan nonaktif.

Langkah mencoba:

1. Buka **Test Scenarios**, pilih **Customer Purchase Flow**, lalu klik **Run test**. Semua step akan lulus di Development.
2. Ganti environment di pojok kanan atas menjadi **Staging**, lalu jalankan lagi. Step _Verify Payment_ akan gagal karena gateway sandbox selalu mengembalikan `PENDING`. Di sini Anda bisa melihat penjelasan kegagalan dalam bahasa sederhana beserta saran perbaikannya.
3. Klik baris step pada tab **Results** untuk membuka response viewer (Pretty, Raw, Headers, Cookies, Timing, Request).

Untuk menguji API Anda sendiri, buat project baru, isi base URL environment, lalu impor file OpenAPI/Swagger atau tambahkan API secara manual.

> Reset data: hentikan server lalu hapus folder `data/`. Data demo tidak dibuat jika `FLOWQA_SEED=false`.

## UI Tester (rekam & putar ulang web UI)

Setiap UI test case (web & Android) punya **Test Case ID** otomatis, mis. `TC-0001`, `TC-0002`. ID ini berurutan dan unik di seluruh Testora, dan tidak berubah saat test diganti nama, diedit, atau dipindah folder. Duplikat mendapat ID baru, dan nomor test yang dihapus tidak dipakai ulang. ID tampil di daftar UI Test Cases (bisa dicari, mis. `TC-0012`), di editor test, di UI Test Runs, dan di node E2E Flow.

**Manual Book**: setiap UI test case bisa diunduh sebagai **satu berkas HTML mandiri** yang berisi semua langkah (uraian dalam Bahasa Indonesia, nilai input, hasil yang diharapkan, catatan kondisi/retry) lengkap dengan **screenshot** tiap langkah. Gambar disisipkan langsung, jadi berkasnya bisa dibuka offline atau dicetak/disimpan ke PDF. Nilai rahasia disamarkan. Tombol unduhnya ada di editor test (*Manual book*), di daftar UI Test Cases (ikon unduh), dan di detail UI run (memakai screenshot run tersebut). Bawaannya memakai screenshot dari run terakhir yang lulus.

Langkah yang berguna untuk alur bersyarat & data dinamis:
- **Save element text**: simpan teks elemen ke `{{variabel}}` (opsi regex untuk mengambil sebagian). Opsi *skip values saved by earlier runs* memilih nilai yang belum pernah dipakai run sebelumnya.
- **If this step fails** (di setiap step):
  - *stop the test* (bawaan);
  - *end the test as passed*, mis. tidak ada data untuk dites, sehingga sisa step dilewati dan run dianggap lulus;
  - *retry from step X* (maks. N kali). Saat diulang, "Save element text" memakai nilai lain yang belum dicoba di run itu.
- **Upload file** (web): unggah berkas contoh (PDF/PNG/JPG/TXT) ke kolom unggah, jenisnya mengikuti nama berkas atau atribut `accept`.
- **Check element color** (web): pastikan warna teks/latar elemen termasuk merah, oranye, kuning, hijau, biru, ungu, atau abu-abu.

Klik **UI Tester** di pemilih mode di bagian atas sidebar untuk berpindah dari mode API Tester. Project, environment, dan user dipakai bersama oleh kedua mode.

- **Merekam test:** buka **UI Test Cases**, klik **New recording**, lalu isi nama dan URL awal. Jendela **Google Chrome** akan terbuka di komputer tempat server berjalan. Gunakan web seperti biasa:
  - klik, isian teks, pilihan dropdown, checkbox, dan tombol Enter otomatis menjadi step dan muncul secara live di halaman Recording;
  - toolbar kecil di dalam halaman (**✓ Check text**, **👁 Check visible**, **🔗 Check URL**) dipakai untuk menambah pengecekan;
  - klik **■ Stop** atau tutup jendela Chrome untuk berhenti, lalu **Save**.
- **Selector yang tahan perubahan:** setiap elemen disimpan dengan beberapa selector cadangan, diurutkan dari yang paling stabil (`data-testid`, `id`, `name`, role + label, teks, lalu CSS path). Saat dijalankan, selector pertama yang ditemukan akan dipakai.
- **Mengedit test:** step bisa diedit, diurutkan ulang, dimatikan, dihapus, atau ditambah manual. **Record more steps** memutar ulang step yang sudah ada, lalu melanjutkan rekaman dari titik itu.
- **Kolom pencarian "live":** isian teks dicatat begitu Anda berhenti mengetik sekitar 1 detik, jadi pencarian yang langsung menampilkan hasil tanpa klik tetap terekam. Kata kunci yang berbeda (misalnya "Admin" lalu "Sales") menjadi step terpisah, sedangkan lanjutan atau koreksi kata yang sama digabung menjadi satu step.
- **Menjalankan otomatis:** **Run** menjalankan test secara headless, sedangkan **Run with browser visible** memperlihatkan jendelanya dan memutar step **dengan kecepatan seperti saat direkam**: jeda antar aksi sama dengan rekaman, teks diketik huruf demi huruf, dan elemen yang akan disentuh diberi highlight sebentar. Jeda tiap step bisa diubah di editor (**Pause … ms before**); step tanpa data rekaman memakai jeda 700 ms. Run headless dan terjadwal tetap berjalan cepat. Setiap step punya status, jam, durasi, selector yang dipakai, pesan error yang jelas, dan **screenshot** (klik untuk memperbesar). Riwayat run ada di **UI Test Runs**, dikelompokkan menurut folder test case-nya (path lengkap, termasuk subfolder), dengan filter folder dan status. Run dari test yang sudah dihapus dikumpulkan di grup _Deleted tests_.
- **Memilih dari daftar/dropdown ("Pick an option"):** untuk test yang memilih item dari daftar (misalnya kota/kabupaten), pakai step **Pick an option** agar test yang dijalankan berulang tidak memilih item yang sudah terpilih. Step ini mencari semua pilihan yang cocok dengan selector (misalnya `role=option`, atau elemen `<select>` itu sendiri), melewati yang sudah terpilih, tercentang, atau nonaktif, lalu memilih satu secara acak atau yang pertama tersedia. Mode **A specific option** memilih opsi dengan teks persis tertentu, misalnya `Admin` (tidak akan tertukar dengan "Super Admin"). Teks pilihannya bisa disimpan sebagai variabel (misalnya `{{city}}`) untuk dicek di step berikutnya. Step ini juga bisa diarahkan ke **dropdown** (misalnya `role=combobox[name="Peran *"]`): dropdown bawaan maupun kustom dibuka lalu salah satu opsinya dipilih. Step klik hasil rekaman bisa langsung diubah Action-nya menjadi _Pick an option_; selectornya otomatis diubah agar mencakup semua pilihan. Kalau semua pilihan sudah terpakai, step gagal dengan pesan yang jelas. Untuk isian teks yang harus unik di setiap run (nama, email, nomor), tambahkan step **Set a value** di awal. Step ini menghitung nilai **sekali per run**, misalnya `nama_pengguna` = `{{random_name}} {{random_letters}}`, lalu `{{nama_pengguna}}` dipakai di step-step berikutnya: di isian form maupun di selector, misalnya `text="{{nama_pengguna}}"` untuk mengklik data yang baru dibuat. Generator yang tersedia: `{{random_name}}`, `{{random_email}}`, `{{random_phone}}`, `{{random_number}}`, `{{random_letters}}`, `{{uuid}}`, `{{current_date}}`, `{{timestamp}}`. Setiap generator menghasilkan nilai baru di setiap kemunculan, karena itu simpan dulu lewat _Set a value_ bila nilainya dipakai lebih dari sekali.
- **Memeriksa hasil filter ("Check every row contains"):** step pengecekan ini memastikan **setiap** baris yang tampil (misalnya `table tbody tr`) memuat teks tertentu, misalnya semua pelanggan setelah filter area "JATIM" memang berasal dari JATIM. Step menunggu sampai data hasil filter selesai dimuat, tidak membedakan huruf besar/kecil, dan gagal bila tabel kosong atau ada baris yang tidak sesuai (contoh baris tersebut ikut disebutkan di pesan error).
- **Memeriksa urutan ("Check sort order", web & mobile):** nilai pada semua elemen yang cocok (misalnya tanggal jatuh tempo `5 Okt 2026` atau nominal `Rp 195.000.000` di setiap kartu) harus urut `ascending` (terkecil/terdekat dulu) atau `descending` (terbesar/terbaru dulu). Tanggal (`5 Okt 2026`, `05/10/2026`, `2026-10-05`) dan angka/nominal Rupiah dikenali otomatis; teks lain diabaikan. Step menunggu sampai daftar selesai diurutkan ulang, dan pesan error menyebut nilai yang salah posisi.
- **Memastikan elemen tidak tampil ("Check element is not visible", web & mobile):** lulus bila tidak ada elemen terlihat yang cocok dengan selector, misalnya sheet sudah tertutup, label periode sudah berganti, atau hasil filter "Belum dibayar" tidak memuat status "Terbayar". Step menunggu sampai elemen hilang; pesan error menyebut elemen yang masih tampil.
- **Menjalankan banyak test sekaligus (bulk run):** di **UI Test Cases**, centang beberapa test case (atau centang semua di folder), lalu klik **Run N selected** (headless, cepat) atau **Run with browser visible** (jendela Chrome terbuka dan tiap test diputar dengan kecepatan seperti saat direkam). Test dijalankan **satu per satu** di latar belakang dengan environment yang dipilih di kanan atas, sehingga aplikasi yang dites tidak dibanjiri banyak browser sekaligus. Hasil tiap test muncul di **UI Test Runs** dan **Reports**. Test yang belum punya step dilewati.
- **Step API di UI test ("Run API scenario"):** untuk end-to-end lintas platform, misalnya aplikasi mobile mengirim data lalu datanya dicek di backoffice (web), atau alur approval antar-user di dua platform. Tambahkan step **Run API scenario** lewat **+ Add a step…**, lalu pilih scenario dari API Tester di project yang sama; scenario inilah yang berperan sebagai aplikasi mobile atau user kedua. **Semua nilai yang sudah diisi di UI test** (Set a value, Pick an option, hasil API scenario sebelumnya) ikut dikirim ke scenario sebagai `{{nama}}`, dan **nilai yang di-capture scenario** (misalnya `{{order_id}}`) bisa langsung dipakai step web berikutnya, misalnya untuk mencari data baru di tabel. API scenario memakai environment yang dipilih di kanan atas. Hasilnya tercatat sebagai API run biasa di **Test Runs** (mode "From UI test …"), dan dari detail UI run ada tautan **Open API run** untuk melihat request/response lengkap. Kalau salah satu API gagal, step ini gagal dan step berikutnya dilewati.
- **Test Scheduler (jadwal UI test):** menu **Test Scheduler** di UI Tester mengelompokkan beberapa UI test case menjadi jadwal **bernama**, misalnya "Smoke Test" setiap hari atau "Regression Test" setiap minggu. Klik **New schedule**, beri nama, centang test case (per test atau satu folder sekaligus, dengan pencarian), pilih environment, lalu tentukan waktunya: setiap 15 menit, setiap jam, setiap hari, hari kerja, atau **setiap minggu** pada hari tertentu. Test dalam satu jadwal dijalankan headless **satu per satu** dengan urutan sesuai daftar. Setiap run diberi label nama jadwalnya di **UI Test Runs**, tabel jadwal menampilkan ringkasan run terakhir ("4 passed · 1 failed"), dan kalau email aktif dikirim **satu email ringkasan** berjudul nama jadwal. **Run now** menjalankan jadwal kapan saja, dan tombol on/off menjeda jadwal. Test case yang sudah dihapus otomatis dilewati.
- **Menghapus test run:** di **Test Runs** (API Tester) dan **UI Test Runs**, centang run yang ingin dihapus (bisa pilih semua atau per grup folder), lalu klik **Delete** di bar yang muncul. Satu run juga bisa dihapus dari halaman detailnya (ikon tempat sampah). Run yang masih berjalan tidak bisa dihapus. Menghapus UI run ikut menghapus screenshot-nya dari disk. Penghapusan bersifat permanen, jadi selalu ada konfirmasi lebih dulu.
- **URL & login tersimpan untuk rekaman berikutnya:** saat membuat rekaman dengan URL atau login yang diketik langsung, aktifkan **Remember for next recordings**. URL, username, dan password lalu disimpan di environment yang dipilih sebagai `{{WEB_URL}}`, `{{WEB_USER}}`, dan `{{WEB_PASSWORD}}` (password disimpan sebagai secret). Rekaman berikutnya otomatis terisi variabel itu, jadi cukup isi nama test. Test hasil rekaman juga memakai variabel, sehingga URL atau password yang berubah cukup diperbarui di **Environments**. Nilai yang sudah tersimpan tidak ditimpa kecuali Anda sendiri yang mencentangnya ("replaces the saved value").
- **Login otomatis saat merekam:** di form **New recording**, aktifkan **Sign in automatically** lalu isi username/email dan password, baik langsung maupun sebagai variabel seperti `{{API_USER}}` / `{{API_PASSWORD}}` (pilih dari daftar variabel environment). Sebelum rekaman dimulai, form login di halaman awal dicari dan diisi otomatis, lalu tombol login ditekan. Langkah-langkah ini disimpan sebagai step pertama test (isi username, isi password, klik login, cek URL), sehingga saat diputar ulang test juga login sendiri. Kalau form login tidak terdeteksi, isi selectornya di bagian _Login form not found automatically?_. Kalau login gagal, rekaman tetap berjalan dan Anda bisa login manual di jendela Chrome.
- **Variabel & password:** nilai step boleh memakai `{{VARIABEL}}` dari environment yang dipilih di kanan atas, termasuk generator seperti `{{random_email}}`. Password yang direkam disamarkan di UI. Kalau saat merekam dicentang "Use variables", password yang sama dengan secret environment otomatis disimpan sebagai `{{NAMA_SECRET}}`.
- **Demo:** server menyediakan demo web shop di `/demo-web` (password `demo123`). Klik **Add demo shop test** di halaman UI Test Cases (atau pakai project demo baru) untuk langsung mencoba.

> UI Tester memakai Google Chrome yang terpasang di komputer server (lewat `playwright-core`, tanpa mengunduh browser tambahan). Recorder membuka jendela sungguhan, jadi server harus berjalan di komputer yang punya layar, misalnya di laptop kamu. Browser lain yang berbasis Chromium bisa dipakai lewat `FLOWQA_BROWSER_PATH`.

## Android automation (Appium + UiAutomator2)

UI Tester mengetes **aplikasi Android native** di Android Emulator atau HP Android sungguhan lewat Appium 2/3 + driver UiAutomator2. Test Android tinggal di **UI Test Cases** bersama test web, jadi folder, bulk run, Test Scheduler, Reports, email hasil, `{{variabel}}`, dan step **Run API scenario** berlaku sama. (Tahap ini hanya Android; iOS belum didukung.)

```
Testora UI → Testora backend → Mobile Test Runner → MobileDriverProvider
   ├─ MockMobileDriverProvider     → Mock Appium (aplikasi "Demo Shop" tiruan, tanpa perangkat)
   └─ AppiumAndroidDriverProvider  → Appium server → UiAutomator2 → Emulator / HP → aplikasi Android
```

### Setup sekali (admin): Settings → Mobile (Android)

- **Environment**: preflight yang benar-benar menjalankan setiap perintah (`sw_vers`, `node --version`, `java -version`, `sdkmanager --version`, `adb version`, `emulator -version`, `appium --version`, `appium driver list --installed`, `emulator -list-avds`, …). Status: `READY`, `NOT_INSTALLED`, `NOT_CONFIGURED`, `NOT_FOUND`, `ERROR`. READY hanya bila perintahnya berhasil.
- **Setup Android Environment** memasang hanya yang belum ada, tanpa sudo, lalu memeriksa ulang:
  - Java: `brew install openjdk@17`
  - Android command-line tools: `brew install --cask android-commandlinetools`, lalu `cmdline-tools;latest` di dalam SDK (`~/Library/Android/sdk`)
  - Lisensi SDK (hanya bila dicentang): `yes | sdkmanager --licenses`
  - `platform-tools`, `emulator`, platform + build-tools + system image yang cocok (tanpa versi hardcode: API stabil satu versi mayor di bawah yang terbaru, image `google_apis` untuk arsitektur Mac)
  - Appium di `~/.testora/appium` (`npm install --prefix …`, tanpa `npm -g`/sudo) dan `appium driver install uiautomator2`
  - Opsional: blok `ANDROID_HOME`/`ANDROID_SDK_ROOT`/PATH bertanda di `~/.zprofile` (tidak menimpa pengaturan yang ada)
  - Homebrew yang belum terpasang butuh password Mac: perintahnya hanya ditampilkan, tidak dijalankan. Testora tidak pernah meminta atau menyimpan password.
- **Appium**: versi Appium & UiAutomator2, status server, **Start/Stop Appium** (server lokal juga dinyalakan otomatis saat test membutuhkannya), log Appium (tersamarkan), URL server, capabilities default, dan **mode eksekusi bawaan** (untuk bulk run & jadwal).
- **Devices (Device Manager)**: emulator & HP dengan Device ID, tipe, versi Android, status (`CONNECTED`, `DISCONNECTED`, `BOOTING`, `BUSY`, `UNAUTHORIZED`, `ERROR`) dan status otomasi. Start/Stop emulator. Emulator yang **BUSY** (dipakai test atau Mobile Inspector) bisa dihentikan dengan **Force stop**: test-nya dihentikan dulu (hasil yang sudah ada tetap tersimpan), emulator dimatikan, lalu di-kill paksa bila macet dan tidak merespons. Kunci perangkatnya juga dilepas. AVD yang system image-nya hilang ditandai ERROR. **Create Android Emulator** membuka wizard (perangkat, versi Android, RAM, storage) — tidak pernah dibuat diam-diam. HP dengan USB debugging yang belum disetujui tampil sebagai _ADB Unauthorized_ beserta instruksinya.
- **Test connection**: Check Appium → UiAutomator2 → ADB → deteksi perangkat → sesi Appium sungguhan → buka aplikasi Settings Android → screenshot → tutup sesi. Hasil `CONNECTED ✓` atau error yang bisa ditindaklanjuti.

### Membuat & menjalankan test

- **New Android test** → nama, **Run on** (Mock / Android Emulator / Android Device), aplikasi: **Upload APK**, path APK, atau `appPackage` (+ `appActivity`) aplikasi yang sudah terpasang, opsional perangkat tertentu. Setiap test dimulai dari layar awal aplikasi (`forceAppLaunch`); layar sisa aplikasi lain ditutup dulu.
- **Mobile Inspector** (sesi Appium sungguhan): screenshot live, klik elemen di layar atau cari di daftar, highlight, semua properti Android (`text`, `content-desc`, `resource-id`, `class`, `package`, `bounds`, `enabled`, `clickable`, `focusable`, `focused`, `selected`, `checked`, `displayed`, …), **Test selector** (jumlah & posisi elemen yang cocok). Aksi: Tap, Long press, Type (password otomatis tersamar), Clear text, Scroll to it, Check visible/text/attribute, Every row, Draw polygon, plus Back, Swipe, Press key, Hide keyboard, Launch/Close/Restart app, Screenshot, Save page source, Wait, deep link. Setiap aksi langsung dijalankan dan (bila berhasil) direkam dengan jedanya. **Export JSON** menghasilkan `{ "action": "tap", "selectorType": "accessibilityId", "selector": "add_land" }`.
- **Rekomendasi selector**: Accessibility ID → Resource ID → UiSelector (teks, atau resource-id + `.instance(n)` bila berulang) → Class name → XPath (pilihan terakhir). Teks kolom isian tidak dipakai sebagai selector.
- **Step Android**: Launch App, Install APK, Tap, Long Press, Input Text, Clear Text, Swipe, Scroll until visible, Back, Press Key (`ENTER`, `BACK`, `HOME`, `SEARCH`, … atau keycode), Wait, Assert Text, Assert Element, Assert Attribute, Screenshot, Take Page Source, Close App, Restart App, Draw polygon, Hide keyboard, Open deep link.
- **Data dinamis**: `{{timestamp}}`, `{{random_string}}`, `{{random_number}}`, `{{random_email}}`, `{{random_phone}}`, `{{random_name}}`, dan khusus mobile `{{random_latitude}}`, `{{random_longitude}}` (wilayah Indonesia) serta `{{random_polygon}}` (ring GeoJSON tertutup ±50–150 m, berbeda setiap run). Step **Draw polygon** mengetuk titik acak (poligon cembung) di dalam elemen, mis. peta.
- **Antrean perangkat**: satu perangkat = satu sesi Appium. Test berikutnya berstatus **QUEUED** sampai perangkat dilepas (FIFO). Inspector dan run memakai kunci yang sama.
- **Hasil run**: mode, perangkat, versi Android, versi aplikasi, versi Appium, waktu mulai/selesai, durasi, status (`PASSED`, `FAILED`, `ERROR` = tidak bisa dijalankan, `SKIPPED` per step, `QUEUED`). Bila gagal: screenshot, page source saat gagal, Appium log, ADB log (logcat), pesan error & step yang gagal. Semua log disamarkan (password step, secret environment, kredensial di URL).
- **Kode error**: `APPIUM_NOT_INSTALLED`, `UIAUTOMATOR2_NOT_INSTALLED`, `APPIUM_NOT_RUNNING`, `ANDROID_SDK_NOT_FOUND`, `NO_DEVICE`, `ADB_UNAUTHORIZED`, `DEVICE_BUSY`, `APPIUM_SESSION_FAILED` (dengan Appium log, perangkat & capabilities), `APP_NOT_CONFIGURED`, `APP_LAUNCH_FAILED`, `DEVICE_LOCKED`, `SESSION_LOST` — masing-masing dengan tombol tindak lanjut.

### Firebase App Distribution (APK baru otomatis)

**Settings → Mobile (Android) → Firebase** menghubungkan Testora ke Firebase App Distribution lewat **Service Account** (bukan email tester: login Google tester butuh password + verifikasi 2 langkah dan tidak aman untuk otomasi).

1. Google Cloud Console (project yang sama dengan Firebase) → IAM & Admin → **Service Accounts** → buat service account dengan role **Firebase App Distribution Admin** → Keys → Add key → **JSON**.
2. Di Testora: **Upload key file**, isi **Project number** dan **Android App ID** (`1:123456789012:android:abc123`, dari Firebase → Project settings), lalu **Test connection**. Key disimpan di server saja; kunci privatnya tidak pernah dikirim balik ke browser.
3. **Releases**: daftar release (versi, build, catatan rilis, tanggal) dengan tombol **Download** dan **Install** ke emulator/HP.
4. **Download & install new releases automatically**: Testora mengecek Firebase berkala (5 menit–1 hari). Release baru diunduh dan dipasang sekali ke perangkat tujuan (`adb install -r -g`, perangkat dikunci selama pemasangan). Toggle **Then run a test schedule** menjalankan jadwal Test Scheduler (mis. "Smoke Test") setelah pemasangan, pada jenis perangkat yang sama. **Check now** menjalankan alur yang sama kapan saja. Semua kejadian tercatat di **Activity**.
5. Di test Android, pilih **Latest Firebase release** sebagai aplikasi (`firebase:latest`) supaya setiap run memakai APK terbaru; step **Install APK** juga menerima `firebase:latest`.

Batasan: hanya release APK (AAB ditolak dengan pesan jelas); link unduh Firebase berlaku singkat sehingga APK diunduh saat dibutuhkan (`data/apks/firebase-<versi>-<build>.apk`). HP yang layarnya terkunci dilaporkan sebagai `DEVICE_LOCKED` — Testora tidak pernah membuka kunci perangkat.

**Selector Android** (satu per baris, yang pertama ditemukan dipakai):

| Format                               | Jenis               |
| ------------------------------------ | ------------------- |
| `~add_land`                          | Accessibility ID    |
| `id=com.app:id/name`                 | Resource ID         |
| `android=new UiSelector().text("…")` | Android UIAutomator |
| `//android.widget.Button[@text="…"]` | XPath               |
| `class=android.widget.EditText`      | Class name          |
| `text=Simpan` / `text*=Sim`          | Text (UiSelector)   |

> Mock Mode tetap tersedia untuk development/demo tanpa perangkat. Real mode hanya dianggap berhasil bila sesi Appium benar-benar terbentuk.

## E2E Flow (lintas platform: web, Android, API)

Mode ketiga di pemilih mode sidebar: **E2E Flow**. Di sini test case dari semua platform disusun di satu kanvas (mirip n8n) dan disambung dengan panah.

- **E2E Flows → New flow** membuka kanvas. Palet kiri berisi **Web UI tests**, **Android tests**, **API scenarios**, dan kontrol **Start** & **Wait** (dengan pencarian). **Drag** item ke kanvas, atau **klik** item untuk menambahkannya di kanan node yang dipilih (langsung tersambung).
- **Panah**: tarik dari **titik kanan** sebuah node ke node lain. Panah yang membuat putaran ditolak. Klik panah lalu **Delete** (atau tombol _Delete arrow_) untuk menghapusnya.
- **Urutan & cabang**: node berjalan setelah **semua** node yang menunjuk ke dirinya lulus; cabang yang tidak saling bergantung berjalan **bersamaan**. Node yang pendahulunya gagal dilewati, kecuali pendahulu itu diberi **Continue when this fails**.
- **Variabel mengalir mengikuti panah**: nilai yang di-capture API scenario (mis. `{{order_id}}`), diisi _Set a value_ / _Pick an option_ di test web/Android, diteruskan ke semua node sesudahnya sebagai `{{nama}}`. Contoh: API (aplikasi mobile) membuat order → test web approve di backoffice memakai `{{order_id}}` → test Android memeriksa statusnya.
- **Pengaturan node** (panel kanan): nama di kanvas, tautan ke test case / scenario asli, _Show the browser_ (web), _Run on_ Mock / Emulator / Device (Android), lama jeda (Wait), _Continue when this fails_.
- **Kanvas**: geser dengan drag latar / scroll, zoom dengan Ctrl/⌘ + scroll atau tombol, _Fit to view_, _Tidy up_ (susun otomatis). Delete menghapus node/panah terpilih, Ctrl/⌘ + S menyimpan.
- **Run flow**: environment dipilih di atas kanvas (wajib bila ada node API). Halaman run menampilkan kanvas yang sama dengan status tiap node secara live (panah beranimasi pada node yang sedang berjalan), durasi, error, variabel yang diteruskan, dan tautan ke UI run / API run lengkap (step & screenshot). **Flow Runs** berisi riwayatnya. Email ringkasan mengikuti pengaturan email project.
- Keamanan: nilai asli variabel hanya dipakai di memori; yang disimpan & ditampilkan disamarkan untuk nama yang tampak rahasia (token, password, secret, key) dan nilai secret environment.

## Menghentikan test yang sedang berjalan (Stop)

Setiap run yang sedang berjalan punya tombol **Stop**: di halaman detail run dan sebagai ikon kecil di daftar run (API Test Runs, UI Test Runs, Flow Runs, dan panel hasil di Scenario Builder). Setelah konfirmasi, run berstatus **Stopped** ("Stopped by <nama>"). Step yang sudah selesai tetap tersimpan, dan step sisanya ditandai _skipped_. Semua proses terkait ikut berhenti:

- **API scenario:** request yang sedang berjalan dibatalkan.
- **UI test web:** Chrome langsung ditutup.
- **UI test Android:** sesi Appium ditutup sehingga perangkat langsung bebas untuk test berikutnya. Test yang masih _Waiting_ (antre perangkat) keluar dari antrean.
- **Step "Run API scenario"** di dalam UI test: API run-nya ikut dihentikan.
- **E2E Flow:** semua node yang sedang berjalan (web, Android, API, jeda) dihentikan beserta run di bawahnya, dan node yang belum mulai dilewati.
- **Run all / Run folder / jadwal:** menghentikan salah satu run juga membatalkan sisa batch.

Run yang dihentikan tidak dikirim lewat email. Di Reports, test tersebut memakai hasil run terakhir yang selesai.

## Reports

Menu **Reports** menampilkan hasil test setiap scenario yang dijalankan di project terpilih.

- **Filter:** periode (Today, 7, 30, atau 90 hari), environment, dan folder scenario (termasuk subfolder).
- **Ringkasan:** jumlah scenario yang dijalankan, jumlah run, pass rate, jumlah step passed/failed/skipped, dan rata-rata durasi.
- **Pie chart:**
  - _Scenario status_ menunjukkan hasil run terakhir tiap scenario: Passing, Failing, atau Not executed.
  - _Step results_ menunjukkan status semua step dari semua run.
  - Arahkan kursor ke potongan untuk melihat detailnya. Legenda menampilkan jumlah dan persentase.
- **Hasil per scenario:** scenario yang gagal tampil paling atas. Klik scenario untuk melihat status setiap step di run terakhir (lengkap dengan durasi dan alasan gagal) serta riwayat passed/failed/skipped step itu selama periode.
- **Export CSV** (satu baris per step) dan **Print / PDF** (dengan kop laporan, semua scenario otomatis terbuka).

**Kirim laporan ke email:** klik **Email report** di halaman Reports (API Tester maupun UI Tester), isi penerima (terisi otomatis dari pengaturan email project atau Settings → Email Report) dan pesan opsional, lalu **Send report**. Badan email berisi ringkasan (jumlah test passing/failing, run, step, dan daftar test yang gagal). Laporan lengkap dilampirkan sebagai **file `.html`** yang tampil **persis seperti halaman Reports**: semua test terbuka, filter dan tombol disembunyikan, dan bisa dibuka di browser mana pun tanpa login. Isi lampiran mengikuti periode, folder, dan filter yang sedang dipilih. Tombol **Download HTML** mengunduh file yang sama tanpa mengirim email.

Mode **UI Tester** juga punya menu **Reports** dengan tampilan dan fitur yang sama, tetapi per **UI test case**: filter periode dan folder UI test, ringkasan, pie chart _UI test status_ dan _Step results_ (status diambil dari run terbaru tiap test case; kalau run terbarunya Passed, test case dihitung Passing), hasil per test case (lengkap dengan browser yang dipakai dan pesan error tiap step), serta Export CSV dan Print / PDF. Filter environment tidak tersedia karena UI run tidak terikat environment.

## Folder di API Catalog & Test Scenarios

API dan scenario bisa dikelompokkan ke dalam folder dan subfolder (maksimal 5 level). Keduanya punya pohon folder sendiri-sendiri per project, dengan cara kerja yang sama:

- **Pohon folder** ada di sisi kiri API Catalog. Klik folder untuk melihat isinya. **All APIs** menampilkan semua API per folder, dan **Unfiled** berisi API yang belum masuk folder. Folder yang terakhir dibuka diingat per project.
- **Kelola folder:** ikon ➕📁 untuk folder baru. Di dalam folder tersedia tombol **Subfolder**, **Rename**, **Move**, dan hapus. Menghapus folder **tidak menghapus API**: API dan subfolder di dalamnya naik ke folder induk.
- **Pindahkan API:**
  - Centang beberapa API, pilih tujuan di bar **Move to**, lalu klik Move. Bisa juga dengan menyeret (drag & drop) API ke folder di pohon.
  - Folder juga bisa diseret ke folder lain. Seret ke **All APIs** untuk memindahkannya ke level teratas.
- **Pencarian** mencari di semua folder dan menampilkan lokasi folder setiap API.
- **Test Scenarios:** saat sebuah folder dibuka, tombol **Run all** berubah menjadi **Run folder**, yang menjalankan semua scenario di folder itu beserta subfoldernya. Scenario baru otomatis masuk ke folder yang sedang dibuka.
- **Import OpenAPI/Swagger:** pilih folder tujuan. Secara default, setiap tag OpenAPI menjadi subfolder.
- Data lama dimigrasi otomatis: field `group` pada API lama menjadi folder dengan nama yang sama saat server start.

## Login & logout

Semua halaman dan endpoint `/api/*` hanya bisa diakses setelah login. Demo API (`/demo-api`) tetap terbuka karena berfungsi sebagai target test.

- **Akun pertama.** Saat belum ada akun, halaman login otomatis berubah menjadi form **Create the admin account**. Akun ini berperan admin. Tidak ada password bawaan. Alternatifnya, isi `FLOWQA_ADMIN_EMAIL` dan `FLOWQA_ADMIN_PASSWORD` di `.env` agar akun dibuat otomatis saat server start (hanya jika database belum punya akun).
- **Logout** tersedia di bagian bawah sidebar, di samping nama user. Jika sesi habis, UI otomatis kembali ke halaman login.
- **Keamanan.** Password di-hash dengan scrypt. Sesi disimpan di cookie `HttpOnly` + `SameSite=Lax`, dan database hanya menyimpan hash SHA-256 dari token sesi. Sesi berlaku 7 hari dan diperpanjang otomatis selama dipakai. Setelah 10 kali gagal login, email tersebut dikunci selama 15 menit untuk alamat IP yang sama. Request yang mengubah data wajib menyertakan header `X-Requested-With` sebagai perlindungan CSRF.
- **Lupa password (lokal).** Hentikan server, hapus baris akun di tabel `users` pada `data/flowqa.db`, lalu buka UI untuk membuat akun baru.

## User Administration & akses project

Menu **Users** hanya muncul untuk admin.

| Peran      | Akses                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| **Admin**  | Semua project, termasuk yang dibuat nanti. Bisa mengelola user dan menghapus project.   |
| **Member** | Hanya project yang dicentang di pengaturan user, ditambah project yang ia buat sendiri. |

- **Tambah/edit user:** nama, email, password awal, peran, status aktif, dan daftar project yang boleh diakses. Mengisi password baru saat edit akan mereset password dan mengeluarkan user dari semua perangkat.
- **Nonaktifkan:** user langsung keluar dan tidak bisa login lagi sampai diaktifkan kembali. Data yang pernah ia buat tetap tersimpan.
- **Pengaman:** admin tidak bisa menurunkan peran, menonaktifkan, atau menghapus akunnya sendiri, dan Testora selalu harus punya minimal satu admin aktif.
- **Ganti password sendiri:** klik ikon kunci di samping nama user di sidebar. Sesi di perangkat lain otomatis dikeluarkan.
- Akses ditegakkan di server untuk semua endpoint (API, scenario, run, environment, schedule, performance, dashboard, dan ekspor CSV). Project yang tidak boleh diakses akan dibalas _not found_.

## Performance & stress test

Menu **Performance** menjalankan scenario yang sudah ada dengan banyak _virtual user_ (VU) secara bersamaan. Setiap VU mengulang scenario dari awal sampai akhir, jadi login, capture token, dan assertion tetap berlaku seperti run biasa.

- **Tipe test (preset):** _Load_ (trafik normal), _Stress_ (beban naik bertahap untuk mencari titik jenuh), _Spike_ (lonjakan mendadak), dan _Soak_ (beban sedang dalam waktu lama). Stage tetap bisa diubah setelah preset dipilih. Jumlah VU naik atau turun linear ke target setiap stage.
- **Metrik live** (diperbarui tiap detik): VU aktif, request/detik, error/detik, response time rata-rata dan p95, lalu p50/p90/p95/p99 per step, distribusi status code, dan error yang paling sering muncul.
- **Kriteria lulus:** batas p95 (ms) dan batas error rate (%). Hasilnya _Passed_ atau _Failed_ saat test selesai. Tombol **Stop test** menghentikan test lebih awal, dan hasil yang sudah terkumpul tetap disimpan.
- **Batasan:** maksimal 500 VU, 60 menit, dan 20 stage, dengan satu performance test berjalan pada satu waktu. Retry per step dimatikan selama uji beban supaya kegagalan tidak tersembunyi.

> Beban dikirim dari proses server Testora. Untuk hasil yang akurat, jalankan Testora di mesin yang tidak sedang dipakai untuk pekerjaan lain. Hanya uji sistem milik Anda sendiri atau yang Anda punya izin untuk mengujinya.

## Email hasil test

Hasil setiap test run bisa dikirim otomatis ke email.

1. **Siapkan server email (sekali saja, oleh admin):** buka **Settings → Email Report** di sidebar (khusus admin). Pakai tombol **Quick fill** (Gmail, Microsoft 365 / Outlook, SendGrid, Mailgun) untuk mengisi server dan port, lalu isi username, password, dan alamat pengirim (**Send as**). Isi **Send reports to** dengan satu atau banyak alamat penerima laporan (ikut tersimpan; dipakai semua project yang tidak punya daftar penerima sendiri). Klik **Send test email** untuk mencoba sebelum menyimpan, lalu **Save settings**. Pengaturan langsung berlaku tanpa restart. Untuk Gmail, password yang dipakai adalah **App Password** (Google Account → Security → 2-Step Verification → App passwords), bukan password Gmail biasa.
2. **Aktifkan per project:** **Projects → Edit details → Email test results**, masukkan satu atau banyak alamat penerima (ketik alamat lalu tekan Enter/koma, atau paste daftar alamat sekaligus; maksimal 20, alamat tidak valid ditandai merah; kosongkan untuk memakai penerima dari Settings → Email Report), lalu pilih **After every run** atau **Only when a test fails**. Klik **Send test email** untuk mencoba.
3. **Yang dikirim:** setiap API test run, UI test run, performance run, dan run terjadwal yang selesai, dengan hasil, environment/browser, durasi, jumlah step, alasan gagal, dan tautan ke halaman hasil di Testora. **Bulk run** (Run all / Run selected) mengirim **satu email ringkasan**, bukan satu email per test.

Password SMTP disimpan di database server dan tidak pernah dikirim kembali ke browser; form hanya menampilkan bahwa password sudah tersimpan. Sebagai alternatif, SMTP juga bisa diisi lewat `.env` (`FLOWQA_SMTP_*`). Pengaturan dari halaman Settings diutamakan, dan `.env` dipakai bila belum ada pengaturan di aplikasi. Kegagalan pengiriman email hanya dicatat di log server dan tidak memengaruhi hasil test.

## Konfigurasi

Salin `.env.example` menjadi `.env` di root repo, lalu sesuaikan nilainya:

| Variabel                                                             | Default                 | Keterangan                                                                      |
| -------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| `PORT`                                                               | `4000`                  | Port server                                                                     |
| `FLOWQA_DB`                                                          | `./data/flowqa.db`      | Lokasi file SQLite (relatif terhadap root repo)                                 |
| `FLOWQA_SEED`                                                        | `true`                  | Buat project demo jika database kosong                                          |
| `FLOWQA_SCHEDULER_INTERVAL_MS`                                       | `20000`                 | Seberapa sering scheduler mengecek jadwal yang jatuh tempo                      |
| `FLOWQA_PUBLIC_URL`                                                  | `http://localhost:PORT` | Base URL environment demo                                                       |
| `FLOWQA_SESSION_DAYS`                                                | `7`                     | Lama sesi login (hari)                                                          |
| `FLOWQA_ADMIN_EMAIL` / `FLOWQA_ADMIN_PASSWORD` / `FLOWQA_ADMIN_NAME` | —                       | Opsional: buat akun admin otomatis bila belum ada akun                          |
| `FLOWQA_BROWSER_CHANNEL`                                             | `chrome`                | Browser untuk UI Tester (channel Playwright: `chrome`, `msedge`, …)             |
| `FLOWQA_BROWSER_PATH`                                                | —                       | Opsional: path executable browser berbasis Chromium                             |
| `FLOWQA_UI_ARTIFACTS`                                                | `./data/ui-artifacts`   | Folder screenshot hasil UI test                                                 |
| `FLOWQA_APPIUM_URL`                                                  | `http://127.0.0.1:4723` | Server Appium bila belum diatur di Settings → Mobile (Android)                  |
| `FLOWQA_FIREBASE_API`                                                | Google                  | Opsional: alamat Firebase App Distribution API (proxy / test)                   |
| `FLOWQA_TOOLS_DIR`                                                   | `~/.testora`            | Folder perkakas Testora (Appium dipasang di `appium/`)                          |
| `FLOWQA_SMTP_HOST` / `FLOWQA_SMTP_PORT` / `FLOWQA_SMTP_SECURE`       | — / `587` / `false`     | Server SMTP untuk email hasil test (kosong = email mati)                        |
| `FLOWQA_SMTP_USER` / `FLOWQA_SMTP_PASSWORD`                          | —                       | Login SMTP (untuk Gmail: alamat Gmail + App Password)                           |
| `FLOWQA_MAIL_FROM`                                                   | `FLOWQA_SMTP_USER`      | Pengirim email, mis. `Testora <qa@perusahaan.com>`                              |
| `FLOWQA_APP_URL`                                                     | `FLOWQA_PUBLIC_URL`     | Alamat web Testora untuk tautan di email (development: `http://localhost:5173`) |

Saat development, target proxy Vite bisa diubah lewat `FLOWQA_API_URL`.

## Script npm

| Perintah            | Fungsi                                                  |
| ------------------- | ------------------------------------------------------- |
| `npm run dev`       | Menjalankan server dan web dalam mode development       |
| `npm run build`     | Build UI (`web/dist`) dan bundle server (`server/dist`) |
| `npm start`         | Menjalankan server produksi, termasuk UI                |
| `npm test`          | Unit test engine (Node test runner)                     |
| `npm run typecheck` | Pengecekan TypeScript untuk server dan web              |
| `npm run format`    | Merapikan kode dengan Prettier                          |

## Struktur folder

```
flowqa/
├── shared/                  # Tipe domain & utilitas murni (dipakai server + web)
│   └── src/{types,utils}.ts
├── server/                  # Backend Node.js + Express
│   ├── src/
│   │   ├── index.ts         # Bootstrap: DB, pemulihan run, seed, HTTP server, scheduler
│   │   ├── app-context.ts   # Merakit semua service (dipakai server & test)
│   │   ├── app.ts           # Express app, auth & routing
│   │   ├── config.ts        # Konfigurasi dari env + batas retensi/konkurensi
│   │   ├── db/              # Koneksi SQLite, migrasi, data demo
│   │   ├── repositories/    # Akses data (satu-satunya tempat SQL)
│   │   ├── routes/          # Endpoint REST per resource (cek akses project)
│   │   ├── domain/          # Logika murni: normalizer, guard, presenter, OpenAPI, jadwal
│   │   ├── services/        # *-service.ts: run, perf, UI run, recorder, scheduler, auth, folder, report
│   │   ├── engine/          # Runner API & beban, variabel, assertion, masking; ui/ untuk Playwright
│   │   ├── demo/            # Demo Sales API (/demo-api) & demo shop (/demo-web)
│   │   └── lib/             # Helper kecil: http, log, time, password
│   └── test/                # Unit & integration test
├── web/                     # Frontend React + Vite + TypeScript
│   └── src/
│       ├── api/             # client.ts + queries/ (hook React Query per domain)
│       ├── components/      # ui/ (komponen dasar), runs/, folders/, charts/, Modal, Icon, …
│       ├── context/         # Auth, workspace (project/env aktif), toast
│       ├── features/        # Satu folder per halaman/fitur
│       ├── hooks/           # Hook umum (useEditableCopy)
│       ├── lib/             # Formatter, label, toast bus, mode
│       └── styles/          # tokens.css + CSS per kelompok (index.css mengimpor semuanya)
└── docs/
    ├── ARCHITECTURE.md      # Arsitektur, konvensi & panduan pengembangan
    └── UI-COMPONENTS.md     # Katalog komponen UI, class CSS & token warna
```

Penjelasan alur data, desain database, dan panduan menambah fitur ada di **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. Katalog komponen UI ada di **[docs/UI-COMPONENTS.md](docs/UI-COMPONENTS.md)**.

## Catatan keamanan

- Nilai variabel **secret** disimpan di database server, tetapi **tidak pernah dikirim ke browser**. UI hanya menerima `••••••••`. Nilai ini juga selalu disamarkan di request, response, dan variabel pada hasil run.
- Header `Authorization` dan cookie di log run ikut disamarkan sebagian.
- Akses dibatasi login + peran (admin/member) + keanggotaan project. Project yang tidak boleh diakses dibalas 404 oleh API.
- File database (`data/flowqa.db`) menyimpan secret (variabel secret environment dan password SMTP) dalam bentuk teks biasa. Jaga akses ke folder tersebut.
