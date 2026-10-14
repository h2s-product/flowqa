/**
 * Bentuk respons API yang dipakai bersama oleh beberapa route: ringkasan run
 * untuk daftar (tanpa detail berat) dan UI test dengan nilai rahasia disamarkan.
 */
import type { PerfRun, Run, UiRun, UiStep, UiTestCase } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';

/** API run untuk daftar: tanpa detail request/response tiap step. */
export const summarizeRun = (run: Run) => ({
  ...run,
  steps: run.steps.map(({ request, response, ...rest }) => rest),
});

/** Performance run untuk daftar: tanpa timeline & detail per step. */
export const summarizePerfRun = ({ timeline, steps, topErrors, statusCodes, ...rest }: PerfRun) => rest;

/** UI run untuk daftar: tanpa hasil per step. */
export const summarizeUiRun = ({ steps, ...rest }: UiRun) => rest;

/** Info singkat run terakhir sebuah scenario/project. */
export const lastRunBrief = (run: Run | undefined) =>
  run
    ? { id: run.id, status: run.status, startedAt: run.startedAt, environmentName: run.environmentName }
    : null;

/** Samarkan nilai rahasia (mis. password) sebuah UI step sebelum dikirim ke UI. */
export const maskUiStep = (step: UiStep): UiStep => (step.sensitive ? { ...step, value: SECRET_MASK } : step);

export const presentUiTest = (test: UiTestCase): UiTestCase => ({
  ...test,
  steps: test.steps.map(maskUiStep),
});

/** Nilai samaran yang dikirim balik dari UI diganti lagi dengan nilai asli yang tersimpan. */
export function restoreUiSecrets(
  input: Record<string, unknown>,
  existing: UiTestCase,
): Record<string, unknown> {
  if (!Array.isArray(input.steps)) return input;
  return {
    ...input,
    steps: input.steps.map((raw: Record<string, unknown>) => {
      const old = existing.steps.find((s) => s.id === raw?.id);
      return old?.sensitive && raw.value === SECRET_MASK
        ? { ...raw, value: old.value, sensitive: true }
        : raw;
    }),
  };
}
