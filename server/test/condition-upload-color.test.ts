/**
 * Langkah kondisional & web baru:
 * - "Bila gagal, akhiri test sebagai lulus" (mis. tab kosong = tidak ada yang dites)
 * - "Upload file" (berkas contoh sesuai atribut accept, input boleh tersembunyi)
 * - "Check element color" (status merah, dll.)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { colorFamily } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `cond-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');
const { executeUiStep } = await import('../src/engine/ui/step-executor');
const { variableResolver } = await import('../src/engine/ui/environment');

const resolve = () =>
  variableResolver({
    id: '',
    projectId: '',
    name: '',
    baseUrl: '',
    variables: [],
    headers: [],
    timeoutMs: 1000,
    verifySsl: true,
    proxy: '',
    createdAt: '',
    updatedAt: '',
  } as never);

describe('Color families', () => {
  it('classifies text and pale badge backgrounds', () => {
    assert.equal(colorFamily('rgb(220, 38, 38)'), 'red');
    assert.equal(colorFamily('rgb(254, 226, 226)'), 'red', 'pale red badge background');
    assert.equal(colorFamily('rgb(185, 28, 28)'), 'red');
    assert.equal(colorFamily('rgb(22, 163, 74)'), 'green');
    assert.equal(colorFamily('rgb(234, 88, 12)'), 'orange');
    assert.equal(colorFamily('rgb(37, 99, 235)'), 'blue');
    assert.equal(colorFamily('rgb(107, 114, 128)'), 'gray');
    assert.equal(colorFamily('rgba(0, 0, 0, 0)'), null);
  });
});

describe('Upload file & Check element color (web)', () => {
  let browser: Browser;
  let page: Page;
  before(async () => {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    page = await browser.newPage();
  });
  after(async () => browser?.close());

  it('uploads a matching sample file into a hidden file input', async () => {
    await page.setContent(`
      <label>Surat Penarikan <button>Pilih Berkas</button><input type="file" aria-label="Surat Penarikan" accept="application/pdf" style="display:none"></label>
      <div id="ba">Berita Acara <input type="file" accept="image/png,image/jpeg" hidden></div>`);
    const r = resolve();
    const pdf = await executeUiStep(
      page,
      normalizeUiStep({
        type: 'uploadFile',
        selectors: ['[aria-label="Surat Penarikan"]'],
        value: 'surat-penarikan',
      }),
      r,
    );
    assert.equal(pdf.detail, 'Uploaded surat-penarikan.pdf');
    const png = await executeUiStep(page, normalizeUiStep({ type: 'uploadFile', selectors: ['#ba'] }), r);
    assert.match(
      png.detail ?? '',
      /Uploaded testora-sample\.png/,
      'the label/wrapper is followed to its file input',
    );
    const names = (await page.$$eval('input[type=file]', (els) =>
      els.map((e) => {
        const f = (e as unknown as { files: { name: string; size: number }[] }).files[0];
        return { name: f?.name, size: f?.size ?? 0 };
      }),
    )) as { name: string; size: number }[];
    assert.deepEqual(
      names.map((f) => f.name),
      ['surat-penarikan.pdf', 'testora-sample.png'],
    );
    assert.ok(names.every((f) => f.size > 0));
    assert.ok(fs.existsSync(path.join(os.tmpdir(), 'testora-sample-files', 'surat-penarikan.pdf')));
  });

  it('checks that a status is red (text or badge background) and explains a mismatch', async () => {
    await page.setContent(`
      <span id="text-red" style="color: rgb(220, 38, 38)">Di-blacklist</span>
      <span id="badge" style="background: rgb(254, 226, 226); color: rgb(153, 27, 27); padding: 2px">Di-blacklist</span>
      <span id="green" style="color: rgb(22, 163, 74)">Lunas</span>`);
    const r = resolve();
    for (const sel of ['#text-red', '#badge'])
      assert.equal(
        (
          await executeUiStep(
            page,
            normalizeUiStep({ type: 'assertColor', selectors: [sel], value: 'red' }),
            r,
          )
        ).detail,
        'Color is red',
      );
    await assert.rejects(
      executeUiStep(
        page,
        normalizeUiStep({ type: 'assertColor', selectors: ['#green'], value: 'red', timeoutMs: 500 }),
        r,
      ),
      /Expected red, but the text is green/,
    );
  });
});

describe('End the test as passed when a condition is not met', () => {
  it('skips the rest and counts the run as passed', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, {} as never, null);
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Only when there is data',
          target: 'mobile',
          mobile: { platform: 'android', app: '', appPackage: 'com.demo' },
          steps: [
            { type: 'assertVisible', selectors: ['text=Demo Shop'] },
            { type: 'assertVisible', selectors: ['text=No such row'], timeoutMs: 500, onFailPass: true },
            { type: 'click', selectors: ['~does-not-exist'] },
          ].map((s) => normalizeUiStep(s)),
        },
        projectId,
      ),
    );
    const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { mode: 'mock' }).id))!;
    assert.equal(run.status, 'passed', run.failureReason);
    assert.deepEqual(
      run.steps.map((s) => s.status),
      ['passed', 'skipped', 'skipped'],
    );
    assert.match(run.steps[1].error ?? '', /Condition not met, so the test ends here and counts as passed/);
    assert.match(run.steps[2].error ?? '', /test ended at step 2/);
  });
});
