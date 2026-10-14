import { useMemo, useState } from 'react';
import type { UiSchedule } from '@flowqa/shared';
import { useFolders, useSaveUiSchedule, useUiTests } from '@/api/queries';
import { folderPath, indexFolders } from '@/components/folders/folderIndex';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Field, SearchInput, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { plural } from '@/lib/format';
import { ScheduleTimingFields } from '@/features/schedules/ScheduleTimingFields';

/** Nama yang umum dipakai, bisa diklik untuk mengisi. */
const NAME_IDEAS = ['Smoke Test', 'Regression Test', 'Sanity Check', 'Nightly Run'];

/** Buat / ubah jadwal Test Scheduler: nama, UI test case, environment, dan waktu. */
export function UiScheduleFormModal({ schedule, onClose }: { schedule?: UiSchedule; onClose: () => void }) {
  const { projectId = '', environments, environment } = useWorkspace();
  const { data: tests = [] } = useUiTests(projectId);
  const { data: folders = [] } = useFolders('ui', projectId);
  const save = useSaveUiSchedule(projectId);
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<UiSchedule>>(
    schedule ?? {
      name: '',
      testIds: [],
      environmentId: environment?.id ?? null,
      frequency: 'daily',
      time: '08:00',
      enabled: true,
    },
  );
  const [search, setSearch] = useState('');
  const set = (patch: Partial<UiSchedule>) => setDraft((d) => ({ ...d, ...patch }));
  const selected = new Set(draft.testIds ?? []);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    // Urutan jalan mengikuti urutan daftar test case.
    set({ testIds: tests.filter((t) => next.has(t.id)).map((t) => t.id) });
  };

  // Test case dikelompokkan per folder (path lengkap), dengan pencarian.
  const index = useMemo(() => indexFolders(folders, tests), [folders, tests]);
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, { title: string; tests: typeof tests }>();
    for (const t of tests) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const title = (t.folderId && folderPath(index, t.folderId)) || 'Unfiled';
      if (!map.has(title)) map.set(title, { title, tests: [] });
      map.get(title)!.tests.push(t);
    }
    return [...map.values()].sort((a, b) =>
      a.title === 'Unfiled'
        ? 1
        : b.title === 'Unfiled'
          ? -1
          : a.title.localeCompare(b.title, undefined, { numeric: true }),
    );
  }, [tests, index, search]);
  const missing = (draft.testIds ?? []).filter((id) => !tests.some((t) => t.id === id)).length;

  const ready = !!draft.name?.trim() && selected.size > 0;
  const submit = () =>
    save.mutate(draft, {
      onSuccess: () => (toast(schedule ? 'Schedule saved' : 'Schedule created'), onClose()),
    });

  return (
    <Modal
      wide
      title={schedule ? `Edit “${schedule.name}”` : 'New test schedule'}
      subtitle="The chosen UI tests run one after another, headless, while the Testora server is running."
      onClose={onClose}
      footer={
        <>
          <span className="small muted grow">{plural(selected.size, 'UI test')} selected</span>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!ready || save.isPending}>
            {schedule ? 'Save schedule' : 'Create schedule'}
          </button>
        </>
      }
    >
      <div className="grid">
        <Field
          label="Name"
          hint="Shown in UI Test Runs and in the result email, e.g. Smoke Test or Regression Test."
        >
          <input
            className="in"
            autoFocus
            value={draft.name ?? ''}
            maxLength={80}
            placeholder="Smoke Test"
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        {!schedule && !draft.name && (
          <div className="row wrap" style={{ gap: 6, marginTop: -8 }}>
            {NAME_IDEAS.map((idea) => (
              <button key={idea} type="button" className="chip plain" onClick={() => set({ name: idea })}>
                {idea}
              </button>
            ))}
          </div>
        )}

        <Field group label="UI test cases" hint="They run in the order shown here.">
          <div className="sched-picker">
            <div className="row" style={{ gap: 8, padding: 8 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Search UI tests" />
              <div className="grow" />
              <button
                type="button"
                className="btn sm ghost"
                onClick={() =>
                  toggle(
                    tests.map((t) => t.id),
                    true,
                  )
                }
              >
                Select all
              </button>
              <button type="button" className="btn sm ghost" onClick={() => set({ testIds: [] })}>
                Clear
              </button>
            </div>
            <div className="sched-picker-list">
              {groups.length ? (
                groups.map((g) => {
                  const ids = g.tests.map((t) => t.id);
                  const all = ids.every((id) => selected.has(id));
                  return (
                    <div key={g.title} className="sched-group">
                      <label className="sched-group-h">
                        <input type="checkbox" checked={all} onChange={() => toggle(ids, !all)} />
                        <Icon name="folder" size={13} /> {g.title}
                        <span className="small muted">({g.tests.length})</span>
                      </label>
                      {g.tests.map((t) => (
                        <label key={t.id} className="sched-test">
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => toggle([t.id], !selected.has(t.id))}
                          />
                          <span>{t.name}</span>
                          <span className="small muted">{plural(t.steps.length, 'step')}</span>
                        </label>
                      ))}
                    </div>
                  );
                })
              ) : (
                <div className="small muted" style={{ padding: 12 }}>
                  {tests.length ? 'No UI tests match this search.' : 'No UI tests yet — record one first.'}
                </div>
              )}
            </div>
          </div>
        </Field>
        {missing > 0 && (
          <p className="small text-fail" style={{ margin: 0 }}>
            {plural(missing, 'UI test')} in this schedule no longer exist and will be skipped.
          </p>
        )}

        <div className="grid two">
          <Field label="Environment" hint="Used for {{variables}} and Run API scenario steps.">
            <select
              className="in"
              value={draft.environmentId ?? ''}
              onChange={(e) => set({ environmentId: e.target.value || null })}
            >
              <option value="">No environment</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
          <div style={{ alignSelf: 'end', paddingBottom: 8 }}>
            <Toggle checked={draft.enabled ?? true} onChange={(enabled) => set({ enabled })}>
              <span>Run automatically on this schedule</span>
            </Toggle>
          </div>
        </div>
        <ScheduleTimingFields value={draft} onChange={set} />
      </div>
    </Modal>
  );
}
