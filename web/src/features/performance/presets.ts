import type { PerfStage, PerfTestType } from '@flowqa/shared';

export interface PerfPreset {
  id: PerfTestType;
  label: string;
  summary: string;
  stages: PerfStage[];
}

/** Profil beban bawaan. Stage tetap bisa diubah setelah preset dipilih. */
export const PERF_PRESETS: PerfPreset[] = [
  {
    id: 'load',
    label: 'Load test',
    summary: 'Normal, expected traffic. Checks the API stays fast under a typical number of users.',
    stages: [
      { durationSec: 30, targetVus: 10 },
      { durationSec: 120, targetVus: 10 },
      { durationSec: 15, targetVus: 0 },
    ],
  },
  {
    id: 'stress',
    label: 'Stress test',
    summary: 'Keeps adding users step by step to find where response times or errors start to climb.',
    stages: [
      { durationSec: 30, targetVus: 10 },
      { durationSec: 60, targetVus: 10 },
      { durationSec: 30, targetVus: 25 },
      { durationSec: 60, targetVus: 25 },
      { durationSec: 30, targetVus: 50 },
      { durationSec: 60, targetVus: 50 },
      { durationSec: 30, targetVus: 0 },
    ],
  },
  {
    id: 'spike',
    label: 'Spike test',
    summary: 'A sudden burst of users, then back to normal. Checks the API survives and recovers.',
    stages: [
      { durationSec: 10, targetVus: 5 },
      { durationSec: 30, targetVus: 5 },
      { durationSec: 10, targetVus: 60 },
      { durationSec: 30, targetVus: 60 },
      { durationSec: 10, targetVus: 5 },
      { durationSec: 30, targetVus: 5 },
      { durationSec: 10, targetVus: 0 },
    ],
  },
  {
    id: 'soak',
    label: 'Soak test',
    summary: 'Moderate traffic for a long time. Finds memory leaks and slow degradation.',
    stages: [
      { durationSec: 60, targetVus: 10 },
      { durationSec: 1800, targetVus: 10 },
      { durationSec: 60, targetVus: 0 },
    ],
  },
];

export const presetLabel = (type: PerfTestType) => PERF_PRESETS.find((p) => p.id === type)?.label ?? type;
