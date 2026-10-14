import { useMemo, useState } from 'react';
import type { PerfStage, PerfTest, PerfTestType } from '@flowqa/shared';
import { peakVus, PERF_LIMITS, targetVusAt, totalStageSeconds } from '@flowqa/shared';
import { useSavePerfTest, useScenarios } from '@/api/queries';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Field, IconButton } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { PERF_PRESETS } from './presets';
import { formatDuration } from '@/lib/format';

const PROFILE_POINTS = 120;

/** Buat atau ubah performance test: scenario, profil beban (stages), think time, dan threshold. */
export function PerfTestFormModal({ test, onClose }: { test?: PerfTest; onClose: () => void }) {
  const { projectId = '' } = useWorkspace();
  const { data: scenarios = [] } = useScenarios(projectId);
  const save = useSavePerfTest(projectId);
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<PerfTest>>(
    test ?? {
      name: '',
      description: '',
      scenarioId: scenarios[0]?.id,
      type: 'load',
      stages: PERF_PRESETS[0].stages,
      thinkTimeMs: 1000,
      thresholds: { p95Ms: 1000, errorRatePct: 1 },
    },
  );
  const set = (patch: Partial<PerfTest>) => setDraft((d) => ({ ...d, ...patch }));
  const stages = draft.stages ?? [];
  const setStage = (i: number, patch: Partial<PerfStage>) =>
    set({ stages: stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const totalSec = totalStageSeconds(stages);
  const peak = peakVus(stages);
  const profile = useMemo(() => {
    const step = Math.max(1, totalSec / PROFILE_POINTS);
    const times: number[] = [];
    for (let t = 0; t <= totalSec; t += step) times.push(t);
    return { times, values: times.map((t) => targetVusAt(stages, t)) };
  }, [stages, totalSec]);

  const pickPreset = (type: PerfTestType) => {
    const preset = PERF_PRESETS.find((p) => p.id === type)!;
    set({ type, stages: preset.stages });
  };

  const problems = [
    !draft.name?.trim() && 'Give the test a name.',
    !scenarios.length && 'Create a scenario first.',
    peak > PERF_LIMITS.maxVus && `Use at most ${PERF_LIMITS.maxVus} virtual users.`,
    peak === 0 && 'At least one stage needs virtual users.',
    totalSec > PERF_LIMITS.maxDurationSec &&
      `Keep the test under ${PERF_LIMITS.maxDurationSec / 60} minutes.`,
  ].filter(Boolean) as string[];

  const submit = () =>
    save.mutate(
      { ...draft, scenarioId: draft.scenarioId ?? scenarios[0]?.id },
      {
        onSuccess: () => (toast('Performance test saved'), onClose()),
      },
    );

  return (
    <Modal
      wide
      title={test ? 'Edit performance test' : 'New performance test'}
      subtitle="Many virtual users run the same scenario at the same time, following the load profile below."
      onClose={onClose}
      footer={
        <>
          {problems[0] && (
            <span className="small muted" style={{ marginRight: 'auto' }}>
              {problems[0]}
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={save.isPending || problems.length > 0}>
            Save test
          </button>
        </>
      }
    >
      <div className="grid">
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Name">
            <input
              className="in"
              value={draft.name ?? ''}
              placeholder="e.g. Checkout peak hour"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Scenario" hint="Each virtual user repeats this scenario from start to end.">
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
        </div>

        <div>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
            Test type
          </div>
          <div className="preset-grid">
            {PERF_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset ${draft.type === p.id ? 'on' : ''}`}
                onClick={() => pickPreset(p.id)}
              >
                <b>{p.label}</b>
                <span>{p.summary}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 16 }}>
          <div>
            <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
              Load stages
            </div>
            <div className="stage-row small muted">
              <span>#</span>
              <span>Duration (seconds)</span>
              <span>Virtual users</span>
              <span />
            </div>
            {stages.map((s, i) => (
              <div className="stage-row" key={i}>
                <span className="small muted">{i + 1}</span>
                <input
                  className="in"
                  type="number"
                  min={1}
                  value={s.durationSec}
                  onChange={(e) => setStage(i, { durationSec: Math.max(1, Number(e.target.value) || 1) })}
                />
                <input
                  className="in"
                  type="number"
                  min={0}
                  max={PERF_LIMITS.maxVus}
                  value={s.targetVus}
                  onChange={(e) => setStage(i, { targetVus: Math.max(0, Number(e.target.value) || 0) })}
                />
                <IconButton
                  icon="trash"
                  label="Remove stage"
                  disabled={stages.length === 1}
                  onClick={() => set({ stages: stages.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            <button
              className="btn sm ghost"
              disabled={stages.length >= PERF_LIMITS.maxStages}
              onClick={() =>
                set({ stages: [...stages, { durationSec: 30, targetVus: stages.at(-1)?.targetVus ?? 1 }] })
              }
            >
              <Icon name="plus" size={12} /> Add stage
            </button>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Users ramp up or down evenly to each stage&apos;s target over its duration.
            </p>
          </div>
          <div>
            <div className="row small" style={{ marginBottom: 6 }}>
              <b>Load profile</b>
              <div className="grow" />
              <span className="muted">
                {formatDuration(totalSec)} · peak {peak} users
              </span>
            </div>
            <TimeSeriesChart
              label="Planned virtual users over time"
              times={profile.times}
              height={150}
              series={[
                {
                  label: 'Virtual users',
                  color: 'var(--violet)',
                  fill: 'var(--violet-soft)',
                  values: profile.values,
                },
              ]}
            />
          </div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Think time (ms)" hint="Pause between iterations, like a real user reading the page.">
            <input
              className="in"
              type="number"
              min={0}
              value={draft.thinkTimeMs ?? 0}
              onChange={(e) => set({ thinkTimeMs: Math.max(0, Number(e.target.value) || 0) })}
            />
          </Field>
          <Field label="Pass if p95 below (ms)" hint="Leave empty to skip this check.">
            <input
              className="in"
              type="number"
              min={0}
              value={draft.thresholds?.p95Ms ?? ''}
              onChange={(e) =>
                set({
                  thresholds: {
                    errorRatePct: draft.thresholds?.errorRatePct ?? null,
                    p95Ms: e.target.value === '' ? null : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
          <Field label="Pass if error rate at most (%)" hint="Leave empty to skip this check.">
            <input
              className="in"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={draft.thresholds?.errorRatePct ?? ''}
              onChange={(e) =>
                set({
                  thresholds: {
                    p95Ms: draft.thresholds?.p95Ms ?? null,
                    errorRatePct: e.target.value === '' ? null : Number(e.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
