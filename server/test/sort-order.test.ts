/**
 * Step "Check sort order": nilai tanggal / nominal pada daftar harus berurutan
 * (mis. urutan piutang "Jatuh tempo terdekat" dan "Nilai piutang terbesar").
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkSortOrder, parseSortOrder, sortableValue } from '@flowqa/shared';

const { assertNotVisible, assertSorted } = await import('../src/engine/ui/step-executor');
const { normalizeUiStep } = await import('../src/domain/normalizers');

describe('Check sort order', () => {
  it('reads Indonesian dates and Rupiah amounts', () => {
    assert.deepEqual(sortableValue('5 Okt 2026'), { kind: 'date', value: Date.UTC(2026, 9, 5) });
    assert.deepEqual(sortableValue('17 Agu 2026'), { kind: 'date', value: Date.UTC(2026, 7, 17) });
    assert.deepEqual(sortableValue('05/10/2026'), { kind: 'date', value: Date.UTC(2026, 9, 5) });
    assert.deepEqual(sortableValue('Rp 195.000.000'), { kind: 'number', value: 195_000_000 });
    assert.deepEqual(sortableValue('Rp 1.500,50'), { kind: 'number', value: 1500.5 });
    assert.deepEqual(sortableValue('1,500.25'), { kind: 'number', value: 1500.25 });
    assert.equal(sortableValue('Riwayat angsuran'), null);
  });

  it('accepts several ways to write the order', () => {
    assert.equal(parseSortOrder('asc'), 'ascending');
    assert.equal(parseSortOrder('Terdekat'), 'ascending');
    assert.equal(parseSortOrder('descending'), 'descending');
    assert.equal(parseSortOrder('terbesar'), 'descending');
    assert.equal(parseSortOrder('random'), null);
  });

  it('checks the order and points at the first item out of place', () => {
    assert.ok(checkSortOrder(['3 Sep 2026', '3 Sep 2026', '5 Okt 2026'], 'ascending').ok);
    assert.ok(checkSortOrder(['Rp 195.000.000', 'Rp 20.000.000', 'Rp 9.500.000'], 'descending').ok);
    const bad = checkSortOrder(['Rp 20.000.000', 'Sisa piutang', 'Rp 195.000.000'], 'descending');
    assert.equal(bad.ok, false);
    assert.deepEqual(bad.values, ['Rp 20.000.000', 'Rp 195.000.000']);
    assert.equal(bad.brokenAt, 1);
  });

  it('waits until the list is re-sorted, and fails with the values shown', async () => {
    let calls = 0;
    const lists = [['Rp 1.000', 'Rp 5.000'], ['Rp 5.000', 'Rp 1.000']];
    const ok = await assertSorted(['x'], 'descending', 2_000, async () => lists[Math.min(calls++, 1)]);
    assert.match(ok.detail ?? '', /2 values are descending: Rp 5\.000 → Rp 1\.000/);
    await assert.rejects(
      assertSorted(['x'], 'ascending', 0, async () => ['10 Okt 2026', '5 Okt 2026']),
      /Not ascending: "5 Okt 2026" comes after "10 Okt 2026"/,
    );
    await assert.rejects(assertSorted(['x'], 'ascending', 0, async () => []), /No dates or numbers/);
    await assert.rejects(assertSorted(['x'], 'sideways', 0, async () => []), /ascending or descending/);
  });

  it('is a valid step for web and mobile tests', () => {
    const step = normalizeUiStep({ type: 'assertSorted', selectors: ['text*=Rp'], value: 'descending' });
    assert.equal(step.type, 'assertSorted');
    assert.equal(step.description, 'Check sort order');
  });

  it('"Check element is not visible" waits until the element is gone', async () => {
    let calls = 0;
    const gone = await assertNotVisible(['text=Terbayar'], 2_000, async () => (calls++ < 2 ? ['Terbayar'] : []));
    assert.equal(gone.detail, 'Not shown');
    await assert.rejects(
      assertNotVisible(['text=Terbayar'], 0, async () => ['Terbayar', 'Terbayar']),
      /2 matching elements are still shown \(text=Terbayar, e\.g\. "Terbayar"\)/,
    );
    await assert.rejects(assertNotVisible([], 0, async () => []), /no element selector/);
  });
});
