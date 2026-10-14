/**
 * Utilitas murni (tanpa I/O) yang dipakai server dan web.
 */
import type { Assertion, Operator } from './types';
import { UNARY_OPERATORS } from './types';

/** Ambil nilai dengan dot notation: getByPath({a:{b:[1]}}, 'a.b.0') === 1 */
export function getByPath(source: unknown, path: string): unknown {
  if (!path) return source;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

/** Set nilai dengan dot notation, membuat object/array perantara bila perlu. */
export function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor: Record<string, unknown> = target;
  keys.slice(0, -1).forEach((key, i) => {
    const next = cursor[key];
    if (next === null || typeof next !== 'object') {
      cursor[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  });
  cursor[keys[keys.length - 1]] = value;
}

/** Ratakan object menjadi daftar [path, nilai] untuk daun (leaf). */
export function flattenObject(
  source: unknown,
  prefix = '',
  out: [string, unknown][] = [],
): [string, unknown][] {
  if (source !== null && typeof source === 'object') {
    const entries = Array.isArray(source)
      ? source.map((v, i) => [String(i), v] as const)
      : Object.entries(source as Record<string, unknown>);
    if (entries.length === 0 && prefix) out.push([prefix, source]);
    entries.forEach(([k, v]) => flattenObject(v, prefix ? `${prefix}.${k}` : k, out));
  } else if (prefix) {
    out.push([prefix, source]);
  }
  return out;
}

export function displayValue(value: unknown): string {
  if (value === undefined) return '(missing)';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const isNumeric = (v: unknown) => v !== '' && v !== null && v !== undefined && !Number.isNaN(Number(v));
const isEmptyValue = (s: string, raw: unknown) =>
  raw === null || raw === undefined || s === '' || s === '[]' || s === '{}';

/** Evaluasi operator perbandingan. Angka dibandingkan secara numerik bila keduanya numerik. */
export function compareValues(actual: unknown, operator: Operator, expected: string): boolean {
  const text =
    actual === null || actual === undefined
      ? ''
      : typeof actual === 'object'
        ? JSON.stringify(actual)
        : String(actual);
  const numeric = isNumeric(actual) && isNumeric(expected);
  switch (operator) {
    case 'equals':
      return numeric ? Number(actual) === Number(expected) : text === expected;
    case 'not equals':
      return numeric ? Number(actual) !== Number(expected) : text !== expected;
    case 'contains':
      return text.includes(expected);
    case 'not contains':
      return !text.includes(expected);
    case 'starts with':
      return text.startsWith(expected);
    case 'ends with':
      return text.endsWith(expected);
    case 'greater than':
      return Number(actual) > Number(expected);
    case 'less than':
      return Number(actual) < Number(expected);
    case 'greater/equal':
      return Number(actual) >= Number(expected);
    case 'less/equal':
      return Number(actual) <= Number(expected);
    case 'exists':
      return actual !== undefined;
    case 'not exists':
      return actual === undefined;
    case 'is empty':
      return isEmptyValue(text, actual);
    case 'is not empty':
      return !isEmptyValue(text, actual);
    case 'matches regex':
      try {
        return new RegExp(expected).test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Kalimat yang mudah dibaca untuk sebuah assertion, dipakai di UI dan laporan. */
export function describeAssertion(a: Pick<Assertion, 'kind' | 'field' | 'operator' | 'expected'>): string {
  const expected = UNARY_OPERATORS.includes(a.operator) ? '' : ` ${a.expected === '' ? '""' : a.expected}`;
  switch (a.kind) {
    case 'status':
      return `Status code ${a.operator}${expected}`;
    case 'time':
      return `Response time ${a.operator}${expected} ms`;
    case 'schema':
      return `Response has fields: ${a.expected || '—'}`;
    default:
      return `${a.field || '(field)'} ${a.operator}${expected}`;
  }
}

/** Ekstrak nama variabel {{nama}} dari teks apa pun. */
export function extractVariables(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);
}

/** Nama parameter pada path, mis. /orders/{order_id} -> ['order_id'] */
export function pathParameters(path: string): string[] {
  return (path.match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
}

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${random}`;
}

/** Total durasi (detik) dari daftar stage performance test. */
export const totalStageSeconds = (stages: { durationSec: number }[]) =>
  stages.reduce((sum, s) => sum + Math.max(0, s.durationSec), 0);

/**
 * Jumlah VU target pada detik ke-`elapsedSec`. Setiap stage naik/turun linear
 * dari target stage sebelumnya (mulai dari 0) ke `targetVus`-nya.
 */
export function targetVusAt(
  stages: { durationSec: number; targetVus: number }[],
  elapsedSec: number,
): number {
  let start = 0;
  let from = 0;
  for (const stage of stages) {
    const end = start + stage.durationSec;
    if (elapsedSec < end) {
      const progress = stage.durationSec > 0 ? (elapsedSec - start) / stage.durationSec : 1;
      return Math.round(from + (stage.targetVus - from) * progress);
    }
    start = end;
    from = stage.targetVus;
  }
  return 0;
}

/** Jumlah virtual user tertinggi pada profil beban (0 bila tidak ada stage). */
export const peakVus = (stages: { targetVus: number }[]) => Math.max(0, ...stages.map((s) => s.targetVus));
