/**
 * Step "Save element text": teks elemen disimpan sebagai {{variabel}} (opsional
 * dipotong dengan regex) dan bisa dipakai step berikutnya.
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { extractSavedText } from '@flowqa/shared';

process.env.FLOWQA_UI_ARTIFACTS = path.join(os.tmpdir(), `save-text-${process.pid}`, 'ui');
const { openDatabase } = await import('../src/db/database');
const { createRepositories } = await import('../src/repositories');
const { normalizeProject, normalizeUiStep, normalizeUiTest } = await import('../src/domain/normalizers');
const { createAppContext } = await import('../src/app-context');

describe('Save element text', () => {
  it('tidies the text and keeps only the regex group when given', () => {
    assert.equal(extractSavedText('  Abyasa   Nababan\n013-205-0309 '), 'Abyasa Nababan 013-205-0309');
    assert.equal(extractSavedText('Abyasa Nababan\n013-205-0309', '^(.+)$'), 'Abyasa Nababan', 'first line');
    assert.equal(
      extractSavedText('SC60.9 EXCAVATOR — Rp 655.000.000 · 01/M-SBY-0826-0018', '^(.+?) —'),
      'SC60.9 EXCAVATOR',
    );
    assert.equal(extractSavedText('PJB/123', '[0-9]+'), '123', 'whole match without a group');
    assert.equal(extractSavedText('Lunas', 'Berjalan'), null);
  });

  it('requires a variable name', () => {
    assert.throws(() => normalizeUiStep({ type: 'saveText', selectors: ['~x'] }), /variable name/);
  });

  it('saves a mobile element text and uses it in later steps', async () => {
    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, {} as never, null);
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Save text',
          target: 'mobile',
          mobile: { platform: 'android', app: '', appPackage: 'com.demo', noReset: false },
          steps: [
            { type: 'saveText', selectors: ['text=Demo Shop'], saveAs: 'judul' },
            { type: 'saveText', selectors: ['text=Demo Shop'], saveAs: 'kata_kedua', value: ' (\\w+)$' },
            { type: 'assertText', selectors: ['text={{judul}}'], value: '{{kata_kedua}}' },
          ].map((s) => normalizeUiStep(s)),
        },
        projectId,
      ),
    );
    const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { mode: 'mock' }).id))!;
    assert.equal(run.status, 'passed', JSON.stringify(run.steps, null, 1));
    assert.equal(run.steps[0].detail, '{{judul}} = "Demo Shop"');
    assert.equal(run.steps[1].detail, '{{kata_kedua}} = "Shop"');
    assert.equal(run.variables?.judul, 'Demo Shop');
  });

  it('with "skip values used before", each run picks a value no earlier run saved', async () => {
    const { firstUnused } = await import('@flowqa/shared');
    assert.equal(firstUnused(['A', 'B', 'C'], ['a ', 'B']), 'C');
    assert.equal(firstUnused(['A'], ['A']), undefined);

    const repos = createRepositories(openDatabase(':memory:'));
    const ctx = createAppContext(repos, {} as never, null);
    ctx.appium.save({ serverUrl: 'http://appium.invalid:4723', capabilities: '', defaultMode: 'mock' });
    const projectId = repos.projects.save(normalizeProject({ name: 'P' })).id;
    const mobile = { platform: 'android', app: '', appPackage: 'com.demo', noReset: false };
    const login = [
      { type: 'fill', selectors: ['id=com.demo:id/email'], value: 'qa@demo.test' },
      { type: 'fill', selectors: ['id=com.demo:id/password'], value: 'pw', sensitive: true },
      { type: 'click', selectors: ['~login'] },
    ];
    const test = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Pick an unused order',
          target: 'mobile',
          mobile,
          steps: [
            ...login,
            { type: 'saveText', selectors: ['id=com.demo:id/order'], saveAs: 'order', unique: true },
          ].map((s) => normalizeUiStep(s)),
        },
        projectId,
      ),
    );
    const pick = async () => {
      const run = (await ctx.uiRuns.wait(ctx.uiRuns.start(test.id, { mode: 'mock' }).id))!;
      assert.equal(run.status, 'passed', run.failureReason);
      return run;
    };
    const first = await pick();
    const second = await pick();
    assert.equal(first.variables?.order, 'Order 1 - Paid');
    assert.equal(second.variables?.order, 'Order 2 - Paid', 'the order saved by run 1 is skipped');
    assert.match(second.steps.at(-1)!.detail ?? '', /skipped 1 already used/);

    // Hanya satu kandidat dan sudah dipakai → gagal dengan pesan yang jelas.
    const single = repos.uiTests.save(
      normalizeUiTest(
        {
          name: 'Only one title',
          target: 'mobile',
          mobile,
          steps: [
            {
              type: 'saveText',
              selectors: ['text=Demo Shop'],
              saveAs: 'title',
              unique: true,
              timeoutMs: 1000,
            },
          ].map((s) => normalizeUiStep(s)),
        },
        projectId,
      ),
    );
    await ctx.uiRuns.wait(ctx.uiRuns.start(single.id, { mode: 'mock' }).id);
    const again = (await ctx.uiRuns.wait(ctx.uiRuns.start(single.id, { mode: 'mock' }).id))!;
    assert.equal(again.status, 'failed');
    assert.match(again.failureReason ?? '', /already used \(earlier runs/);
  });
});
