import type { ScheduleFrequency } from '@flowqa/shared';
import { Field } from '@/components/ui';
import { FREQUENCY_OPTIONS, WEEK_DAYS } from '@/lib/labels';

export interface ScheduleTiming {
  frequency?: ScheduleFrequency;
  time?: string;
  day?: number;
}

/** "How often" + jam + hari (untuk mingguan). Dipakai jadwal API Tester & Test Scheduler UI Tester. */
export function ScheduleTimingFields({
  value,
  onChange,
}: {
  value: ScheduleTiming;
  onChange: (patch: ScheduleTiming) => void;
}) {
  const needsTime =
    value.frequency === 'daily' || value.frequency === 'weekdays' || value.frequency === 'weekly';
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: value.frequency === 'weekly' ? '1fr 1fr 1fr' : '1fr 1fr' }}
    >
      <Field label="How often">
        <select
          className="in"
          value={value.frequency}
          onChange={(e) => {
            const frequency = e.target.value as ScheduleFrequency;
            onChange({ frequency, ...(frequency === 'weekly' && value.day === undefined ? { day: 1 } : {}) });
          }}
        >
          {FREQUENCY_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </Field>
      {value.frequency === 'weekly' && (
        <Field label="On">
          <select
            className="in"
            value={value.day ?? 1}
            onChange={(e) => onChange({ day: Number(e.target.value) })}
          >
            {WEEK_DAYS.map((day, i) => (
              <option key={day} value={i}>
                {day}
              </option>
            ))}
          </select>
        </Field>
      )}
      {needsTime && (
        <Field label="At (server time)">
          <input
            className="in"
            type="time"
            value={value.time}
            onChange={(e) => onChange({ time: e.target.value })}
          />
        </Field>
      )}
    </div>
  );
}
