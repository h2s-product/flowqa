/**
 * Migrasi skema berurutan. Tambahkan migrasi baru di akhir array — jangan
 * pernah mengubah migrasi yang sudah dirilis. Versi disimpan di PRAGMA user_version.
 *
 * Desain: setiap entitas disimpan sebagai dokumen JSON di kolom `data`,
 * dengan kolom terpisah hanya untuk field yang dipakai filter/relasi.
 * Ini menjaga skema sederhana selama model domain masih berkembang.
 */
export const migrations: string[] = [
  /* 1 — skema awal */ `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE apis (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE scenarios (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_runs_project_started ON runs(project_id, started_at DESC);
  CREATE INDEX idx_runs_scenario_started ON runs(scenario_id, started_at DESC);

  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  /* Variabel hasil capture terakhir per scenario (nilai asli, untuk "Run from step"). */
  CREATE TABLE scenario_state (
    scenario_id TEXT PRIMARY KEY REFERENCES scenarios(id) ON DELETE CASCADE,
    variables TEXT NOT NULL
  );
  `,
  /* 2 — performance / stress test */ `
  CREATE TABLE perf_tests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE perf_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_perf_runs_project_started ON perf_runs(project_id, started_at DESC);
  CREATE INDEX idx_perf_runs_test_started ON perf_runs(test_id, started_at DESC);
  `,
  /* 3 — login & sesi. Kolom biasa (bukan dokumen JSON) karena email unik & hash rahasia. */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  /* Hanya hash SHA-256 dari token sesi yang disimpan, bukan token aslinya. */
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  `,
  /* 4 — user administration & akses per project */ `
  ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
  ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE users ADD COLUMN last_login_at TEXT;
  /* Akun yang sudah ada sebelum fitur ini adalah admin pertama. */
  UPDATE users SET role = 'admin';

  CREATE TABLE project_members (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE INDEX idx_project_members_user ON project_members(user_id);
  `,
  /* 5 — folder API Catalog (API lama dipindah dari field "group" saat server start) */ `
  CREATE TABLE api_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_api_folders_project ON api_folders(project_id);
  `,
  /* 6 — folder Test Scenarios */ `
  CREATE TABLE scenario_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_scenario_folders_project ON scenario_folders(project_id);
  `,
  /* 7 — UI Tester: folder, test case hasil rekaman, dan hasil run */ `
  CREATE TABLE ui_folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ui_folders_project ON ui_folders(project_id);

  CREATE TABLE ui_tests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ui_tests_project ON ui_tests(project_id);

  CREATE TABLE ui_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    test_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ui_runs_project_started ON ui_runs(project_id, started_at DESC);
  CREATE INDEX idx_ui_runs_test_started ON ui_runs(test_id, started_at DESC);
  `,
  // Pengaturan aplikasi (mis. SMTP untuk email hasil test), disimpan sebagai JSON per key.
  `
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // Jadwal UI Tester (Test Scheduler).
  `
  CREATE TABLE ui_schedules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_ui_schedules_project ON ui_schedules(project_id);
  `,
  // E2E Flow lintas platform (kanvas node web / Android / API) dan hasil run-nya.
  `
  CREATE TABLE e2e_flows (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_e2e_flows_project ON e2e_flows(project_id);
  CREATE TABLE e2e_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    flow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_e2e_runs_project_started ON e2e_runs(project_id, started_at DESC);
  CREATE INDEX idx_e2e_runs_flow_started ON e2e_runs(flow_id, started_at DESC);
  `,
  // Aplikasi per project (Android / Web): Firebase, perangkat (phone/tablet), URL web.
  `
  CREATE TABLE project_apps (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_project_apps_project ON project_apps(project_id);
  `,
];
