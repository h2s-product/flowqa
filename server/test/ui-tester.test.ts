/**
 * Test integrasi UI Tester dengan Chrome headless sungguhan:
 * skrip perekam menangkap aksi di halaman uji, lalu runner memutar ulang hasilnya.
 * Dilewati otomatis bila Google Chrome tidak terpasang.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser } from 'playwright-core';
import type { UiStep } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `ui-artifacts-${process.pid}`);
process.env.FLOWQA_RECORDER_HEADLESS = 'true';
const { RECORDER_BINDING, RECORDER_SCRIPT } = await import('../src/engine/ui/recorder-script');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const {
  normalizeApi,
  normalizeEnvironment,
  normalizeProject,
  normalizeScenario,
  normalizeUiStep,
  normalizeUiTest,
} = await import('../src/domain/normalizers');
const { UiRunService } = await import('../src/services/ui-run-service');
const { demoWeb, demoUiTestInput, DEMO_WEB_PASSWORD } = await import('../src/demo/demo-web');
const { createAppContext } = await import('../src/app-context');
const { normalizeUiSchedule } = await import('../src/domain/normalizers');
const { continuesTyping } = await import('../src/services/ui-recorder-service');
const express = (await import('express')).default;

const PAGE = `<!doctype html><html><body>
<form id="login" onsubmit="event.preventDefault(); document.getElementById('out').textContent = 'Welcome ' + document.getElementById('email').value + ' (' + document.querySelector('select').value + (document.querySelector('#terms').checked ? ', terms' : '') + ')';">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label>Password <input name="password" type="password"></label>
  <select name="plan" aria-label="Plan"><option value="free">Free</option><option value="pro">Pro</option></select>
  <label><input type="checkbox" id="terms"> I agree</label>
  <button type="submit" data-testid="submit">Sign in</button>
</form>
<p id="out"></p>
<button onclick="document.getElementById('out').textContent = 'Cleared'">Clear</button>
</body></html>`;

/** Halaman uji pickOption: daftar pilihan kustom (sebagian sudah terpilih / nonaktif) + <select> bawaan. */
const PICK_PAGE = `<!doctype html><html><body>
<div role="listbox" aria-label="Cities">
  <button role="option" aria-selected="true">Bandung</button>
  <button role="option" aria-selected="false">Bekasi</button>
  <button role="option" aria-selected="false">Bogor</button>
  <button role="option" aria-disabled="true">Ciamis</button>
</div>
<p id="picked"></p>
<select id="plan"><option value="">Choose a plan</option><option selected>Free</option><option>Pro</option></select>
<script>
  document.querySelectorAll('[role=option]').forEach((b) => b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return;
    b.setAttribute('aria-selected', 'true');
    document.getElementById('picked').textContent = 'Picked ' + b.textContent;
  }));
</script>
</body></html>`;

/** Dropdown kustom ala Radix: opsi dipilih saat pointerup lalu daftar langsung ditutup (klik jatuh ke body). */
const DROPDOWN_PAGE = `<!doctype html><html><body>
<label id="role-label">Peran *</label>
<button id="role" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="role-label">Pilih peran</button>
<button id="save" disabled>Simpan</button>
<script>
  const trigger = document.getElementById('role');
  trigger.addEventListener('click', () => {
    if (document.getElementById('menu')) return;
    trigger.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.id = 'menu';
    menu.setAttribute('role', 'listbox');
    menu.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:white';
    for (const name of ['Super Admin', 'Admin', 'Finance', 'Sales']) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(trigger.textContent === name));
      option.textContent = name;
      option.addEventListener('pointerup', () => {
        trigger.textContent = name;
        trigger.setAttribute('aria-expanded', 'false');
        document.getElementById('save').disabled = false;
        menu.remove();
      });
      menu.appendChild(option);
    }
    document.body.appendChild(menu);
  });
</script>
</body></html>`;

/**
 * Dropdown yang terbuka saat pointerdown (seperti Radix Select): daftar opsinya
 * langsung menutupi tombol, jadi "click" tidak pernah sampai ke tombol dan
 * pointerup pertama jatuh ke opsi yang kebetulan di bawah kursor.
 */
const POINTERDOWN_PAGE = `<!doctype html><html><body style="margin:0">
<button id="area" role="combobox" aria-haspopup="listbox" aria-label="Area" style="margin:20px">Semua Area</button>
<p id="out" style="margin-top:300px"></p>
<script>
  const trigger = document.getElementById('area');
  trigger.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'listbox');
    menu.style.cssText = 'position:fixed;top:0;left:0;right:0';
    for (const name of ['Semua Area', 'JATIM', 'JATENG']) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = name;
      option.style.cssText = 'height:80px';
      option.addEventListener('pointerup', () => {
        if (Date.now() - openedAt < 150) return; // lepas tombol yang membuka dropdown
        trigger.textContent = name;
        document.getElementById('out').textContent = 'Area: ' + name;
        menu.remove();
      });
      menu.appendChild(option);
    }
    const openedAt = Date.now();
    document.body.appendChild(menu);
  });
</script>
</body></html>`;

/** Tabel yang difilter dengan jeda (seperti data yang dimuat ulang dari server). */
const TABLE_PAGE = `<!doctype html><html><body>
<button id="jatim">JATIM</button><button id="empty">Empty</button>
<table><thead><tr><th>Name</th><th>Area</th></tr></thead><tbody id="rows">
  <tr><td>Ade</td><td>JATIM<br>MAXXI NGAWI</td></tr>
  <tr><td>Budi</td><td>JATENG<br>MAXXI PURWODADI</td></tr>
</tbody></table>
<script>
  const show = (rows) => setTimeout(() => {
    document.getElementById('rows').innerHTML = rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('');
  }, 500);
  document.getElementById('jatim').onclick = () => show([['Ade', 'JATIM MAXXI NGAWI'], ['Cici', 'jatim  MAXXI BLITAR']]);
  document.getElementById('empty').onclick = () => show([]);
</script>
</body></html>`;

/** Kolom pencarian "live": hasil langsung tersaring saat diketik, tanpa tombol cari. */
/**
 * Seperti daftar pengguna di backoffice: "Terapkan" menutup dialog lalu memuat ulang
 * data (800 ms). Saat data tiba seluruh halaman di-render ulang, sehingga dialog
 * yang dibuka lagi sebelum data selesai dimuat ikut tertutup.
 */
const RELOAD_PAGE = `<!doctype html><html><body><div id="root"></div>
<script>
let area = 'Semua';
const render = (open) => {
  document.getElementById('root').innerHTML =
    '<button aria-label="Filter" id="filter">Filter</button><p id="rows">Rows: ' + area + '</p>' +
    (open ? '<div role="dialog"><button role="combobox" aria-label="Area" id="area">' + area + '</button>' +
      '<button role="option" id="jabar">JABAR</button><button id="apply">Terapkan</button></div>' : '');
  document.getElementById('filter').onclick = () => render(true);
  if (!open) return;
  document.getElementById('jabar').onclick = () => { area = 'JABAR'; document.getElementById('area').textContent = area; };
  document.getElementById('apply').onclick = () => {
    render(false);
    fetch('/users?area=' + area).then((r) => r.text()).then(() => render(false));
  };
};
render(false);
</script></body></html>`;

/** SPA yang mengalihkan "/" → "/login" di browser, lalu ke "/app/home" setelah login. */
const SPA_PAGE = `<!doctype html><html><body><div id="root">Loading…</div>
<script>
const root = document.getElementById('root');
const home = () => { history.pushState({}, '', '/spa/app/home'); root.innerHTML = '<h1>Dashboard</h1>'; };
setTimeout(() => {
  history.replaceState({}, '', '/spa/login');
  root.innerHTML = '<form id="f"><label>Email <input id="email" type="email"></label>' +
    '<label>Password <input id="pw" type="password"></label><button>Masuk</button></form>';
  document.getElementById('f').onsubmit = (e) => {
    e.preventDefault();
    // Login lewat API (lambat) lalu pindah ke dashboard.
    fetch('/users?login=1').then(home);
  };
}, 300);
</script></body></html>`;

/** Form yang id React-nya bergeser setelah deploy: #_r_1_ kini milik kolom "Nama", bukan "Email". */
const SHIFTED_IDS_PAGE = `<!doctype html><html><body><div role="dialog">
<label for="_r_1_">Nama Pengguna *</label><input id="_r_1_">
<label for="_r_2_">Email *</label><input id="_r_2_" type="email">
<label for="_r_3_">Password Awal *</label><input id="_r_3_" type="password">
</div></body></html>`;

const SEARCH_PAGE = `<!doctype html><html><body>
<input type="search" placeholder="Cari peran" aria-label="Cari peran">
<ul id="roles"></ul>
<script>
  const roles = ['Admin', 'Finance', 'Sales', 'Super Admin'];
  const render = (q) => { document.getElementById('roles').innerHTML = roles.filter((r) => r.toLowerCase().includes(q.toLowerCase())).map((r) => '<li>' + r + '</li>').join(''); };
  document.querySelector('input').addEventListener('input', (e) => render(e.target.value));
  render('');
</script>
</body></html>`;

/** Tabel di dalam kartu besar; baris bisa diklik (membuka detail), nama berisi badge. */
const CARD_PAGE = `<!doctype html><html><body style="margin:0">
<div id="card" style="padding:24px;width:900px">
  <table style="width:100%"><tbody>
    <tr onclick="location.hash='admin'"><td><span>Admin</span></td></tr>
    <tr onclick="location.hash='super'"><td><span>Super Admin <span class="badge">Sistem</span></span></td></tr>
  </tbody></table>
  <div style="height:260px"></div>
</div>
</body></html>`;

let chromeAvailable = true;
try {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  await b.close();
} catch {
  chromeAvailable = false;
}

describe(
  'UI Tester (record → replay)',
  { skip: !chromeAvailable && 'Google Chrome is not installed' },
  () => {
    let server: http.Server;
    let url = '';
    let browser: Browser;

    before(async () => {
      server = http.createServer((req, res) =>
        req.url?.startsWith('/users')
          ? void setTimeout(() => res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'), 800)
          : res
              .writeHead(200, { 'content-type': 'text/html' })
              .end(
                req.url === '/pick'
                  ? PICK_PAGE
                  : req.url === '/dropdown'
                    ? DROPDOWN_PAGE
                    : req.url === '/pointerdown'
                      ? POINTERDOWN_PAGE
                      : req.url === '/table'
                        ? TABLE_PAGE
                        : req.url === '/search'
                          ? SEARCH_PAGE
                          : req.url === '/card'
                            ? CARD_PAGE
                            : req.url === '/reload'
                              ? RELOAD_PAGE
                              : req.url === '/spa'
                                ? SPA_PAGE
                                : req.url === '/shifted'
                                  ? SHIFTED_IDS_PAGE
                                  : PAGE,
              ),
      );
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      browser = await chromium.launch({ channel: 'chrome', headless: true });
    });
    after(async () => {
      await browser?.close();
      server?.close();
    });

    let recorded: UiStep[] = [];

    it('records clicks, typing, choices, checkboxes and Enter as steps', async () => {
      const events: Record<string, unknown>[] = [];
      const context = await browser.newContext();
      await context.exposeBinding(RECORDER_BINDING, (_s, event) => {
        if (!String(event.type).startsWith('__')) events.push(event);
        return events.length;
      });
      await context.addInitScript(RECORDER_SCRIPT);
      const page = await context.newPage();
      await page.goto(url);
      await page.locator('#email').pressSequentially('qa@example.com', { delay: 15 });
      await page.locator('input[name=password]').pressSequentially('s3cret!');
      await page.locator('select').selectOption('pro');
      await page.locator('#terms').check();
      await page.getByTestId('submit').click();
      await page.getByText('Welcome qa@example.com').waitFor();
      await page.getByRole('button', { name: 'Clear' }).click();
      await page.waitForTimeout(200);
      await context.close();

      assert.deepEqual(
        events.map((e) => e.type),
        ['fill', 'fill', 'select', 'check', 'click', 'click'],
      );
      const [email, password, plan, terms, submit, clear] = events as {
        selectors: string[];
        value: string;
        sensitive?: boolean;
        description: string;
        at: number;
        typingMs?: number;
      }[];
      // Waktu aksi ikut terkirim untuk pemutaran "as recorded".
      assert.ok(
        events.every((e, i) => typeof e.at === 'number' && (i === 0 || e.at >= Number(events[i - 1].at))),
      );
      assert.ok(email.typingMs! > 100, `typing time is recorded (${email.typingMs})`);
      assert.equal(email.value, 'qa@example.com');
      assert.equal(email.selectors[0], '#email');
      assert.equal(password.sensitive, true);
      assert.equal(plan.value, 'pro');
      assert.match(terms.description, /I agree/);
      assert.equal(submit.selectors[0], '[data-testid="submit"]', 'test ids are preferred');
      assert.ok(clear.selectors.includes('role=button[name="Clear"]'));
      assert.match(clear.description, /Click "Clear" button/);

      recorded = [
        normalizeUiStep({ type: 'navigate', value: url, description: 'Open page' }),
        ...events.map((e) => normalizeUiStep(e)),
      ];
      // Tambah pengecekan seperti yang dibuat dari toolbar perekam.
      recorded.splice(
        6,
        0,
        normalizeUiStep({
          type: 'assertText',
          selectors: ['#out'],
          value: 'Welcome qa@example.com (pro, terms)',
        }),
      );
    });

    it('replays the recording automatically and screenshots every step', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Login', startUrl: url, steps: recorded }, projectId),
      );
      const service = new UiRunService(repos);
      const started = service.start(test.id, { headless: true });
      const run = await service.wait(started.id)!;

      assert.equal(run.status, 'passed', JSON.stringify(run.steps.filter((s) => s.status !== 'passed')));
      assert.equal(run.counts.passed, recorded.length);
      assert.ok(run.steps.every((s) => s.screenshot && s.startedAt && s.finishedAt));
      assert.ok(service.screenshotPath(run.id, run.steps[0].screenshot!));
      assert.equal(service.screenshotPath(run.id, '../../etc/passwd'), null, 'no path traversal');
    });

    it('never types into the wrong field when framework ids shift, and finds password fields by label', async () => {
      const { executeUiStep } = await import('../src/engine/ui/step-executor');
      const { variableResolver, noEnvironment } = await import('../src/engine/ui/environment');
      const page = await browser.newPage();
      try {
        await page.goto(`${url}shifted`);
        const resolve = variableResolver(noEnvironment());
        // Direkam saat #_r_1_ masih kolom Email; kini #_r_1_ = Nama.
        const email = await executeUiStep(
          page,
          normalizeUiStep({
            type: 'fill',
            description: 'Type into "Email *" field',
            selectors: ['#_r_1_', 'role=textbox[name="Email *"]'],
            value: 'a@b.test',
          }),
          resolve,
        );
        // role=textbox tidak cocok untuk kolom password; #_r_2_ kini kolom Email.
        const password = await executeUiStep(
          page,
          normalizeUiStep({
            type: 'fill',
            description: 'Type into "Password Awal *" field',
            selectors: ['#_r_2_', 'role=textbox[name="Password Awal *"]'],
            value: 'pw-1234567890',
            sensitive: true,
          }),
          resolve,
        );
        assert.equal(email.usedSelector, 'role=textbox[name="Email *"]');
        assert.equal(
          password.usedSelector,
          'role=textbox[name="Password Awal *"]',
          'found through its label',
        );
        assert.equal(await page.inputValue('#_r_1_'), '', 'the Name field stays empty');
        assert.equal(await page.inputValue('#_r_2_'), 'a@b.test', 'the email went into Email');
        assert.equal(
          await page.inputValue('#_r_3_'),
          'pw-1234567890',
          'the password went into the password field',
        );
        // Hanya id buatan framework tersisa dan labelnya beda → gagal dengan jelas, tidak mengetik ke kolom lain.
        await assert.rejects(
          executeUiStep(
            page,
            normalizeUiStep({
              type: 'fill',
              description: 'Type into "Nomor Telepon" field',
              selectors: ['#_r_1_'],
              value: '0812',
              timeoutMs: 800,
            }),
            resolve,
          ),
          /now points to a different field/,
        );
        assert.equal(await page.inputValue('#_r_1_'), '');
      } finally {
        await page.close();
      }
    });

    it('waits for data to finish loading after a click (dialog reopened too early is not lost)', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const click = (selector: string) =>
        normalizeUiStep({ type: 'click', selectors: [selector], timeoutMs: 3_000 });
      const test = repos.uiTests.save(
        normalizeUiTest(
          {
            name: 'Filter twice',
            startUrl: `${url}reload`,
            steps: [
              normalizeUiStep({ type: 'navigate', value: `${url}reload` }),
              click('[aria-label="Filter"]'),
              click('role=combobox[name="Area"]'),
              click('#jabar'),
              click('#apply'),
              // Langsung buka filter lagi: tanpa menunggu data, dialog ini tertutup oleh re-render.
              click('[aria-label="Filter"]'),
              // Seperti screenshot + jeda di run sungguhan: data tiba sebelum step berikutnya.
              normalizeUiStep({ type: 'wait', value: '1000' }),
              click('role=combobox[name="Area"]'),
              normalizeUiStep({ type: 'assertText', selectors: ['#area'], value: 'JABAR' }),
            ],
          },
          projectId,
        ),
      );
      const service = new UiRunService(repos);
      const run = (await service.wait(service.start(test.id, { headless: true, pace: 'fast' }).id))!;
      assert.equal(run.status, 'passed', JSON.stringify(run.steps.filter((s) => s.status !== 'passed')));
    });

    it('replays at recorded speed: waits between steps and types letter by letter', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const steps = [
        normalizeUiStep({ type: 'navigate', value: url }),
        normalizeUiStep({
          type: 'fill',
          selectors: ['#email'],
          value: 'qa@x.io',
          delayMs: 600,
          typingMs: 500,
        }),
        normalizeUiStep({ type: 'click', selectors: ['[data-testid="submit"]'], delayMs: 400 }),
        normalizeUiStep({ type: 'assertText', selectors: ['#out'], value: 'Welcome qa@x.io' }),
      ];
      const test = repos.uiTests.save(normalizeUiTest({ name: 'Paced', startUrl: url, steps }, projectId));
      const service = new UiRunService(repos);
      const startGap = (run: { steps: { startedAt?: string }[] }, i: number) =>
        Date.parse(run.steps[i].startedAt!) - Date.parse(run.steps[i - 1].startedAt!);

      const paced = await service.wait(service.start(test.id, { headless: true, pace: 'recorded' }).id)!;
      assert.equal(paced.status, 'passed', JSON.stringify(paced.steps));
      assert.equal(paced.pace, 'recorded');
      assert.ok(startGap(paced, 1) >= 580, `waits the recorded pause (${startGap(paced, 1)} ms)`);
      assert.ok(
        paced.steps[1].durationMs! >= 450,
        `types like the recording (${paced.steps[1].durationMs} ms)`,
      );
      // Jeda step 3 dihitung dari selesai mengetik, bukan dari awal step 2.
      assert.ok(startGap(paced, 2) >= paced.steps[1].durationMs! + 380);

      const fast = await service.wait(service.start(test.id, { headless: true }).id)!;
      assert.equal(fast.status, 'passed');
      assert.equal(fast.pace, 'fast', 'headless runs default to fast');
      assert.ok(fast.durationMs < paced.durationMs - 1000, `${fast.durationMs} vs ${paced.durationMs}`);
    });

    it('picks an unused option each time and saves it as a variable', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const pick = (mode: string, saveAs: string) =>
        normalizeUiStep({ type: 'pickOption', selectors: ['role=option'], pick: { mode, saveAs } });
      const steps = [
        normalizeUiStep({ type: 'navigate', value: `${url}pick` }),
        pick('first', 'city'),
        normalizeUiStep({ type: 'assertText', selectors: ['#picked'], value: 'Picked {{city}}' }),
        pick('random', 'city2'),
        normalizeUiStep({ type: 'assertText', selectors: ['#picked'], value: 'Picked {{city2}}' }),
        normalizeUiStep({
          type: 'pickOption',
          selectors: ['#plan'],
          pick: { mode: 'random', saveAs: 'plan' },
        }),
        pick('first', ''),
      ];
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Pick', startUrl: `${url}pick`, steps }, projectId),
      );
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id, { headless: true }).id)!;

      assert.deepEqual(
        run.steps.map((s) => s.status),
        ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'failed'],
        JSON.stringify(run.steps.map((s) => s.error ?? s.detail)),
      );
      // Bandung sudah terpilih & Ciamis nonaktif → "first" mengambil Bekasi, lalu tinggal Bogor.
      assert.equal(run.steps[1].detail, 'Picked "Bekasi" (skipped 2 already selected) · saved as {{city}}');
      assert.match(run.steps[3].detail!, /^Picked "Bogor"/);
      // <select>: "Free" sudah terpilih & placeholder dilewati → "Pro".
      assert.match(run.steps[5].detail!, /^Picked "Pro"/);
      assert.match(run.steps[6].error!, /All 4 options are already selected or disabled/);

      assert.throws(
        () => normalizeUiStep({ type: 'pickOption', selectors: ['x'], pick: { saveAs: 'not valid!' } }),
        /not a valid variable name/,
      );
    });

    it('records the option chosen in a custom dropdown (not a click on the page body)', async () => {
      const events: Record<string, unknown>[] = [];
      const context = await browser.newContext();
      await context.exposeBinding(RECORDER_BINDING, (_s, event) => {
        if (!String(event.type).startsWith('__')) events.push(event);
        return events.length;
      });
      await context.addInitScript(RECORDER_SCRIPT);
      const page = await context.newPage();
      await page.goto(`${url}dropdown`);
      await page.locator('#role').click();
      await page.getByRole('option', { name: 'Sales' }).click();
      await page.locator('#save').click();
      await page.waitForTimeout(200);
      await context.close();
      assert.deepEqual(
        events.map((e) => e.description),
        ['Click "Peran *" dropdown', 'Click "Sales" option', 'Click "Simpan" button'],
      );
      assert.ok((events[0].selectors as string[]).includes('role=combobox[name="Peran *"]'));
      assert.ok((events[1].selectors as string[]).includes('role=option[name="Sales"]'));
    });

    it('records a dropdown that opens on pointerdown (its click never reaches the button)', async () => {
      const events: Record<string, unknown>[] = [];
      const context = await browser.newContext();
      await context.exposeBinding(RECORDER_BINDING, (_s, event) => {
        if (!String(event.type).startsWith('__')) events.push(event);
        return events.length;
      });
      await context.addInitScript(RECORDER_SCRIPT);
      const page = await context.newPage();
      await page.goto(`${url}pointerdown`);
      await page.locator('#area').click();
      await page.waitForTimeout(250);
      await page.getByRole('option', { name: 'JATIM' }).click();
      await page.getByText('Area: JATIM').waitFor();
      await page.waitForTimeout(200);
      await context.close();
      assert.deepEqual(
        events.map((e) => e.description),
        ['Click "Area" dropdown', 'Click "JATIM" option'],
        'the dropdown button is recorded, and the option under the cursor while opening is not',
      );
    });

    it('waits for a pointerdown dropdown to settle and checks the choice was accepted', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const steps = [
        normalizeUiStep({ type: 'navigate', value: `${url}pointerdown` }),
        normalizeUiStep({
          type: 'pickOption',
          selectors: ['role=combobox[name="Area"]'],
          pick: { mode: 'named', text: 'JATIM' },
        }),
        normalizeUiStep({ type: 'assertText', selectors: ['#out'], value: 'Area: JATIM' }),
      ];
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Area', startUrl: `${url}pointerdown`, steps }, projectId),
      );
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id).id)!;
      assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => s.error ?? s.detail)));
    });

    it('opens a custom dropdown and picks one of its options', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const steps = [
        normalizeUiStep({ type: 'navigate', value: `${url}dropdown` }),
        normalizeUiStep({
          type: 'pickOption',
          selectors: ['role=combobox[name="Peran *"]'],
          pick: { mode: 'random', saveAs: 'peran' },
        }),
        normalizeUiStep({ type: 'assertText', selectors: ['#role'], value: '{{peran}}' }),
        normalizeUiStep({ type: 'click', selectors: ['#save'] }),
      ];
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Role', startUrl: `${url}dropdown`, steps }, projectId),
      );
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id, { headless: true }).id)!;
      assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => s.error ?? s.detail)));
      assert.match(
        run.steps[1].detail!,
        /^Picked "(Super Admin|Admin|Finance|Sales)" · saved as \{\{peran\}\}$/,
      );
      assert.equal(run.steps[1].usedSelector, 'role=combobox[name="Peran *"] → option');
    });

    it('picks a specific option by its exact text ("Admin", not "Super Admin")', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const role = (text: string) =>
        normalizeUiStep({
          type: 'pickOption',
          selectors: ['role=combobox[name="Peran *"]'],
          pick: { mode: 'named', text },
          timeoutMs: 1000,
        });
      const steps = [
        normalizeUiStep({ type: 'navigate', value: `${url}dropdown` }),
        role('admin'),
        normalizeUiStep({ type: 'assertText', selectors: ['#role'], value: 'Admin' }),
        role('Owner'),
      ];
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Admin', startUrl: `${url}dropdown`, steps }, projectId),
      );
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id).id)!;
      assert.deepEqual(
        run.steps.map((s) => s.status),
        ['passed', 'passed', 'passed', 'failed'],
      );
      assert.equal(run.steps[1].detail, 'Picked "Admin"');
      assert.match(
        run.steps[3].error!,
        /No option named "Owner"\. Options shown: Super Admin, Admin, Finance, Sales/,
      );
      assert.throws(
        () => normalizeUiStep({ type: 'pickOption', selectors: ['x'], pick: { mode: 'named' } }),
        /option to pick/,
      );
    });

    it('checks that every row contains a text (waiting for filtered rows to load)', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const each = (value: string) =>
        normalizeUiStep({ type: 'assertEach', selectors: ['table tbody tr'], value, timeoutMs: 2000 });
      const steps = [
        normalizeUiStep({ type: 'navigate', value: `${url}table` }),
        each('MAXXI'),
        normalizeUiStep({ type: 'click', selectors: ['#jatim'] }),
        each('JATIM'),
        each('MAXXI BLITAR'),
      ];
      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Rows', startUrl: `${url}table`, steps }, projectId),
      );
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id).id)!;
      assert.deepEqual(
        run.steps.map((s) => s.status),
        ['passed', 'passed', 'passed', 'passed', 'failed'],
        JSON.stringify(run.steps.map((s) => s.error ?? s.detail)),
      );
      assert.equal(run.steps[1].detail, 'All 2 rows contain "MAXXI"');
      assert.equal(
        run.steps[3].detail,
        'All 2 rows contain "JATIM"',
        'waits for the filtered rows; not case-sensitive',
      );
      assert.match(
        run.steps[4].error!,
        /^1 of 2 rows do not contain "MAXXI BLITAR", e\.g\. "Ade JATIM MAXXI NGAWI"/,
      );

      const empty = repos.uiTests.save(
        normalizeUiTest(
          {
            name: 'Empty',
            startUrl: `${url}table`,
            steps: [steps[0], normalizeUiStep({ type: 'click', selectors: ['#empty'] }), each('JATIM')],
          },
          projectId,
        ),
      );
      const emptyRun = await service.wait(service.start(empty.id).id)!;
      assert.match(emptyRun.steps[2].error!, /No rows were shown/);
    });

    it('sets a value once per run and reuses it in later values and selectors', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const steps = [
        normalizeUiStep({ type: 'navigate', value: url }),
        normalizeUiStep({
          type: 'setVariable',
          saveAs: '{{email}}',
          value: 'qa.{{random_letters}}@example.com',
        }),
        normalizeUiStep({ type: 'fill', selectors: ['#email'], value: '{{email}}' }),
        normalizeUiStep({ type: 'click', selectors: ['[data-testid="submit"]'] }),
        normalizeUiStep({ type: 'assertVisible', selectors: ['text=Welcome {{email}}'] }),
      ];
      assert.equal(steps[1].saveAs, 'email', 'curly braces are stripped from the name');
      const test = repos.uiTests.save(normalizeUiTest({ name: 'Vars', startUrl: url, steps }, projectId));
      const service = new UiRunService(repos);
      const first = await service.wait(service.start(test.id).id)!;
      const second = await service.wait(service.start(test.id).id)!;
      for (const run of [first, second])
        assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => s.error ?? s.detail)));
      const value = (run: typeof first) => run.steps[1].detail!.match(/"(.+)"/)![1];
      assert.match(value(first), /^qa\.[A-Z]{5}@example\.com$/);
      assert.notEqual(value(first), value(second), 'each run gets a new value');
      assert.throws(() => normalizeUiStep({ type: 'setVariable', value: 'x' }), /variable name/);
    });

    it('runs selected UI tests one after another (bulk run)', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const make = (name: string, steps: unknown[]) =>
        repos.uiTests.save(normalizeUiTest({ name, startUrl: url, steps }, projectId));
      const open = { type: 'navigate', value: url };
      const a = make('A', [open, { type: 'assertVisible', selectors: ['#email'] }]);
      const b = make('B', [open, { type: 'assertVisible', selectors: ['[data-testid="submit"]'] }]);
      const empty = make('Empty', []);
      const service = new UiRunService(repos);
      const result = service.startBatch(projectId, [a.id, b.id, empty.id, 'uit_other'], { headless: true });
      assert.deepEqual(
        result.queued.map((t) => t.name),
        ['A', 'B'],
      );
      assert.deepEqual(
        result.skipped.map((t) => t.name),
        ['Empty'],
      );

      const deadline = Date.now() + 30_000;
      let runs = repos.uiRuns.recent({ projectId });
      while ((runs.length < 2 || runs.some((r) => r.status === 'running')) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        runs = repos.uiRuns.recent({ projectId });
      }
      const [second, first] = runs; // terbaru dulu
      assert.deepEqual([first.testName, second.testName], ['A', 'B']);
      assert.ok(
        runs.every((r) => r.status === 'passed'),
        JSON.stringify(runs.map((r) => r.failureReason)),
      );
      assert.ok(
        second.startedAt >= first.finishedAt!,
        'the next test starts after the previous one finished',
      );
    });

    it('runs an API scenario inside a UI test and passes variables both ways', async () => {
      // "Aplikasi mobile" palsu: POST /orders → { id: "ORD-7" }; /fail → 500.
      const requests: { url: string; body: unknown }[] = [];
      const mobileApi = {
        async send(request: { url: string; body?: unknown }) {
          requests.push({ url: request.url, body: request.body });
          const fail = request.url.endsWith('/fail');
          return {
            status: fail ? 500 : 201,
            statusText: fail ? 'Internal Server Error' : 'Created',
            headers: { 'content-type': 'application/json' },
            body: fail ? { error: 'boom' } : { id: 'ORD-7' },
            sizeBytes: 20,
            durationMs: 5,
          };
        },
      };
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, mobileApi as never, null);
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const env = repos.environments.save(
        normalizeEnvironment({ name: 'Dev', baseUrl: 'http://mobile-api' }, projectId),
      );
      const api = (name: string, path: string) =>
        repos.apis.save(normalizeApi({ name, method: 'POST', path }, projectId));
      const scenario = (name: string, apiId: string) =>
        repos.scenarios.save(
          normalizeScenario(
            {
              name,
              steps: [
                {
                  type: 'api',
                  name: 'Create order',
                  apiId,
                  bodyMode: 'json',
                  bodyJson: '{"customer":"{{customer}}"}',
                  captures: [{ field: 'id', variable: 'order_id' }],
                  assertions: [{ kind: 'status', operator: 'equals', expected: '201' }],
                },
              ],
            },
            projectId,
          ),
        );
      const mobile = scenario('Mobile: create order', api('Create order', '/orders').id);
      const broken = scenario('Mobile: broken', api('Broken', '/fail').id);
      const steps = (scenarioId: string) => [
        normalizeUiStep({ type: 'navigate', value: url }),
        normalizeUiStep({ type: 'setVariable', saveAs: 'customer', value: 'Budi' }),
        normalizeUiStep({ type: 'apiScenario', apiScenarioId: scenarioId }),
        normalizeUiStep({ type: 'fill', selectors: ['#email'], value: '{{order_id}}@example.com' }),
        normalizeUiStep({ type: 'click', selectors: ['[data-testid="submit"]'] }),
        normalizeUiStep({ type: 'assertText', selectors: ['#out'], value: 'Welcome ORD-7@example.com' }),
      ];

      const test = repos.uiTests.save(
        normalizeUiTest({ name: 'Cross platform', startUrl: url, steps: steps(mobile.id) }, projectId),
      );
      const run = await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { environmentId: env.id }).id)!;
      assert.equal(run.status, 'passed', JSON.stringify(run.steps.map((s) => s.error ?? s.detail)));
      assert.equal(
        run.steps[2].detail,
        'API scenario "Mobile: create order" passed · 1 step · saved {{order_id}}',
      );
      assert.deepEqual(
        requests[0],
        { url: 'http://mobile-api/orders', body: { customer: 'Budi' } },
        'UI variables reach the API',
      );
      const apiRun = repos.runs.get(run.steps[2].apiRunId!)!;
      assert.equal(apiRun.status, 'passed');
      assert.equal(apiRun.mode, 'From UI test "Cross platform"', 'kept in Test Runs for debugging');

      const failing = repos.uiTests.save(
        normalizeUiTest({ name: 'Broken flow', startUrl: url, steps: steps(broken.id) }, projectId),
      );
      const failed = await ctx.uiRuns.wait(ctx.uiRuns.start(failing.id, { environmentId: env.id }).id)!;
      assert.deepEqual(
        failed.steps.map((s) => s.status),
        ['passed', 'passed', 'failed', 'skipped', 'skipped', 'skipped'],
      );
      assert.match(failed.steps[2].error!, /API scenario "Mobile: broken" failed at "Create order"/);
      assert.ok(failed.steps[2].apiRunId, 'the failed API run can be opened');

      const noEnv = await ctx.uiRuns.wait(ctx.uiRuns.start(test.id).id)!;
      assert.match(noEnv.steps[2].error!, /Choose an environment/);
    });

    it('runs a named Test Scheduler schedule when it is due and records its summary', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, undefined as never, null);
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const make = (name: string, selector: string) =>
        repos.uiTests.save(
          normalizeUiTest(
            {
              name,
              startUrl: url,
              steps: [
                { type: 'navigate', value: url },
                { type: 'assertVisible', selectors: [selector] },
              ],
            },
            projectId,
          ),
        );
      const login = make('Login page', '#email');
      const submit = make('Submit button', '[data-testid="submit"]');
      const schedule = repos.uiSchedules.save(
        ctx.uiSchedules.plan(
          normalizeUiSchedule(
            {
              name: 'Smoke Test',
              testIds: [login.id, submit.id, 'uit_deleted'],
              frequency: 'daily',
              time: '06:00',
            },
            projectId,
          ),
        ),
      );
      assert.ok(schedule.nextRunAt, 'the next run is planned');
      assert.throws(
        () => normalizeUiSchedule({ name: 'Empty', testIds: [] }, projectId),
        /at least one UI test/,
      );

      ctx.uiSchedules.runDue(new Date(Date.parse(schedule.nextRunAt!) + 1000));
      const deadline = Date.now() + 30_000;
      while (!repos.uiSchedules.get(schedule.id)!.lastBatch?.finishedAt && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 200));

      const after = repos.uiSchedules.get(schedule.id)!;
      assert.equal(after.lastBatch?.total, 2, 'deleted tests are skipped');
      assert.equal(after.lastBatch?.passed, 2);
      assert.ok(Date.parse(after.nextRunAt!) > Date.parse(schedule.nextRunAt!), 'moved to the next day');
      const runs = repos.uiRuns.recent({ projectId });
      assert.deepEqual(runs.map((r) => [r.testName, r.trigger, r.scheduleName]).reverse(), [
        ['Login page', 'schedule', 'Smoke Test'],
        ['Submit button', 'schedule', 'Smoke Test'],
      ]);
    });

    it('fails with a clear message and skips the rest when the page changed', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const steps = [
        normalizeUiStep({ type: 'navigate', value: url }),
        normalizeUiStep({ type: 'click', selectors: ['#missing-button'], timeoutMs: 800 }),
        normalizeUiStep({ type: 'click', selectors: ['[data-testid="submit"]'] }),
      ];
      const test = repos.uiTests.save(normalizeUiTest({ name: 'Broken', startUrl: url, steps }, projectId));
      const service = new UiRunService(repos);
      const run = await service.wait(service.start(test.id).id)!;
      assert.equal(run.status, 'failed');
      assert.deepEqual(
        run.steps.map((s) => s.status),
        ['passed', 'failed', 'skipped'],
      );
      assert.match(run.steps[1].error!, /Could not find the element/);
      assert.match(run.failureReason!, /Step 2/);
    });

    it('ignores clicks on the empty part of a big card, and names rows with a badge by their text', async () => {
      const events: Record<string, unknown>[] = [];
      const context = await browser.newContext();
      await context.exposeBinding(RECORDER_BINDING, (_s, event) => {
        if (!String(event.type).startsWith('__')) events.push(event);
        return events.length;
      });
      await context.addInitScript(RECORDER_SCRIPT);
      const page = await context.newPage();
      await page.goto(`${url}card`);
      await page.locator('#card').click({ position: { x: 450, y: 250 } }); // area kosong kartu
      await page.getByText('Super Admin Sistem').click();
      await page.waitForTimeout(200);
      await context.close();
      assert.equal(events.length, 1, JSON.stringify(events.map((e) => e.description)));
      const selectors = events[0].selectors as string[];
      assert.match(
        selectors[0],
        /^(tr|span):has-text\("Super Admin Sistem"\)$/,
        'a text selector, not only a row position',
      );
    });

    it('records each keyword typed into a live search field as its own step', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, undefined as never);
      try {
        const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
        const session = await ctx.recorder.start(projectId, { name: 'Search', startUrl: `${url}search` });
        const page = ctx.recorder.get(session.id).page!;
        const search = page.getByRole('searchbox', { name: 'Cari peran' });
        await search.pressSequentially('Admin', { delay: 40 }); // hasil muncul, tanpa klik apa pun
        await page.waitForTimeout(1300);
        await search.press('ControlOrMeta+a');
        await search.pressSequentially('Sales', { delay: 40 });
        await page.waitForTimeout(1300);
        await search.pressSequentially(' Sup', { delay: 40 }); // "Sales Sup" = lanjutan kata yang sama
        await page.waitForTimeout(1300);
        const saved = await ctx.recorder.save(session.id, {});
        assert.deepEqual(
          saved.steps.map((s) => [s.type, s.value]),
          [
            ['navigate', `${url}search`],
            ['fill', 'Admin'],
            ['fill', 'Sales Sup'],
          ],
        );
      } finally {
        await ctx.recorder.closeAll();
      }
      // Aturan penggabungan isian di field yang sama.
      assert.equal(continuesTyping('', 'Admin'), true);
      assert.equal(continuesTyping('Adm', 'Admin'), true, 'typing on');
      assert.equal(continuesTyping('Budi Santoso', 'Budi Santosa'), true, 'a correction');
      assert.equal(continuesTyping('Admin', 'Sales'), false, 'a new keyword');
      assert.equal(continuesTyping('Sales', 'Super Admin'), false);
      assert.equal(continuesTyping('Admin', ''), false, 'clearing the field is kept as a step');
    });

    it('records the page after login, not the login page, when the app redirects to /login itself', async () => {
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, undefined as never);
      try {
        const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
        const session = await ctx.recorder.start(projectId, {
          name: 'SPA login',
          startUrl: `${url}spa`,
          login: { username: 'qa@example.com', password: 'secret-pw' },
        });
        assert.equal(session.error, undefined, session.error);
        const check = session.steps.find((s) => s.type === 'assertUrl');
        assert.equal(check?.value, '/spa/app/home', 'the check proves the user left the login page');
      } finally {
        await ctx.recorder.closeAll();
      }
    });

    it('signs in automatically before recording and keeps the login as replayable steps', async () => {
      const app = express();
      app.use('/demo-web', demoWeb());
      const demo = app.listen(0, '127.0.0.1');
      await new Promise((r) => demo.once('listening', r));
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, undefined as never);
      try {
        const startUrl = `http://127.0.0.1:${(demo.address() as AddressInfo).port}/demo-web/login`;
        const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;

        const wrong = await ctx.recorder.start(projectId, {
          name: 'Wrong password',
          startUrl,
          login: { username: 'qa@example.com', password: 'nope' },
        });
        assert.equal(wrong.status, 'recording', 'recording still starts');
        assert.match(wrong.error!, /login form is still shown/);
        assert.equal(wrong.steps.length, 1, 'failed sign-in adds no steps');
        await ctx.recorder.cancel(wrong.id);

        const session = await ctx.recorder.start(projectId, {
          name: 'Signed in',
          startUrl,
          login: { username: 'qa@example.com', password: DEMO_WEB_PASSWORD },
        });
        assert.equal(session.status, 'recording');
        assert.equal(session.error, undefined);
        assert.deepEqual(
          session.steps.map((s) => s.type),
          ['navigate', 'fill', 'fill', 'click', 'assertUrl'],
        );
        const [, user, password, submit, check] = session.steps;
        assert.equal(user.selectors[0], '[data-testid="email"]');
        assert.equal(user.value, 'qa@example.com');
        assert.equal(password.sensitive, true);
        assert.equal(password.value, SECRET_MASK, 'the password never reaches the UI');
        assert.match(submit.description, /Sign in/);
        assert.equal(check.value, '/demo-web/shop');
        assert.match(ctx.recorder.get(session.id).page!.url(), /\/demo-web\/shop/, 'the window is signed in');

        const test = await ctx.recorder.save(session.id, {});
        assert.equal(test.steps[2].value, DEMO_WEB_PASSWORD, 'the real value is stored for replay');
        const run = await ctx.uiRuns.wait(ctx.uiRuns.start(test.id).id)!;
        assert.equal(run.status, 'passed', JSON.stringify(run.steps.find((s) => s.status === 'failed')));
      } finally {
        await ctx.recorder.closeAll();
        demo.close();
      }
    });

    it('remembers the start URL and login as environment variables for the next recordings', async () => {
      const app = express();
      app.use('/demo-web', demoWeb());
      const demo = app.listen(0, '127.0.0.1');
      await new Promise((r) => demo.once('listening', r));
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, undefined as never);
      try {
        const startUrl = `http://127.0.0.1:${(demo.address() as AddressInfo).port}/demo-web/login`;
        const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
        const env = repos.environments.save(
          normalizeEnvironment(
            { name: 'Dev', baseUrl: 'http://api', variables: [{ key: 'WEB_URL', value: 'http://old' }] },
            projectId,
          ),
        );
        const session = await ctx.recorder.start(projectId, {
          name: 'Remembered',
          startUrl,
          environmentId: env.id,
          login: { username: 'qa@example.com', password: DEMO_WEB_PASSWORD },
          remember: { url: true, user: true, password: true },
        });
        assert.equal(session.error, undefined);
        assert.equal(session.startUrl, '{{WEB_URL}}');
        const saved = repos.environments.get(env.id)!;
        assert.deepEqual(
          saved.variables.map((v) => [v.key, v.value, v.secret]),
          [
            ['WEB_URL', startUrl, false],
            ['WEB_USER', 'qa@example.com', false],
            ['WEB_PASSWORD', DEMO_WEB_PASSWORD, true],
          ],
        );
        const test = await ctx.recorder.save(session.id, {});
        assert.deepEqual(
          test.steps.slice(0, 3).map((s) => s.value),
          ['{{WEB_URL}}', '{{WEB_USER}}', '{{WEB_PASSWORD}}'],
          'the test uses the variables, not the typed values',
        );
        assert.equal(test.startUrl, '{{WEB_URL}}');
        const run = await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { environmentId: env.id }).id)!;
        assert.equal(run.status, 'passed', JSON.stringify(run.steps.find((s) => s.status === 'failed')));

        // Tanpa environment tidak ada tempat menyimpan.
        await assert.rejects(
          ctx.recorder.start(projectId, { name: 'X', startUrl, remember: { url: true } }),
          /Choose an environment/,
        );
      } finally {
        await ctx.recorder.closeAll();
        demo.close();
      }
    });

    it('runs the bundled demo shop test end to end', async () => {
      const app = express();
      app.use('/demo-web', demoWeb());
      const demo = app.listen(0, '127.0.0.1');
      await new Promise((r) => demo.once('listening', r));
      try {
        const base = `http://127.0.0.1:${(demo.address() as AddressInfo).port}`;
        const repos = createRepositories(openDatabase(':memory:'));
        const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
        const test = repos.uiTests.save(normalizeUiTest(demoUiTestInput(base), projectId));
        const service = new UiRunService(repos);
        const run = await service.wait(service.start(test.id).id)!;
        assert.equal(run.status, 'passed', JSON.stringify(run.steps.find((s) => s.status === 'failed')));
        assert.equal(run.counts.passed, test.steps.length);
      } finally {
        demo.close();
      }
    });
  },
);
