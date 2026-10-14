import { useState } from 'react';
import type { Schedule } from '@flowqa/shared';
import { useSaveSchedule, useScenarios } from '@/api/queries';
import { Modal } from '@/components/Modal';
import { Field } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ScheduleTimingFields } from './ScheduleTimingFields';

export function ScheduleFormModal({ schedule, onClose }: { schedule?: Schedule; onClose: () => void }) {
  const { projectId = '', environments, environment } = useWorkspace();
  const { data: scenarios = [] } = useScenarios(projectId);
  const save = useSaveSchedule(projectId);
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Schedule>>(
    schedule ?? {
      scenarioId: scenarios[0]?.id,
      environmentId: environment?.id,
      frequency: 'daily',
      time: '08:00',
      enabled: true,
    },
  );
  const set = (patch: Partial<Schedule>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () =>
    save.mutate(
      { ...draft, scenarioId: draft.scenarioId ?? scenarios[0]?.id },
      { onSuccess: () => (toast('Schedule saved'), onClose()) },
    );

  return (
    <Modal
      title={schedule ? 'Edit schedule' : 'New schedule'}
      subtitle="Runs happen automatically while the Testora server is running."
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending || !scenarios.length}>
            Save schedule
          </button>
        </>
      }
    >
      <div className="grid">
        <Field label="Scenario">
          <select
            className="in"
            value={draft.scenarioId}
            onChange={(e) => set({ scenarioId: e.target.value })}
          >
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Environment">
          <select
            className="in"
            value={draft.environmentId}
            onChange={(e) => set({ environmentId: e.target.value })}
          >
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </Field>
        <ScheduleTimingFields value={draft} onChange={set} />
      </div>
    </Modal>
  );
}
