import type { UiFailureAnalysis } from '@flowqa/shared';
import { UI_FAILURE_SOURCE_LABELS } from '@flowqa/shared';

/**
 * Analisa step UI test yang gagal: apa yang terjadi, sumber masalah yang paling
 * mungkin, kemungkinan penyebab (urut dari yang paling mungkin), saran perbaikan,
 * dan bukti dari halaman saat gagal.
 */
export function StepFailureAnalysis({
  analysis,
  compact,
}: {
  analysis: UiFailureAnalysis;
  compact?: boolean;
}) {
  const ev = analysis.evidence;
  const hasEvidence = !!(
    ev &&
    (ev.url ||
      ev.selectors?.length ||
      ev.messages?.length ||
      ev.loading ||
      ev.loginPage ||
      ev.missingVariables?.length)
  );
  return (
    <div className="explain ui-failure-analysis">
      <div className="row wrap" style={{ gap: 8, alignItems: 'baseline' }}>
        <b className="grow" style={{ marginBottom: 0 }}>
          Analisa kegagalan: {analysis.title}
        </b>
        <span className={`chip plain likely-${analysis.likely}`}>
          {UI_FAILURE_SOURCE_LABELS[analysis.likely]}
        </span>
      </div>
      <p>{analysis.summary}</p>
      {!compact && analysis.causes.length > 0 && (
        <div className="fix">
          <b>Kemungkinan penyebab</b>
          <ol>
            {analysis.causes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </div>
      )}
      {!compact && analysis.suggestions.length > 0 && (
        <div className="fix">
          <b>Saran perbaikan</b>
          <ul>
            {analysis.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {!compact && hasEvidence && ev && (
        <details className="fix">
          <summary className="small">Bukti dari halaman saat gagal</summary>
          <dl className="small">
            {ev.url && (
              <>
                <dt>Halaman</dt>
                <dd className="code">
                  {ev.url}
                  {ev.title ? ` — ${ev.title}` : ''}
                </dd>
              </>
            )}
            {!!ev.selectors?.length && (
              <>
                <dt>Selector</dt>
                <dd>
                  {ev.selectors.map((s) => (
                    <div key={s.selector}>
                      <span className="code">{s.selector}</span> → {s.count} cocok, {s.visible} terlihat
                    </div>
                  ))}
                </dd>
              </>
            )}
            {!!ev.messages?.length && (
              <>
                <dt>Pesan tampil</dt>
                <dd>
                  {ev.messages.map((m) => (
                    <div key={m}>“{m}”</div>
                  ))}
                </dd>
              </>
            )}
            {!!ev.missingVariables?.length && (
              <>
                <dt>Variabel kosong</dt>
                <dd className="code">{ev.missingVariables.map((v) => `{{${v}}}`).join(', ')}</dd>
              </>
            )}
            {ev.loading && (
              <>
                <dt>Status</dt>
                <dd>Halaman masih memuat</dd>
              </>
            )}
            {ev.loginPage && (
              <>
                <dt>Status</dt>
                <dd>Yang tampil halaman login</dd>
              </>
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
