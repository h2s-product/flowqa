/**
 * Analisa kegagalan step UI test: klasifikasi pesan error, kesimpulan sumber masalah,
 * dan bukti dari halaman sungguhan (menu tertutup, popup error aplikasi).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright-core';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `analysis-${process.pid}`, 'ui');
const { analyzeUiFailure, classifyUiFailure } = await import('../src/engine/ui/failure-analysis');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { createAppContext } = await import('../src/app-context');

const step = (input: Record<string, unknown>) =>
  normalizeUiStep({ description: 'Klik submenu "Tim Drone"', ...input });

describe('UI failure analysis (messages)', () => {
  it('classifies the step error messages', () => {
    const click = step({ type: 'click', selectors: ['#x'] });
    const cases: [string, string][] = [
      ['Could not find the element on the page within 10 s. Tried: #x', 'element-not-found'],
      ['The element exists but is not visible.', 'element-hidden'],
      ['Expected text "92", but the element shows "91".', 'text-mismatch'],
      ['2 of 5 rows do not contain "UTA", e.g. "Jatim Pusat - PST".', 'rows-mismatch'],
      ['No rows were shown (tried: tbody tr), so nothing could be checked.', 'no-rows'],
      ['1 matching element is still shown (.swal2-popup, e.g. "Gagal").', 'still-shown'],
      ['Expected the page URL to contain "/tim-drone", but it was https://x/login', 'url-mismatch'],
      ['Unknown variable {{kode}}. Add it to the environment "Dev", or save it …', 'missing-variable'],
      ['Could not open the page: net::ERR_NAME_NOT_RESOLVED at https://x', 'page-unreachable'],
      ['No option named "JATIM". Options shown: JABAR, BALI.', 'option-missing'],
      ['Not ascending: "3" comes after "5" (shown: 5 → 3).', 'not-sorted'],
      ['This step has no element selector.', 'step-config'],
      [
        'The page did not respond in time: Timeout 10000ms exceeded.\nCall log:\n  - <div class="overlay"></div> intercepts pointer events',
        'element-blocked',
      ],
      ['Timeout 5000ms exceeded.\n  - element is not enabled', 'element-disabled'],
    ];
    for (const [message, kind] of cases) assert.equal(classifyUiFailure(message, click), kind, message);
    assert.equal(
      classifyUiFailure(
        'The page did not respond in time: Timeout 30000ms exceeded.',
        step({ type: 'navigate', value: 'https://x' }),
      ),
      'page-timeout',
    );
  });

  it('explains a click on a link inside a collapsed menu whose opening step was skipped', () => {
    const analysis = analyzeUiFailure({
      step: step({ type: 'click', selectors: ['a[href="/tim-drone"]'] }),
      index: 7,
      error: 'The page did not respond in time: Timeout 10000ms exceeded.',
      target: 'web',
      evidence: {
        url: 'https://farm/butuh-ba',
        selectors: [{ selector: 'a[href="/tim-drone"]', count: 1, visible: 0 }],
      },
      skippedBefore: [
        {
          index: 6,
          description: 'Buka grup menu "Monitoring Operasional"',
          reason: 'Not needed: the condition of step 6 was not met',
        },
      ],
    });
    assert.equal(analysis.kind, 'element-hidden');
    assert.equal(analysis.likely, 'test-script');
    assert.match(analysis.title, /ada, tetapi tidak dapat dijangkau/);
    assert.match(analysis.summary, /1 cocok, 0 terlihat/);
    assert.match(
      analysis.causes[0],
      /^Step 7 \(“Buka grup menu "Monitoring Operasional"”\) tidak dijalankan karena kondisi di step 6 tidak terpenuhi\. Padahal saat gagal elemen yang dituju tidak terlihat/,
    );
    assert.ok(analysis.suggestions.some((s) => /kondisi/.test(s)));
  });

  it('blames the application when the page shows an error message', () => {
    const analysis = analyzeUiFailure({
      step: step({ type: 'assertVisible', description: 'Detail tampil', selectors: ['h1'] }),
      index: 3,
      error: 'Could not find the element on the page within 20 s. Tried: h1',
      target: 'web',
      evidence: {
        selectors: [{ selector: 'h1', count: 0, visible: 0 }],
        messages: ['Gagal Terjadi Kesalahan Pada System'],
      },
    });
    assert.equal(analysis.likely, 'application');
    assert.match(analysis.causes[0], /Gagal Terjadi Kesalahan Pada System/);
  });

  it('explains filter rows, text mismatches, missing variables and retries', () => {
    const rows = analyzeUiFailure({
      step: step({
        type: 'assertEach',
        description: 'Semua baris UTA',
        selectors: ['tbody tr'],
        value: 'UTA',
      }),
      index: 9,
      error: '2 of 5 rows do not contain "UTA", e.g. "Jatim Pusat - PST".',
      target: 'web',
      retries: 2,
    });
    assert.equal(rows.likely, 'application');
    assert.match(
      rows.summary,
      /2 dari 5 baris yang tampil tidak memuat “UTA”\. Contoh baris yang tidak sesuai: “Jatim Pusat - PST”/,
    );
    assert.match(rows.summary, /diulang 2 kali/);

    const text = analyzeUiFailure({
      step: step({ type: 'assertText', description: 'Total aktivitas', selectors: ['td'], value: '92' }),
      index: 4,
      error: 'Expected text "92", but the element shows "91".',
      target: 'web',
    });
    assert.match(text.summary, /mengharapkan teks “92”, tetapi yang tampil “91”/);

    const variable = analyzeUiFailure({
      step: step({ type: 'fill', selectors: ['#q'], value: '{{kode}}' }),
      index: 2,
      error: 'Unknown variable {{kode}}. Add it to the environment "Dev", or save it with an earlier step.',
      target: 'web',
    });
    assert.equal(variable.kind, 'missing-variable');
    assert.equal(variable.likely, 'test-script');
    assert.match(variable.title, /\{\{kode\}\} belum punya nilai/);
  });

  it('points mobile failures at the page source artifact', () => {
    const analysis = analyzeUiFailure({
      step: step({ type: 'click', selectors: ['~login'] }),
      index: 1,
      error: 'Could not find the element on the screen within 10 s. Tried: ~login',
      target: 'mobile',
    });
    assert.equal(analysis.kind, 'element-not-found');
    assert.ok(analysis.suggestions.some((s) => /Page source at failure/.test(s)));
  });
});

let chromeAvailable = true;
try {
  await (await chromium.launch({ channel: 'chrome', headless: true })).close();
} catch {
  chromeAvailable = false;
}

const MENU_PAGE = `<!doctype html><html><body>
<nav><button id="group">Monitoring Operasional</button>
  <div style="display:grid;grid-template-rows:0fr"><div style="overflow:hidden"><a href="/tim-drone">Tim Drone</a></div></div>
</nav><h1>Butuh BA</h1></body></html>`;
const ERROR_PAGE = `<!doctype html><html><body><h1>Detail</h1>
<div class="swal2-popup" style="display:block">Gagal Terjadi Kesalahan Pada System</div></body></html>`;

describe(
  'UI failure analysis (real page)',
  { skip: !chromeAvailable && 'Google Chrome is not installed' },
  () => {
    let server: http.Server;
    let url = '';
    before(async () => {
      server = http.createServer((req, res) =>
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(req.url === '/error' ? ERROR_PAGE : MENU_PAGE),
      );
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    });
    after(() => server?.close());

    const run = async (startUrl: string, steps: Record<string, unknown>[]) => {
      const repos = createRepositories(openDatabase(':memory:'));
      const ctx = createAppContext(repos, {} as never, null);
      const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
      const test = repos.uiTests.save(
        normalizeUiTest(
          { name: 'Analisa', startUrl, steps: steps.map((s) => normalizeUiStep(s)) },
          projectId,
        ),
      );
      return (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id).id))!;
    };

    it('finds the link inside the collapsed menu and the skipped step that should have opened it', async () => {
      const result = await run(url, [
        { type: 'navigate', value: url },
        // Seperti TC-0281 semula: link di menu tertutup tetap "terlihat" bagi Playwright → pembuka grup dilewati.
        {
          type: 'assertNotVisible',
          description: 'Cek submenu belum terlihat',
          selectors: ['a[href="/tim-drone"]'],
          timeoutMs: 500,
          onFailSkip: 1,
        },
        { type: 'click', description: 'Buka grup menu', selectors: ['#group'] },
        {
          type: 'click',
          description: 'Klik submenu "Tim Drone"',
          selectors: ['a[href="/tim-drone"]'],
          timeoutMs: 1500,
        },
      ]);
      assert.equal(result.status, 'failed');
      const failed = result.steps[3];
      assert.equal(failed.status, 'failed');
      const analysis = failed.analysis!;
      assert.ok(analysis, 'the failed step has an analysis');
      assert.equal(analysis.kind, 'element-hidden');
      assert.deepEqual(analysis.evidence?.selectors, [
        { selector: 'a[href="/tim-drone"]', count: 1, visible: 0 },
      ]);
      assert.equal(analysis.evidence?.url, url);
      assert.ok(
        analysis.causes.some((c) =>
          /^Step 3 \(“Buka grup menu”\) tidak dijalankan karena kondisi di step 2 \(“Cek submenu belum terlihat”\) menilai elemennya sudah tampil\. Padahal/.test(
            c,
          ),
        ),
      );
      assert.equal(result.steps[0].analysis, undefined, 'passed steps have no analysis');
    });

    it('reports the error message shown by the application', async () => {
      const result = await run(`${url}error`, [
        { type: 'navigate', value: `${url}error` },
        {
          type: 'assertVisible',
          description: 'Tab Informasi tampil',
          selectors: ['text=Informasi'],
          timeoutMs: 800,
        },
      ]);
      const analysis = result.steps[1].analysis!;
      assert.equal(analysis.kind, 'element-not-found');
      assert.equal(analysis.likely, 'application');
      assert.deepEqual(analysis.evidence?.messages, ['Gagal Terjadi Kesalahan Pada System']);
    });
  },
);
