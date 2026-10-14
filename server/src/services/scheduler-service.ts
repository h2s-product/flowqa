import type { Repositories } from '../repositories';
import { nowIso } from '../lib/time';
import type { RunService } from './run-service';
import type { UiScheduleService } from './ui-schedule-service';
import { computeNextRun } from '../domain/schedule-time';
import { log } from '../lib/log';

/**
 * Scheduler sederhana berbasis interval. Cocok untuk satu instance server.
 * Untuk multi-instance, ganti dengan job queue (mis. BullMQ) — lihat docs/ARCHITECTURE.md.
 */
export class SchedulerService {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly repos: Repositories,
    private readonly runs: RunService,
    private readonly intervalMs: number,
    /** Jadwal UI Tester (Test Scheduler). */
    private readonly uiSchedules?: UiScheduleService,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Jalankan semua jadwal yang sudah jatuh tempo. */
  tick(now: Date = new Date()): void {
    for (const schedule of this.repos.schedules.list()) {
      if (!schedule.enabled || !schedule.nextRunAt || new Date(schedule.nextRunAt) > now) continue;
      schedule.nextRunAt = computeNextRun(schedule, now);
      schedule.updatedAt = nowIso();
      try {
        const run = this.runs.start(
          { scenarioId: schedule.scenarioId, environmentId: schedule.environmentId },
          'schedule',
        );
        schedule.lastRunId = run.id;
        schedule.lastRunAt = run.startedAt;
      } catch (error) {
        log.warn(`schedule ${schedule.id} could not start: ${(error as Error).message}`);
      }
      this.repos.schedules.save(schedule);
    }
    this.uiSchedules?.runDue(now);
  }
}
