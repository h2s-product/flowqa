/** Label & ambang yang dipakai di beberapa halaman. */
import type { ScheduleFrequency } from '@flowqa/shared';

export const SCHEDULE_FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  '15m': 'Every 15 minutes',
  '1h': 'Every hour',
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  weekly: 'Every week',
};

/** Nama hari untuk jadwal mingguan (0 = Minggu, sama seperti Date.getDay()). */
export const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Ringkasan jadwal yang mudah dibaca, mis. "Every Monday at 07:30". */
export function describeSchedule(s: { frequency: ScheduleFrequency; time: string; day?: number }): string {
  if (s.frequency === 'weekly') return `Every ${WEEK_DAYS[s.day ?? 1]} at ${s.time}`;
  const label = SCHEDULE_FREQUENCY_LABELS[s.frequency];
  return s.frequency === 'daily' || s.frequency === 'weekdays' ? `${label} at ${s.time}` : label;
}

export const FREQUENCY_OPTIONS = (Object.keys(SCHEDULE_FREQUENCY_LABELS) as ScheduleFrequency[]).map(
  (id) => ({
    id,
    label: SCHEDULE_FREQUENCY_LABELS[id],
  }),
);

/** Pass rate di atas ambang ini ditampilkan hijau, di bawahnya merah. */
export const PASS_RATE_TARGET = 85;
