/**
 * Isi email hasil test (subjek, teks, HTML). Fungsi murni tanpa I/O supaya
 * mudah dites dan diubah tampilannya.
 */
import type { ReportData } from '@flowqa/shared';
import { formatDurationMs } from './run-stats';

export interface RunMailItem {
  /** Jenis test, mis. "API test", "UI test", "Performance test". */
  kind: string;
  name: string;
  status: string;
  /** Environment (API/performance) atau browser (UI). */
  target: string;
  startedAt: string;
  durationMs: number;
  counts?: { passed: number; failed: number; skipped: number };
  /** Ringkasan penyebab gagal. */
  failure?: string;
  /** Tautan ke halaman hasil run di Testora. */
  url: string;
}

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const STATUS_LABEL: Record<string, string> = { passed: 'Passed', failed: 'Failed', stopped: 'Stopped' };
const STATUS_COLOR: Record<string, string> = { passed: '#08705a', failed: '#cf3b45', stopped: '#b67a09' };
const label = (status: string) => STATUS_LABEL[status] ?? status;
const icon = (status: string) => (status === 'passed' ? '✅' : status === 'failed' ? '❌' : '⏹');

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

const countsText = (c?: RunMailItem['counts']) =>
  c ? `${c.passed} passed · ${c.failed} failed · ${c.skipped} skipped` : '';

const layout = (
  title: string,
  body: string,
  footer: string,
) => `<!doctype html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#0b1a33">
<div style="max-width:640px;margin:0 auto;padding:24px">
  <div style="font-size:13px;color:#737e95;margin-bottom:8px">Testora · test results</div>
  <div style="background:#fff;border:1px solid #dfe4ef;border-radius:12px;padding:24px">
    <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
    ${body}
  </div>
  <div style="font-size:12px;color:#737e95;margin-top:12px">${footer}</div>
</div></body></html>`;

const badge = (status: string) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:bold;color:#fff;background:${STATUS_COLOR[status] ?? '#737e95'}">${escapeHtml(label(status))}</span>`;

const button = (url: string, text: string) =>
  `<a href="${escapeHtml(url)}" style="display:inline-block;margin-top:20px;padding:10px 16px;border-radius:8px;background:#2f4fe0;color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(text)}</a>`;

const footer = (projectName: string) =>
  `You get this email because results of the project “${escapeHtml(projectName)}” are sent to this address. Change it in Testora → Projects → Edit project.`;

/** Email untuk satu run. */
export function renderRunEmail(projectName: string, item: RunMailItem): MailContent {
  const subject = `${icon(item.status)} ${label(item.status)} · ${item.name} · ${projectName}`;
  const rows: [string, string][] = [
    ['Test', `${item.name} (${item.kind})`],
    ['Result', label(item.status)],
    ['Ran on', item.target],
    ['Started', when(item.startedAt)],
    ['Duration', formatDurationMs(item.durationMs)],
    ...(item.counts ? ([['Steps', countsText(item.counts)]] as [string, string][]) : []),
    ...(item.failure ? ([['Why it failed', item.failure]] as [string, string][]) : []),
  ];
  const text = [
    `${label(item.status)}: ${item.name} — ${projectName}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Open in Testora: ${item.url}`,
  ].join('\n');
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#737e95;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0">${
          k === 'Result' ? badge(item.status) : escapeHtml(v)
        }</td></tr>`,
    )
    .join('');
  const html = layout(
    escapeHtml(item.name),
    `<table style="border-collapse:collapse;font-size:14px">${table}</table>${button(item.url, 'Open the result in Testora')}`,
    footer(projectName),
  );
  return { subject, text, html };
}

/** Satu email ringkasan untuk bulk run (Run all / Run selected). */
export function renderBatchEmail(projectName: string, title: string, items: RunMailItem[]): MailContent {
  const failed = items.filter((i) => i.status !== 'passed').length;
  const allPassed = failed === 0;
  const summary = allPassed ? `All ${items.length} passed` : `${failed} of ${items.length} failed`;
  const subject = `${allPassed ? '✅' : '❌'} ${summary} · ${title} · ${projectName}`;
  const text = [
    `${title} — ${projectName}: ${summary}`,
    '',
    ...items.map(
      (i) =>
        `${label(i.status).padEnd(7)} ${i.name} (${formatDurationMs(i.durationMs)})${i.failure ? ` — ${i.failure}` : ''}\n        ${i.url}`,
    ),
  ].join('\n');
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px 8px 0;border-top:1px solid #eef1f8">${badge(i.status)}</td><td style="padding:8px 12px 8px 0;border-top:1px solid #eef1f8"><a href="${escapeHtml(i.url)}" style="color:#2f4fe0;font-weight:bold;text-decoration:none">${escapeHtml(i.name)}</a>${
          i.failure
            ? `<div style="font-size:12px;color:#cf3b45;margin-top:2px">${escapeHtml(i.failure)}</div>`
            : ''
        }</td><td style="padding:8px 0;border-top:1px solid #eef1f8;color:#737e95;white-space:nowrap">${formatDurationMs(i.durationMs)}</td></tr>`,
    )
    .join('');
  const html = layout(
    `${escapeHtml(title)}: ${escapeHtml(summary)}`,
    `<p style="margin:0 0 12px;color:#4a5670;font-size:14px">Ran on ${escapeHtml(items[0]?.target ?? '')} · started ${escapeHtml(items[0] ? when(items[0].startedAt) : '')}</p>
     <table style="border-collapse:collapse;font-size:14px;width:100%">${rows}</table>`,
    footer(projectName),
  );
  return { subject, text, html };
}

/** Email percobaan dari pengaturan project. */
export function renderTestEmail(projectName: string): MailContent {
  const subject = `Testora test email · ${projectName}`;
  const message = `Email notifications work. Test results of “${projectName}” will be sent to this address.`;
  return {
    subject,
    text: message,
    html: layout(
      'Email notifications work',
      `<p style="margin:0;font-size:14px">${escapeHtml(message)}</p>`,
      footer(projectName),
    ),
  };
}

/**
 * Email pengantar laporan (Reports). Angka dihitung dari data laporan di server;
 * tampilan lengkap ada di lampiran HTML.
 */
export function renderReportEmail(
  projectName: string,
  title: string,
  report: ReportData,
  options: { message?: string; url: string; attachmentName: string },
): MailContent {
  const { summary, itemStatus } = report;
  const noun = report.kind === 'ui' ? 'UI tests' : 'scenarios';
  const period = `${when(report.filter.from)} – ${when(report.filter.to)}`;
  const failing = report.items.filter((i) => i.status === 'failing');
  const headline = itemStatus.failing
    ? `${itemStatus.failing} of ${summary.items} ${noun} failing`
    : `All ${itemStatus.passing} executed ${noun} passing`;
  const subject = `${itemStatus.failing ? '❌' : '✅'} ${title} · ${projectName} · ${headline}`;
  const rows: [string, string][] = [
    ['Period', period],
    [
      `${noun[0].toUpperCase()}${noun.slice(1)}`,
      `${itemStatus.passing} passing · ${itemStatus.failing} failing · ${itemStatus.notExecuted} not executed`,
    ],
    [
      'Test runs',
      `${summary.runs} (${summary.runs ? `${summary.passRate}% passed` : 'none in this period'})`,
    ],
    [
      'Steps',
      `${summary.steps.passed} passed · ${summary.steps.failed} failed · ${summary.steps.skipped} skipped`,
    ],
  ];
  const failingText = failing.map(
    (i) => `- ${i.name}${i.lastRun?.failedStep ? ` — ${i.lastRun.failedStep}` : ''}`,
  );
  const text = [
    `${title} — ${projectName}: ${headline}`,
    ...(options.message ? ['', options.message] : []),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(failing.length ? ['', 'Failing:', ...failingText] : []),
    '',
    `The full report is attached (${options.attachmentName}). Open it in any browser.`,
    `Open Reports in Testora: ${options.url}`,
  ].join('\n');
  const table = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#737e95;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const failingHtml = failing.length
    ? `<h2 style="font-size:15px;margin:20px 0 8px">Failing</h2><ul style="margin:0;padding-left:18px;font-size:14px">${failing
        .map(
          (i) =>
            `<li style="margin:4px 0"><b>${escapeHtml(i.name)}</b>${
              i.lastRun?.failedStep
                ? `<div style="font-size:12px;color:#cf3b45">${escapeHtml(i.lastRun.failedStep)}</div>`
                : ''
            }</li>`,
        )
        .join('')}</ul>`
    : '';
  const html = layout(
    `${escapeHtml(title)}: ${escapeHtml(headline)}`,
    `${options.message ? `<p style="margin:0 0 16px;font-size:14px;white-space:pre-wrap">${escapeHtml(options.message)}</p>` : ''}
     <table style="border-collapse:collapse;font-size:14px">${table}</table>${failingHtml}
     <p style="margin:20px 0 0;font-size:14px">📎 The full report — looking exactly like the Reports page — is attached as <b>${escapeHtml(options.attachmentName)}</b>. Open it in any browser.</p>
     ${button(options.url, 'Open Reports in Testora')}`,
    footer(projectName),
  );
  return { subject, text, html };
}
