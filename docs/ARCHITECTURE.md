# Arsitektur Testora

Dokumen ini ditujukan untuk engineer yang memelihara dan mengembangkan Testora. Katalog komponen UI ada di **[UI-COMPONENTS.md](UI-COMPONENTS.md)**.

## Gambaran umum

```
┌────────────────────────────┐   /api (JSON, cookie sesi)   ┌─────────────────────────────────────────────┐
│ web (React + Vite)         │ ───────────────────────────▶ │ server (Express)                            │
│  React Query cache,        │ ◀── polling run/rekaman ──── │  routes → services → repositories → SQLite  │
│  mode API Tester / UI Tester│                              │              └─ engine                     │
└────────────────────────────┘                              │                 ├─ ScenarioRunner (HTTP)    │
                                                            │                 ├─ LoadRunner (beban)       │
                                                            │                 └─ ui/ (Playwright + Chrome)│
                                                            └───────────────┬─────────────────────────────┘
                                                                            ▼
                                                   API / web yang dites · demo-api · demo-web
```

Repo ini adalah **npm workspaces monorepo** dengan tiga paket:

| Paket    | Isi                                                  | Aturan                                                                                 |
| -------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `shared` | Tipe domain (`types.ts`) & fungsi murni (`utils.ts`) | Tanpa I/O dan tanpa dependensi. Diimpor langsung sebagai source TS (`@flowqa/shared`). |
| `server` | REST API, test runner (API, beban, UI), scheduler    | Hanya `repositories/` yang menulis SQL. Semua input lewat `domain/normalizers.ts`.     |
| `web`    | UI                                                   | Komponen tidak memanggil `fetch`; semua data lewat hook di `api/queries/`.             |

`noUnusedLocals`/`noUnusedParameters` aktif di server & web: kode mati langsung gagal typecheck.

## Backend (`server/src`)

| Folder / file    | Isi                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `index.ts`       | Bootstrap: buka DB → pulihkan run yang terputus → seed demo → `createAppContext` → HTTP + scheduler. |
| `app-context.ts` | **Satu-satunya tempat merakit service** (`createAppContext`). Dipakai juga oleh test.                |
| `app.ts`         | Express app: `/api/health` (publik) → header CSRF → `/api/auth/*` → `requireAuth` → router lain.     |
| `config.ts`      | Konfigurasi dari env, termasuk `limits` (retensi & konkurensi) dan browser UI Tester.                |
| `routes/`        | Satu file per resource. Parsing request → service/repository → response.                             |
| `services/`      | Class ber-state / ber-I/O, semuanya bernama `*-service.ts`.                                          |
| `domain/`        | Logika murni tanpa I/O: normalizer, guard relasi, presenter respons, statistik, OpenAPI, jadwal.     |
| `engine/`        | Mesin eksekusi yang tidak tahu soal Express/DB: `scenario-runner`, `load-runner`, `ui/`.             |
| `repositories/`  | `DocumentRepository<T>`, `RunDocumentRepository<T>` (run/perf run/UI run), `UserRepository`.         |
| `db/`            | Koneksi SQLite, migrasi berurutan, seed demo.                                                        |
| `demo/`          | Demo Sales API (`/demo-api`) dan demo web shop (`/demo-web`) untuk contoh bawaan.                    |
| `lib/`           | Utilitas kecil: `http` (HttpError, asyncHandler), `time`, `log`, `password`.                         |

### Konvensi route

- Setiap handler dibungkus `asyncHandler`; error dilempar sebagai `HttpError(status, pesan)`.
- **Akses project wajib dicek**: `requireProject(ctx, res, projectId)` untuk URL berisi projectId, `requireOwned(ctx, res, entity, 'Nama')` untuk URL berisi id entitas. Project tanpa akses dibalas 404.
- Relasi antar-entitas divalidasi dengan `domain/guards.ts` (`assertProjectEnvironment`, `assertProjectScenario`, `assertStartUrl`) agar pesan & status konsisten (400).
- Respons daftar memakai presenter di `domain/presenters.ts` (`summarizeRun`, `summarizePerfRun`, `summarizeUiRun`, `lastRunBrief`, `presentUiTest`).
- Penghapusan yang punya efek samping (jadwal terkait, file screenshot) lewat `DeletionService`, termasuk `deleteRuns(kind, projectId, ids)`. Endpoint hapus run (`DELETE /runs/:id`, `POST /projects/:id/runs/delete`, dan padanannya untuk `ui-runs`) dibuat oleh satu helper, `routes/run-deletion.ts`. Run yang masih berjalan tidak dihapus.

### Alur eksekusi run API

```
POST /api/runs
  └─ RunService.start()
       ├─ validasi scenario & environment (guards), buat Run "running", simpan
       ├─ 202 + run  ◀── UI polling GET /api/runs/:id
       └─ (async) ScenarioRunner.execute(scenario, env, run, options, onProgress)
             per step: skip/disabled/kondisi → api (VariableContext → HttpClient → capture → assertion
             → explainFailure) / wait / setVariable / condition → onProgress → simpan progres
       └─ finish(): counts, samarkan variabel, scenario_state, prune (config.limits.storedRuns)
POST /api/projects/:id/run-all  → validasi → RunService.startBatch() (berurutan, di latar belakang)
```

- **Variabel.** `VariableContext` menerjemahkan `{{nama}}`: capture → environment → `BASE_URL` → generator dinamis (`DYNAMIC_VARIABLES` di shared, diimplementasikan di `engine/dynamic-variables.ts`; tipe `DynamicVariableKey` memastikan keduanya sinkron).
- **Secret.** `SecretMasker` menyamarkan nilai secret di request/response/variabel yang disimpan. `SECRET_MASK` (shared) adalah satu-satunya string samaran; nilai yang dikirim balik berupa mask dipertahankan (`normalizeEnvironment`, `restoreUiSecrets`).
- **Penjelasan error.** `engine/explain.ts` → `{title, detail, fix}`.
- **Server restart.** `recoverInterruptedRuns()` menandai run/perf run/UI run yang masih `running` (`RunDocumentRepository.markInterrupted`).

### Email hasil test

`NotificationService` (dirakit di `app-context.ts`; mailer & alamat web diambil dari `MailProvider` = `EmailSettingsService` setiap kali kirim) dipanggil oleh `RunService`, `UiRunService`, dan `PerfService` saat run selesai. Pengaturan per project ada di `Project.notifications.email` (`enabled`, `recipients`, `when: always|failed`). Bulk run memanggil `start(..., { notify: false })` untuk tiap item, lalu mengirim satu ringkasan (`apiBatch` / `uiBatch`). Isi email (subjek, teks, HTML dengan nilai yang di-escape) dibuat oleh fungsi murni di `domain/run-email.ts`. Pengiriman berjalan di latar belakang; error hanya dicatat di log. Test memakai mailer palsu (`createAppContext(repos, http, mailer)`). Endpoint: `GET /notifications/status`, `POST /projects/:id/notifications/test`. Pengaturan SMTP diatur admin di **Settings → Email Report** (`EmailSettingsService`, tabel `app_settings` key `email`, endpoint `GET/PUT/DELETE /settings/email` dan `POST /settings/email/test`). Pengaturan aplikasi diutamakan, `.env` jadi cadangan. `EmailSettings.recipients` adalah penerima default: project yang mengaktifkan email tanpa daftar penerima sendiri memakai daftar ini. Pengaturan lama dibaca lewat `stored()`, yang melengkapi field yang ditambahkan belakangan. Password tidak pernah dikirim ke UI (dibalas `SECRET_MASK`; mask yang dikirim balik = pertahankan). Transport nodemailer di-cache per isi pengaturan, jadi perubahan langsung berlaku. Sidebar mendukung grup menu (`NavGroup`, mis. Settings).

### Reports

`services/report-service.ts` punya satu mesin laporan (`assembleReport`) dan dua adaptor: `buildApiReport` (scenario + `Run`) dan `buildUiReport` (UI test case + `UiRun`). Keduanya menghasilkan `ReportData` dengan bentuk yang sama (`items`, `itemStatus`, `lastRun.target` = environment atau browser). Status item (`ReportItem.status`) dihitung di server dari run terakhir yang sudah selesai dalam periode, sama untuk API dan UI (test yang pernah gagal lalu lulus di run terbaru dianggap passing). Pie chart, filter, urutan, dan ikon di web semuanya memakai status ini. Endpoint: `GET /projects/:id/report` dan `GET /projects/:id/ui-report`, dengan filter yang di-parse oleh fungsi yang sama. Di web, `ReportPage` menerima `kind`; perbedaan label, tautan, dan filter diatur di `features/reports/reportConfig.ts`. Untuk menambah jenis laporan baru, buat adaptor baru dan satu entri di `REPORT_CONFIG`. **Email report / Download HTML:** `lib/standaloneHtml.ts` menggabungkan DOM `.report` yang sedang tampil (semua item dibuka dulu) dengan seluruh CSS aplikasi (stylesheet lintas-origin seperti Google Fonts dijadikan `<link>`), tema terang, tanpa script/input, dan tautan dijadikan absolut. `POST /projects/:id/reports/email` membangun ulang data laporan di server untuk badan email (`renderReportEmail`), membersihkan HTML lampiran (`<script>`, `on*=`, `javascript:`; maks 8 MB), lalu mengirim lewat `NotificationService.sendReport`.

### Performance test

`PerfService` → `LoadRunner` (virtual user menjalankan scenario berulang mengikuti stage) → metrik per detik & percentile → threshold. Satu performance run sekaligus.

### UI Tester

- **Recorder** (`UiRecorderService`): membuka Chrome (Playwright `channel: 'chrome'`), menyuntikkan `engine/ui/recorder-script.ts`, menerima aksi lewat binding `RECORDER_BINDING`. Sesi disimpan di memori; bisa memutar ulang step lama sebelum merekam lanjutan. Klik di area kosong wadah besar (> 120.000 px², bukan elemen interaktif, bukan kursor tangan, bukan canvas/gambar) tidak direkam, karena saat diputar ulang klik dilakukan di tengah wadah dan bisa mengenai baris/tombol lain. Elemen berteks yang punya elemen anak (mis. nama + badge) mendapat selector `tag:has-text("…")`. Isian teks dikirim saat change/blur/Enter/klik berikutnya atau setelah jeda mengetik 1 detik (`TYPING_PAUSE_MS`). Isian berikutnya di field yang sama hanya digabung bila `continuesTyping()` (lanjutan/koreksi), sehingga kata kunci pencarian yang berbeda menjadi step terpisah.
- **URL & login yang diingat** (input `remember`): `domain/recording-variables.ts` menyimpan nilai yang diketik langsung ke variabel environment `RECORDING_VARIABLES` (`WEB_URL`, `WEB_USER`, `WEB_PASSWORD` sebagai secret), lalu rekaman memakai `{{…}}`. Penyimpanan dilakukan di server supaya secret tidak bolak-balik ke browser. Form New recording mengisi variabel ini otomatis bila sudah ada.
- **Login otomatis** (rekaman baru, input `login: RecordingLogin`): `engine/ui/login-form.ts` memanggil `LOGIN_PROBE` di skrip perekam untuk mencari field username, password, dan tombol login (selector dari user menggantikan hasil deteksi). Selama status `signing-in`, aksi di halaman tidak direkam; aksi dengan waktu sebelum `ignoreBefore` juga dibuang. Step login baru disimpan bila login berhasil (URL berubah atau field password hilang), ditambah step `assertUrl` ke halaman tujuan. Password disimpan `sensitive`, atau sebagai `{{SECRET}}` bila cocok dengan secret environment.
- **Test Scheduler** (`UiScheduleService`, tabel `ui_schedules`, `routes/ui-schedules.ts`): jadwal bernama berisi `testIds`. `SchedulerService.tick` memanggil `uiSchedules.runDue(now)`, yang menjalankan `startBatch` dengan `trigger: 'schedule'` dan `scheduleName`, lalu memperbarui `lastBatch` lewat `onProgress`. Email ringkasan memakai nama jadwal sebagai judul. `computeNextRun` mendukung `weekly` + `day` (dipakai juga oleh jadwal API), dan form jadwal API & UI memakai `ScheduleTimingFields` yang sama.
- **Bulk run** (`UiRunService.startBatch`, `POST /projects/:id/ui-tests/run-batch`): test dijalankan berurutan di latar belakang; tiap test menunggu slot kosong (`config.limits.concurrentUiRuns`) sebelum mulai. Test tanpa step aktif dilewati dan disebutkan di respons. Di web, `FolderBrowser` menerima `bulkActions` untuk tombol tambahan di bar pilihan.
- **Runner** (`UiRunService`): `engine/ui/step-executor.ts` menjalankan tiap step dengan selector cadangan, screenshot per step di `config.uiArtifactsDir/<runId>/`.
- **Menunggu halaman tenang**: `watchNetwork(page)` melacak request aktif; setelah click/press/select/check/pickOption, `settle` menunggu sampai tidak ada request (kecuali stream/long-poll >5 dtk) selama 300 ms, maks. 3 dtk. Mencegah race saat mode cepat, mis. dialog Filter yang dibuka lagi sebelum daftar selesai dimuat lalu tertutup oleh re-render. Recorder memakai `waitForQuiet` sebelum membaca URL tujuan login, dan `loginUrl` diambil dari halaman form login (bukan URL awal yang bisa dialihkan ke /login).
- **Pace** (`engine/ui/pacing.ts`): `UiRun.pace` = `recorded` (bawaan untuk browser terlihat) atau `fast` (bawaan headless). Perekam mengirim waktu tiap aksi (`at`, dan `typingMs` untuk isian); `UiRecorderService` menyimpannya sebagai `UiStep.delayMs` (dibatasi 8 s, assertion 1,5 s). Saat `recorded`, step berikutnya dimulai pada _awal step sebelumnya + delayMs_ (atau _akhir_ bila step sebelumnya mengetik), sehingga waktu muat halaman ikut terhitung dan ritmenya sama dengan rekaman.
- `engine/ui/environment.ts` berisi `UiVariables`: resolver `{{variabel}}` yang juga punya `set()` untuk variabel selama run. Variabel ini dipakai recorder & runner, termasuk untuk menyimpan hasil step `pickOption`.
- **apiScenario** ("Run API scenario"): dijalankan oleh `UiRunService.runApiScenario`, bukan oleh step executor, lewat `ApiScenarioRunner` = `RunService.runEmbedded`. Variabel UI (`UiVariables.snapshot()`) menjadi `initialVariables` scenario; variabel akhir yang berubah dikembalikan dengan `UiVariables.set`. API run disimpan seperti biasa (mode `From UI test "…"`, tanpa email terpisah) dan id-nya dicatat di `UiStepResult.apiRunId`. Step ini dilewati saat replay perekam, tanpa screenshot, dan tanpa jeda pace.
- **assertEach** ("Check every row contains"): semua elemen terlihat yang cocok dengan selector harus memuat teks nilai (tanpa beda huruf besar/kecil, spasi dinormalkan). Dicek berulang sampai batas waktu karena data hasil filter dimuat ulang; daftar kosong = gagal.
- **assertSorted** ("Check sort order"): teks semua elemen terlihat yang cocok diubah menjadi tanggal atau angka (`sortableValue` di `shared`, format Indonesia: bulan `Okt/Agu/Des`, titik = pemisah ribuan) lalu dicek urutannya (`checkSortOrder`); nilai `ascending`/`descending` (juga `asc`, `terdekat`, `terbesar`, …). Dicek berulang sampai batas waktu; tidak ada tanggal/angka = gagal. Implementasi di `engine/ui/step-executor.ts`, dipakai juga oleh executor mobile.
- **assertNotVisible** ("Check element is not visible"): tidak ada elemen terlihat yang cocok dengan selector mana pun; dicek berulang sampai batas waktu. Implementasi di `engine/ui/step-executor.ts`, dipakai juga oleh executor mobile.
- **setVariable** ("Set a value"): nilai step diterjemahkan sekali, lalu disimpan lewat `UiVariables.set(step.saveAs, …)`. Selector UI step juga diterjemahkan (`{{variabel}}`) sebelum dicari, sehingga data yang dibuat di run itu bisa ditemukan. Step ini tidak diberi jeda saat pace `recorded`.
- **pickOption** (`step-executor.ts`): fungsi browser `describeOptions` (dibuat dengan `new Function` agar bebas helper transpile) menandai pilihan yang sudah terpakai (`aria-selected`/`aria-checked`/`aria-pressed`/`aria-disabled`, `data-state`, `data-selected`, checkbox tercentang, `disabled`, atau cocok dengan `pick.skip`), lalu runner memilih yang tersisa (acak/pertama), atau pilihan dengan teks persis `pick.text` (mode `named`). Untuk `<select>`, yang dipilih adalah `<option>`-nya. Untuk dropdown kustom (`role=combobox` / `aria-haspopup`), tombolnya diklik dulu, lalu dipilih salah satu `[role=option]`/`[role=menuitem]` yang muncul. Setelah membuka dropdown, runner menunggu sebentar (`DROPDOWN_SETTLE_MS`) lalu memastikan pilihan diterima (daftar tertutup, opsi terpilih, atau tombol menampilkan pilihan); bila belum, klik diulang sekali lalu step gagal dengan pesan jelas. Perekam merekam tombol dropdown saat `pointerdown` (banyak dropdown terbuka di sini dan menutupi tombolnya, sehingga `click` tidak pernah sampai), mengabaikan opsi di bawah kursor saat tombol yang sama dilepas, lalu menangkap opsi yang dipilih saat `pointerup` (daftar sering sudah tertutup saat `click`), mengabaikan klik ke `<body>`, dan membaca `aria-labelledby` untuk nama elemen. Hasilnya dicatat di `UiStepResult.detail`, yang juga dipakai sebagai catatan di Reports.

### Android automation (Appium + UiAutomator2)

- **Target test:** `UiTestCase.target` = `web` (bawaan) atau `mobile` dengan `UiTestCase.mobile: MobileAppConfig` (Android saja: `MOBILE_PLATFORMS = ['android']`). `UI_STEP_TYPES[].targets` menentukan step per target; `normalizeUiTest` menolak step yang tidak cocok.
- **Provider** (`services/mobile-driver-provider.ts`): `MobileDriverProvider.acquire()` → `MobileLease` (driver, info perangkat/versi, log Appium, logcat, release). `MockMobileDriverProvider` memakai `engine/mobile/mock-appium.ts` (server W3C tiruan di dalam proses, aplikasi "Demo Shop", screenshot PNG sungguhan). `AppiumAndroidDriverProvider` (mode `emulator` / `device`): pastikan Appium menjawab (server lokal dinyalakan lewat `AppiumServerManager`), UiAutomator2 terpasang, pilih perangkat (`listDevices`; AVD yang ada dinyalakan otomatis bila belum ada emulator), kunci perangkat, buat sesi dengan `buildCapabilities`, lalu `ensureForeground` (Back/HOME + `activateApp` sampai package aplikasi muncul di page source). `AndroidProbe` bisa diganti di test (perangkat tiruan). Setiap kegagalan = `MobileError(code)`.
- **Antrean:** `DeviceLockManager` — satu serial = satu sesi, penunggu FIFO. Run yang menunggu berstatus `queued`; `UiRun.status` = `UiRunStatus` (`queued`, `running`, `passed`, `failed`, `error`). Test mobile tidak dihitung dalam batas UI run web.
- **Runner:** `UiRunService.executeMobile` → provider → `runSteps(StepRunner)` (sama dengan web). `UiRun.mobile: UiRunMobileInfo`, `UiRun.errorCode`, `UiRun.artifacts` (`failure-page-source.xml`, `logcat.txt`, `appium.log`, `session-request.txt`, `step-N-page-source.xml`) di folder artefak run, disajikan lewat `/ui-runs/:id/screenshots/:file` (whitelist nama file).
- **Executor** (`engine/mobile/mobile-executor.ts`): semua step Android (tap, input, clear, long press, swipe, scroll, back, press key, launch/close/restart/install app, assert text/element/attribute/each, screenshot, page source, draw polygon). `locators.ts` memetakan selector → strategi Appium & `describeSelector` → `MobileSelectorType`. `page-source.ts` mengurai XML UiAutomator2 → `MobileElement` (semua atribut, bounds diskalakan ke piksel screenshot, selector unik lebih dulu).
- **Environment** (`engine/android/`): `toolchain.ts` mencari JDK, SDK, sdkmanager/avdmanager, adb, emulator, Appium (env → lokasi standar → Homebrew → `~/.testora`) dan menyusun env proses anak; `run()`/`stream()` tanpa shell; `maskSecrets()`. `environment-manager.ts` = preflight (READY hanya dari perintah yang berhasil). `setup.ts` = rencana & runner "Setup Android Environment" (tanpa sudo; lisensi hanya bila disetujui). `sdk.ts` mengurai dua format sdkmanager (lama `|` dan "Android CLI" baru) dan memilih versi. `devices.ts` = adb/AVD/emulator/logcat. `avd.ts` = wizard AVD. `appium-server.ts` = server Appium terkelola + log berputar.
- **API:** `routes/android.ts` (`/android/environment`, `/android/setup[/plan]`, `/android/appium[/start|/stop|/log]`, `/android/devices`, `/android/emulators/:avd/start`, `/android/devices/:serial/stop`, `/android/avd[/options|/job]`, `/android/test-connection`, `/android/apks`). Pemasangan/Appium/AVD khusus admin. Mobile Inspector: `routes/mobile-inspector.ts` (+ `POST /mobile-inspector/:id/selector`).
- **Test:** `test/mobile.test.ts` — Mock Mode, Real mode (provider sungguhan terhadap Appium tiruan + `AndroidProbe` tiruan), error code, antrean, masking log, parser sdkmanager/adb, selector, data dinamis.

### Firebase App Distribution

- `engine/firebase/google-auth.ts`: token OAuth dari Service Account (JWT RS256 via `node:crypto`, alur `jwt-bearer`, cache token). `app-distribution.ts`: `GET /v1/projects/{number}/apps/{appId}/releases?orderBy=createTime desc` dan unduh `binaryDownloadUri` (APK saja; AAB dikenali dari `BundleConfig.pb`).
- `services/firebase-service.ts` (`FirebaseDistributionService`): pengaturan di `app_settings` key `firebase` (view hanya email/project key), status di `firebase-state` (`lastSeenRelease`, `lastCheckAt`, riwayat event). `download` → `data/apks/firebase-<versi>-<build>.apk`; `install` → pilih perangkat, kunci via `DeviceLockManager`, `AndroidProbe.installApk` (`adb install -r -g`, wajib "Success"). Timer per menit menjalankan `checkNow` sesuai interval: release baru → unduh → pasang → (opsional) `UiScheduleService.run(schedule, { mode })`. Release baru hanya ditandai "terlihat" setelah terpasang, jadi kegagalan dicoba lagi pada cek berikutnya.
- `firebase:latest` (`FIREBASE_LATEST_APP`): `AppiumAndroidDriverProvider.acquire` menggantinya dengan path APK terbaru; `MobileDriver.installApk` juga mendukungnya.
- API: `routes/firebase.ts` (`/android/firebase[/test|/check|/events]` admin; `/android/firebase/releases[/:id/download|/:id/install]` semua user). Test: `test/firebase.test.ts` (Google/Firebase tiruan yang memverifikasi tanda tangan JWT).
- HP terkunci: `devices.isLocked` (`dumpsys window` → keyguard) → `automationReady: false` dan `MobileError('DEVICE_LOCKED')`; Testora tidak membuka kunci perangkat.

### E2E Flow

- Data: `E2EFlow` (`nodes: FlowNode[]` dengan `kind` start/web/mobile/api/wait, `refId`, posisi, `config`; `edges: FlowEdge[]`) di tabel `e2e_flows`; `FlowRun` (hasil per node, salinan graf, variabel tersamar) di `e2e_runs`. `normalizeFlow` membuang panah ganda/ke diri sendiri/ke node hilang dan menolak putaran.
- `services/flow-run-service.ts` (`FlowRunService`): validasi (`validateFlow`: test case masih ada & target cocok, environment wajib untuk node API), lalu penjadwal DAG: node siap bila semua induk `passed` (atau `failed` + `continueOnFail`), node siap dijalankan paralel, node yang induknya gagal → `skipped`. Web/Android lewat `UiRunService.start({ initialVariables, onVariables, trigger: 'flow', notify: false })`, API lewat `RunService.runEmbedded`. Variabel masukan node = gabungan keluaran semua leluhurnya (nilai asli di memori); `maskVariables` menyamarkan yang disimpan (`UiRun.variables`, `FlowRun.variables`).
- API: `routes/e2e-flows.ts` (`/projects/:id/e2e-flows`, `/e2e-flows/:id[/run|/duplicate]`, `/projects/:id/e2e-runs`, `/e2e-runs/:id`). Email: `NotificationService.flowRun`.
- Web: mode `e2e` (`lib/mode.ts`), `features/e2e/` — `FlowCanvas` (kanvas SVG/HTML tanpa library: pan, zoom, drag node, port → panah bezier, tolak putaran, _Tidy up_, tampilan status run), `FlowEditorPage` (palet drag & drop + inspector), `FlowsPage`, `FlowRunsPage`, `FlowRunDetailPage` (polling live).
- Test: `test/e2e-flow.test.ts` (API → Android Mock → API dengan variabel mengalir, cabang paralel, skip, continue on fail, validasi graf).

### Stop (menghentikan run)

`lib/stop.ts` memberi setiap run satu `AbortController`. `RunService`, `UiRunService` dan `FlowRunService` masing-masing punya `stop(runId, stoppedBy)` dengan route `POST /runs/:id/stop`, `/ui-runs/:id/stop` dan `/e2e-runs/:id/stop`. Nama penghenti disimpan sebagai `signal.reason`.

Sinyal itu diteruskan ke setiap proses di bawahnya:
- `HttpRequest.signal` untuk request HTTP;
- `AcquireRequest.signal` untuk antrean `DeviceLockManager`;
- penutupan browser Playwright dan sesi Appium lewat listener `abort`;
- run anak (API scenario di dalam UI test, node E2E Flow) lewat `linkSignal`.

`untilStopped()` membuat step yang sedang menunggu langsung berhenti. Run berakhir dengan status `stopped` (`RunStatus`), step sisanya `skipped`, dan node flow yang berjalan `stopped`. Batch berhenti bila salah satu run-nya `stopped`. Run berstatus stopped tidak dikirim lewat email dan tidak menjadi hasil di Reports.

### Database

SQLite via `node:sqlite` (Node ≥ 22.5), WAL + foreign key.

- Entitas disimpan sebagai **dokumen JSON** di kolom `data`; kolom lain hanya untuk filter/relasi (diisi lewat `extraColumns`).
- Tabel run (`runs`, `perf_runs`, `ui_runs`) memakai `RunDocumentRepository`: `recent`, `between`, `prune`, `markInterrupted`.
- `users`, `sessions`, `project_members` memakai kolom biasa (email unik, hash rahasia).
- Menghapus project meng-cascade semua tabel turunan; file screenshot dibersihkan `DeletionService`.

**Menambah migrasi.** Tambahkan string SQL di **akhir** `db/migrations.ts`; jangan mengubah migrasi lama (`PRAGMA user_version`).

## Frontend (`web/src`)

| Folder              | Isi                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `api/client.ts`     | `http` (fetch + error), `toQuery`, `apiUrl`.                                                                                                   |
| `api/queries/`      | Hook React Query per domain (`projects`, `apis`, `folders`, `scenarios`, `perf`, `ui`, `users`) + `keys`, `POLL`. Import dari `@/api/queries`. |
| `components/ui/`    | Komponen dasar (badge, tombol ikon, stat, form, tabs, toggle, feedback). Lihat UI-COMPONENTS.md.                                               |
| `components/`       | Komponen bersama lain: `Modal`, `Icon`, `DateTime`, editor, `charts/`, `folders/`, `runs/`, `Layout`.                                          |
| `features/<fitur>/` | Satu folder per halaman/fitur. Komponen yang dipakai >1 fitur pindah ke `components/`.                                                         |
| `hooks/`            | Hook umum: `useEditableCopy` (form dengan tombol Save), `useSelection` (centang baris di daftar).                                              |
| `lib/`              | Fungsi murni: `format` (tanggal, angka, durasi, plural), `labels`, `bodyJson`, `mode`, `toast`.                                                |
| `context/`          | Auth, Workspace (project/env aktif), Toast.                                                                                                    |
| `styles/`           | CSS per kelompok, diimpor berurutan oleh `styles/index.css`. Token warna di `styles/tokens.css`.                                               |

### Konvensi data

- **Query key** hanya dari `keys.*` (`api/queries/keys.ts`); invalidasi memakai prefix (`keys.runsAll(projectId)`).
- **Polling** memakai `pollWhile(kondisi, POLL.x)` — berhenti otomatis saat data selesai atau error.
- **Error aksi**: `MutationCache` di `main.tsx` menampilkan toast untuk semua mutation yang gagal. Jangan menulis `onError` untuk toast; pakai `meta: { silentError: true }` bila error ditampilkan di dalam komponen.
- **"Jalankan lalu buka hasil"**: `useStartRunAndOpen`, `useRunUiTestAndOpen`, `useStartPerfRunAndOpen`.
- **Form edit dengan Save**: `useEditableCopy(entity)` — refresh data di latar belakang tidak menimpa editan user. Scenario builder memakai autosave `useScenarioDraft` (editan tertunda tetap disimpan saat halaman ditinggalkan).

### Mode API Tester / UI Tester

`lib/mode.ts` menentukan mode dari URL (`/ui/*` = UI Tester); halaman bersama (Projects, Environments, Users) memakai mode terakhir. `Layout` memilih menu sesuai mode.

## Panduan: menambah tipe step API scenario

1. `shared/src/types.ts`: interface step baru + tambahkan ke union `Step`.
2. `server/src/domain/normalizers.ts`: `case` baru di `normalizeStep`.
3. `server/src/engine/scenario-runner.ts`: `case` baru di `executeStep`.
4. `web/src/features/builder/step-factory.ts`, `AddStepModal.tsx`, `SimpleStepForms.tsx` + `StepConfigPanel.tsx`, ringkasan di `StepCard.tsx`.
5. `npm run typecheck` — `switch` pada union bersifat exhaustive, TypeScript menunjukkan tempat yang belum menangani tipe baru.

## Panduan: menambah halaman

1. Hook data di `web/src/api/queries/<domain>.ts` (pakai `keys`, `pollWhile`, `useInvalidate`).
2. Halaman di `web/src/features/<fitur>/<Nama>Page.tsx`, susun dari komponen di `components/ui` (toolbar `row wrap toolbar`, `SearchInput`, `StatGrid`/`Stat`, `EmptyState`, `IconButton`, …).
3. Route di `App.tsx`, menu & judul di `components/Layout.tsx` (`NAV`, `TITLES`).
4. CSS khusus fitur di `web/src/styles/features/<fitur>.css`, lalu tambahkan `@import` di `styles/index.css`.

## Testing

- `npm test` (Node test runner): utilitas, VariableContext, SecretMasker, jadwal, OpenAPI, auth & akses HTTP, folder, report, performance (LoadRunner dengan HTTP palsu), dan **UI Tester dengan Chrome headless** (dilewati otomatis bila Chrome tidak ada), serta **test Android** (Mock Mode dan provider sungguhan terhadap Appium & perangkat tiruan).
- Test HTTP memakai `createAppContext(repos, httpPalsu)` + `createApp` — sama dengan server sungguhan.
- `ScenarioRunner` & `LoadRunner` menerima `HttpClient` lewat constructor; suntikkan client palsu untuk test tanpa jaringan.

## Batasan saat ini & roadmap

| Area           | Kondisi sekarang                                | Saran langkah berikutnya                               |
| -------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Autentikasi    | Login sesi + peran admin/member + akses project | SSO/OIDC, peran per project (viewer/editor), audit log |
| Validasi input | Normalizer manual                               | Skema `zod` dibagikan dari `shared`                    |
| Eksekusi run   | In-process, satu instance                       | Job queue (BullMQ/Redis) & worker terpisah             |
| Progres run    | Polling (`POLL`)                                | Server-Sent Events                                     |
| Secret         | Plain text di SQLite                            | Enkripsi at-rest (AES-GCM) atau vault eksternal        |
| UI Tester      | Satu tab, tanpa iframe; mobile Android saja     | Tab/popup & iframe; iOS; device farm cloud             |
| Laporan        | Halaman Reports + CSV + cetak/PDF               | Notifikasi Slack/email saat jadwal gagal               |
