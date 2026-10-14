/**
 * Mengirim hasil test ke email sesuai pengaturan project (Projects → Edit →
 * Email notifications). Dipanggil saat run selesai; bulk run mengirim satu email
 * ringkasan. Kegagalan kirim hanya dicatat di log — tidak pernah memengaruhi run.
 */
import type { FlowRun, NotificationStatus, PerfRun, Project, ReportData, Run, UiRun } from '@flowqa/shared';
import { uiRunTargetLabel } from '@flowqa/shared';
import { HttpError, notFound } from '../lib/http';
import { log } from '../lib/log';
import type { Mailer } from '../lib/mailer';
import type { Repositories } from '../repositories';
import type { MailProvider } from './email-settings-service';
import {
  renderBatchEmail,
  renderReportEmail,
  renderRunEmail,
  renderTestEmail,
  type MailContent,
  type RunMailItem,
} from '../domain/run-email';

export class NotificationService {
  constructor(
    private readonly repos: Repositories,
    /** Pengaturan terbaru dibaca setiap kali kirim (Settings → Email Report bisa berubah kapan saja). */
    private readonly mail: MailProvider,
  ) {}

  private get mailer(): Mailer | null {
    return this.mail.mailer();
  }

  private get appUrl(): string {
    return this.mail.appUrl();
  }

  status(): NotificationStatus {
    const mailer = this.mailer;
    return {
      emailConfigured: !!mailer,
      from: mailer?.from ?? '',
      defaultRecipients: this.mail.defaultRecipients(),
    };
  }

  apiRun(run: Run): void {
    this.notify(run.projectId, [this.apiItem(run)]);
  }

  uiRun(run: UiRun): void {
    this.notify(run.projectId, [this.uiItem(run)]);
  }

  perfRun(run: PerfRun): void {
    this.notify(run.projectId, [
      {
        kind: 'Performance test',
        name: run.testName,
        status: run.status,
        target: run.environmentName,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        failure: run.failureReason,
        url: `${this.appUrl}/performance/runs/${run.id}`,
      },
    ]);
  }

  /** E2E Flow: satu email berisi hasil flow (jumlah node lulus/gagal/dilewati). */
  flowRun(run: FlowRun): void {
    const count = (status: string) => run.nodes.filter((n) => n.status === status).length;
    this.notify(run.projectId, [
      {
        kind: 'E2E flow',
        name: run.flowName,
        status: run.status,
        target: run.environmentName,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        counts: { passed: count('passed'), failed: count('failed'), skipped: count('skipped') },
        failure: run.failureReason,
        url: `${this.appUrl}/e2e/runs/${run.id}`,
      },
    ]);
  }

  /** Satu email ringkasan untuk bulk run API (Run all). */
  apiBatch(projectId: string, runs: Run[]): void {
    this.notify(
      projectId,
      runs.map((r) => this.apiItem(r)),
      'Run all scenarios',
    );
  }

  /** Satu email ringkasan untuk bulk run UI (Run selected). */
  uiBatch(projectId: string, runs: UiRun[], title = 'Run selected UI tests'): void {
    this.notify(
      projectId,
      runs.map((r) => this.uiItem(r)),
      title,
    );
  }

  /**
   * Kirim laporan (halaman Reports) ke email: ringkasan di badan email, tampilan
   * lengkap sebagai lampiran HTML. Berbeda dengan notifikasi run, ini dikirim
   * langsung (menunggu hasil) karena dipicu user dari tombol "Email report".
   */
  async sendReport(
    projectId: string,
    report: ReportData,
    options: { recipients: string[]; message?: string; html: string; fileName: string },
  ): Promise<string[]> {
    const project = this.repos.projects.get(projectId);
    if (!project) throw notFound('Project');
    const mailer = this.mailer;
    if (!mailer)
      throw new HttpError(
        400,
        'Email is not set up yet. An administrator can set it up in Settings → Email Report.',
      );
    const to = options.recipients.length ? options.recipients : this.recipientsOf(project);
    if (!to.length) throw new HttpError(400, 'Add at least one email address');
    const title = report.kind === 'ui' ? 'UI Test Report' : 'Test Report';
    const content = renderReportEmail(project.name, title, report, {
      message: options.message,
      url: `${this.appUrl}${report.kind === 'ui' ? '/ui/reports' : '/reports'}`,
      attachmentName: options.fileName,
    });
    try {
      await mailer.send({
        to,
        ...content,
        attachments: [
          { filename: options.fileName, content: options.html, contentType: 'text/html; charset=utf-8' },
        ],
      });
    } catch (error) {
      throw new HttpError(502, `The mail server refused the email: ${(error as Error).message}`);
    }
    log.info(`report email sent for "${project.name}" to ${to.length} recipient(s)`);
    return to;
  }

  /** Kirim email percobaan ke penerima yang diberikan (atau penerima project). */
  async sendTest(projectId: string, recipients?: string[]): Promise<string[]> {
    const project = this.repos.projects.get(projectId);
    if (!project) throw notFound('Project');
    const mailer = this.mailer;
    if (!mailer)
      throw new HttpError(
        400,
        'Email is not set up yet. An administrator can set it up in Settings → Email Report.',
      );
    const to = recipients?.length ? recipients : this.recipientsOf(project);
    if (!to.length) throw new HttpError(400, 'Add at least one email address first');
    try {
      await mailer.send({ to, ...renderTestEmail(project.name) });
    } catch (error) {
      throw new HttpError(502, `The mail server refused the email: ${(error as Error).message}`);
    }
    return to;
  }

  /* ------------------------------------------------------------------ */

  private apiItem(run: Run): RunMailItem {
    return {
      kind: 'API test',
      name: run.scenarioName,
      status: run.status,
      target: run.environmentName,
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      counts: run.counts,
      failure: run.failedStep ? `${run.failedStep}: ${run.failureReason ?? 'failed'}` : run.failureReason,
      url: `${this.appUrl}/runs/${run.id}`,
    };
  }

  private uiItem(run: UiRun): RunMailItem {
    return {
      kind: 'UI test',
      name: run.testName,
      status: run.status,
      target: uiRunTargetLabel(run),
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      counts: run.counts,
      failure: run.failureReason,
      url: `${this.appUrl}/ui/runs/${run.id}`,
    };
  }

  /** Terapkan pengaturan project (aktif, penerima, "hanya bila gagal") lalu kirim di latar belakang. */
  private notify(projectId: string, items: RunMailItem[], batchTitle?: string): void {
    const mailer = this.mailer;
    if (!mailer || !items.length) return;
    const project = this.repos.projects.get(projectId);
    const settings = project?.notifications?.email;
    const to = project ? this.recipientsOf(project) : [];
    if (!project || !settings?.enabled || !to.length) return;
    if (settings.when === 'failed' && items.every((i) => i.status === 'passed')) return;
    const content: MailContent =
      batchTitle && items.length > 1
        ? renderBatchEmail(project.name, batchTitle, items)
        : renderRunEmail(project.name, items[0]);
    void this.deliver(mailer, project, to, content);
  }

  /** Penerima project, atau penerima default dari Settings → Email Report bila kosong. */
  private recipientsOf(project: Project): string[] {
    const own = project.notifications?.email.recipients ?? [];
    return own.length ? own : this.mail.defaultRecipients();
  }

  private async deliver(mailer: Mailer, project: Project, to: string[], content: MailContent): Promise<void> {
    try {
      await mailer.send({ to, ...content });
      log.info(`result email sent for "${project.name}" to ${to.length} recipient(s)`);
    } catch (error) {
      log.warn(`could not send the result email for "${project.name}": ${(error as Error).message}`);
    }
  }
}
