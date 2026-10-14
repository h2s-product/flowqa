/**
 * Jadwal UI Tester (menu Test Scheduler): menjalankan sekumpulan UI test case
 * bernama secara berurutan dan mencatat ringkasan run terakhirnya.
 */
import type { MobileExecutionMode, UiRun, UiSchedule } from '@flowqa/shared';
import { HttpError } from '../lib/http';
import { nowIso } from '../lib/time';
import type { Repositories } from '../repositories';
import { computeNextRun } from '../domain/schedule-time';
import type { UiRunService } from './ui-run-service';

export class UiScheduleService {
  constructor(
    private readonly repos: Repositories,
    private readonly uiRuns: UiRunService,
  ) {}

  /** Waktu run berikutnya setelah jadwal disimpan / diubah. */
  plan(schedule: UiSchedule, previous?: UiSchedule): UiSchedule {
    const timingChanged =
      !previous ||
      schedule.frequency !== previous.frequency ||
      schedule.time !== previous.time ||
      schedule.day !== previous.day;
    if (!schedule.enabled) schedule.nextRunAt = null;
    else if (!previous?.enabled || timingChanged || !schedule.nextRunAt)
      schedule.nextRunAt = computeNextRun(schedule);
    return schedule;
  }

  /**
   * Jalankan jadwal sekarang (dari scheduler atau tombol "Run now"). Test yang
   * sudah dihapus / tanpa step dilewati. Mengembalikan jumlah test yang dijalankan.
   */
  run(
    schedule: UiSchedule,
    /** Test Android: mode eksekusi (mis. perangkat tempat APK baru dipasang). */
    options: { mode?: MobileExecutionMode } = {},
  ): { queued: number; skipped: number } {
    const { queued, skipped } = this.uiRuns.startBatch(schedule.projectId, schedule.testIds, {
      headless: true,
      mode: options.mode,
      environmentId: schedule.environmentId,
      trigger: 'schedule',
      scheduleName: schedule.name,
      onProgress: (runs, done) => this.record(schedule.id, runs, done),
    });
    if (!queued.length) throw new HttpError(400, 'None of the UI tests in this schedule has steps to run');
    const startedAt = nowIso();
    this.update(schedule.id, (s) => ({
      ...s,
      lastRunAt: startedAt,
      lastBatch: { startedAt, finishedAt: null, runIds: [], total: queued.length, passed: 0, failed: 0 },
    }));
    return {
      queued: queued.length,
      skipped: skipped.length + (schedule.testIds.length - queued.length - skipped.length),
    };
  }

  /** Jalankan semua jadwal yang sudah jatuh tempo (dipanggil SchedulerService). */
  runDue(now: Date): void {
    for (const schedule of this.repos.uiSchedules.list()) {
      if (!schedule.enabled || !schedule.nextRunAt || new Date(schedule.nextRunAt) > now) continue;
      this.update(schedule.id, (s) => ({ ...s, nextRunAt: computeNextRun(s, now) }));
      try {
        this.run(this.repos.uiSchedules.get(schedule.id)!);
      } catch {
        /* dicatat oleh UiRunService / dilewati bila tidak ada test yang bisa dijalankan */
      }
    }
  }

  private record(scheduleId: string, runs: UiRun[], done: boolean) {
    this.update(scheduleId, (s) =>
      s.lastBatch
        ? {
            ...s,
            lastBatch: {
              ...s.lastBatch,
              runIds: runs.map((r) => r.id),
              passed: runs.filter((r) => r.status === 'passed').length,
              failed: runs.filter((r) => r.status !== 'passed').length,
              finishedAt: done ? nowIso() : null,
            },
          }
        : s,
    );
  }

  private update(id: string, change: (schedule: UiSchedule) => UiSchedule) {
    const current = this.repos.uiSchedules.get(id);
    if (current) this.repos.uiSchedules.save({ ...change(current), updatedAt: nowIso() });
  }
}
