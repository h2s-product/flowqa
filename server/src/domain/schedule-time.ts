import type { Schedule } from '@flowqa/shared';

/** Hitung waktu run berikutnya dari sebuah jadwal (berdasarkan waktu lokal server). */
export function computeNextRun(
  schedule: Pick<Schedule, 'frequency' | 'time' | 'day'>,
  from: Date = new Date(),
): string {
  const base = from.getTime();
  if (schedule.frequency === '15m') return new Date(base + 15 * 60_000).toISOString();
  if (schedule.frequency === '1h') return new Date(base + 60 * 60_000).toISOString();

  const [hours, minutes] = (schedule.time || '08:00').split(':').map(Number);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (next.getTime() <= base) next.setDate(next.getDate() + 1);
  if (schedule.frequency === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  }
  if (schedule.frequency === 'weekly') {
    const day = schedule.day ?? 1;
    while (next.getDay() !== day) next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}
