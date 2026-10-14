import { Router } from 'express';
import type { ReportData, ReportFilter, ReportKind } from '@flowqa/shared';
import { MAX_NOTIFY_RECIPIENTS } from '@flowqa/shared';
import { HttpError, asyncHandler } from '../lib/http';
import { buildApiReport, buildUiReport } from '../services/report-service';
import { requireProject, type AppContext } from './context';
import { assertProjectEnvironment } from '../domain/guards';
import { normalizeNotifications } from '../domain/normalizers';
import { DAY_MS } from '../lib/time';

const DEFAULT_PERIOD_DAYS = 7;
/** Batas ukuran lampiran HTML laporan. */
const MAX_REPORT_HTML_BYTES = 8 * 1024 * 1024;

type FilterInput = { from?: unknown; to?: unknown; environmentId?: unknown; folderId?: unknown };

function parseDate(value: unknown, fallback: Date, field: string): Date {
  if (value === undefined || value === '' || value === null) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `"${field}" is not a valid date`);
  return date;
}

/** Filter laporan (query string atau body). Default: 7 hari terakhir, semua environment & folder. */
function parseFilter(ctx: AppContext, input: FilterInput, projectId: string, kind: ReportKind): ReportFilter {
  const to = parseDate(input.to, new Date(), 'to');
  const from = parseDate(input.from, new Date(to.getTime() - DEFAULT_PERIOD_DAYS * DAY_MS), 'from');
  if (from > to) throw new HttpError(400, '"from" must be before "to"');

  // UI run tidak terikat environment.
  const environmentId = kind === 'api' && typeof input.environmentId === 'string' ? input.environmentId : '';
  if (environmentId) assertProjectEnvironment(ctx.repos, projectId, environmentId);
  const folders = kind === 'ui' ? ctx.uiFolders : ctx.scenarioFolders;
  const folderId = folders.assertFolder(
    projectId,
    typeof input.folderId === 'string' ? input.folderId : null,
  );
  return { from: from.toISOString(), to: to.toISOString(), environmentId: environmentId || null, folderId };
}

const buildReport = (
  ctx: AppContext,
  kind: ReportKind,
  projectId: string,
  filter: ReportFilter,
): ReportData =>
  kind === 'ui' ? buildUiReport(ctx.repos, projectId, filter) : buildApiReport(ctx.repos, projectId, filter);

/**
 * Lampiran dibuat dari halaman Reports di browser. Tetap dibersihkan: tanpa
 * <script>, handler on*=, dan tautan javascript:, supaya aman dibuka penerima.
 */
function sanitizeReportHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}

const safeFileName = (name: string, fallback: string) =>
  (
    name
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 120) || fallback
  ).replace(/(\.html?)?$/i, '.html');

export function reportRoutes(ctx: AppContext): Router {
  const router = Router();

  /** Laporan hasil test per scenario (API Tester). */
  router.get(
    '/projects/:projectId/report',
    asyncHandler((req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      res.json(buildReport(ctx, 'api', projectId, parseFilter(ctx, req.query, projectId, 'api')));
    }),
  );

  /** Laporan hasil test per UI test case (UI Tester). */
  router.get(
    '/projects/:projectId/ui-report',
    asyncHandler((req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      res.json(buildReport(ctx, 'ui', projectId, parseFilter(ctx, req.query, projectId, 'ui')));
    }),
  );

  /**
   * Kirim laporan ke email. Ringkasan di badan email dihitung ulang di server;
   * `html` (tampilan halaman Reports dari browser) dikirim sebagai lampiran.
   */
  router.post(
    '/projects/:projectId/reports/email',
    asyncHandler(async (req, res) => {
      const { projectId } = req.params;
      requireProject(ctx, res, projectId);
      const body = req.body ?? {};
      const kind: ReportKind = body.kind === 'api' ? 'api' : 'ui';
      if (typeof body.html !== 'string' || !body.html.includes('<html'))
        throw new HttpError(400, 'The report attachment is missing');
      if (Buffer.byteLength(body.html) > MAX_REPORT_HTML_BYTES)
        throw new HttpError(
          400,
          'The report is too large to email. Narrow the period or folder and try again.',
        );
      const recipients = normalizeNotifications({ email: { recipients: body.recipients ?? [] } }).email
        .recipients;
      if (recipients.length > MAX_NOTIFY_RECIPIENTS)
        throw new HttpError(400, `Send to at most ${MAX_NOTIFY_RECIPIENTS} addresses`);
      const report = buildReport(ctx, kind, projectId, parseFilter(ctx, body.filter ?? {}, projectId, kind));
      const sentTo = await ctx.notifications.sendReport(projectId, report, {
        recipients,
        message: typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : undefined,
        html: sanitizeReportHtml(body.html),
        fileName: safeFileName(String(body.fileName ?? ''), `${kind}-test-report.html`),
      });
      res.json({ sentTo });
    }),
  );

  return router;
}
