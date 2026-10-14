/**
 * Generator nilai dinamis: {{random_email}}, {{uuid}}, dst.
 * Setiap kemunculan menghasilkan nilai baru.
 */
import { randomUUID } from 'node:crypto';
import type { DynamicVariableKey } from '@flowqa/shared';

const FIRST_NAMES = [
  'Andi',
  'Siti',
  'Budi',
  'Dewi',
  'Rizky',
  'Putri',
  'Agus',
  'Maya',
  'Yusuf',
  'Lina',
  'Hendra',
  'Ayu',
];
const LAST_NAMES = ['Santoso', 'Wijaya', 'Pratama', 'Kusuma', 'Hidayat', 'Saputra', 'Lestari', 'Nugroho'];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const randomLetters = (n: number) =>
  Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
const randomDigits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

const randomString = (n: number) =>
  Array.from(
    { length: n },
    () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');

/**
 * Koordinat acak di wilayah daratan utama Indonesia (Sumatra–Papua), 6 desimal.
 * Kotak batas: lintang −8.5…5.5, bujur 95.5…140.5.
 */
const LAT = { min: -8.5, max: 5.5 };
const LNG = { min: 95.5, max: 140.5 };
const between = (min: number, max: number) => min + Math.random() * (max - min);
const coord = (n: number) => Number(n.toFixed(6));

/**
 * Poligon cembung acak (±50–150 m) sebagai ring GeoJSON tertutup:
 * [[lng,lat], …, [lng,lat] titik pertama diulang]. Setiap run berbeda.
 */
export function randomPolygon(points = 4 + Math.floor(Math.random() * 3)): string {
  const lat = between(LAT.min, LAT.max);
  const lng = between(LNG.min, LNG.max);
  const metersToLat = 1 / 111_320;
  const metersToLng = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const angles = Array.from(
    { length: points },
    (_, i) => ((i + 0.2 + Math.random() * 0.6) / points) * Math.PI * 2,
  ).sort((a, b) => a - b);
  const ring = angles.map((a) => {
    const r = 50 + Math.random() * 100;
    return [coord(lng + Math.cos(a) * r * metersToLng), coord(lat + Math.sin(a) * r * metersToLat)];
  });
  return JSON.stringify([...ring, ring[0]]);
}

/** Nama bulan singkat Bahasa Indonesia (format aplikasi Alsintan: "Okt 2026"). */
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** Bulan (0-11) & tahun saat ini di zona waktu WIB. */
function jakartaNow(): { month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { month: get('month') - 1, year: get('year') };
}

export const dynamicGenerators: Record<DynamicVariableKey, () => string> = {
  random_name: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  random_email: () => `qa.${Math.random().toString(36).slice(2, 8)}@example.com`,
  random_phone: () => `08${1 + Math.floor(Math.random() * 8)}${randomDigits(9)}`,
  uuid: () => randomUUID(),
  random_number: () => String(Math.floor(Math.random() * 100_000)),
  random_letters: () => randomLetters(5),
  random_string: () => randomString(8),
  random_latitude: () => coord(between(LAT.min, LAT.max)).toString(),
  random_longitude: () => coord(between(LNG.min, LNG.max)).toString(),
  random_polygon: () => randomPolygon(),
  current_date: () => new Date().toISOString().slice(0, 10),
  current_month_id: () => BULAN[jakartaNow().month],
  current_year: () => String(jakartaNow().year),
  current_month_year_id: () => `${BULAN[jakartaNow().month]} ${jakartaNow().year}`,
  timestamp: () => String(Date.now()),
};
