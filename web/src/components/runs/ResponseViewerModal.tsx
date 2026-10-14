import { useState } from 'react';
import type { Run } from '@flowqa/shared';
import { displayValue } from '@flowqa/shared';
import { JsonView } from '@/components/JsonView';
import { Modal } from '@/components/Modal';
import { MethodBadge, StatusBadge, Tabs } from '@/components/ui';
import { formatMs } from '@/lib/format';
import { FailureBox } from '@/components/runs/FailureBox';
import { DateTime } from '@/components/DateTime';

type ViewerTab = 'checks' | 'pretty' | 'raw' | 'headers' | 'cookies' | 'timing' | 'request';

/** Detail request/response satu step: Pretty, Raw, Headers, Cookies, Timing, Checks. */
export function ResponseViewerModal({
  run,
  initialIndex,
  onClose,
}: {
  run: Run;
  initialIndex: number;
  onClose: () => void;
}) {
  const viewable = run.steps.filter((s) => s.request || s.response);
  const [position, setPosition] = useState(
    Math.max(
      0,
      viewable.findIndex((s) => s.index === initialIndex),
    ),
  );
  const result = viewable[position];
  const [tab, setTab] = useState<ViewerTab>(result?.status === 'failed' ? 'checks' : 'pretty');
  if (!result) return null;

  const response = result.response;
  const failedField = result.assertions?.find((a) => !a.passed)?.label.split(' ')[0] ?? null;
  const cookies = Object.entries(response?.headers ?? {})
    .filter(([k]) => k.toLowerCase() === 'set-cookie')
    .flatMap(([, v]) => v.split(/,(?=\s*\w+=)/))
    .map((c) => c.trim().split(';')[0].split('='));

  return (
    <Modal
      wide
      title={
        <>
          {result.index + 1}. {result.name} <StatusBadge status={result.status} />
        </>
      }
      subtitle={
        result.request && (
          <>
            <MethodBadge method={result.request.method} /> <span className="code">{result.request.url}</span>
          </>
        )
      }
      onClose={onClose}
      tabs={
        <div style={{ padding: '0 20px' }}>
          <Tabs
            tabs={[
              { id: 'checks' as const, label: 'Checks', count: result.assertions?.length ?? 0 },
              { id: 'pretty' as const, label: 'Pretty' },
              { id: 'raw' as const, label: 'Raw' },
              { id: 'headers' as const, label: 'Headers' },
              { id: 'cookies' as const, label: 'Cookies' },
              { id: 'timing' as const, label: 'Timing' },
              { id: 'request' as const, label: 'Request sent' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
      }
      footer={
        <>
          <button className="btn" disabled={position === 0} onClick={() => setPosition((p) => p - 1)}>
            Previous step
          </button>
          <button
            className="btn"
            disabled={position === viewable.length - 1}
            onClick={() => setPosition((p) => p + 1)}
          >
            Next step
          </button>
        </>
      }
    >
      {result.explanation && (
        <div style={{ marginBottom: 14 }}>
          <FailureBox explanation={result.explanation} />
        </div>
      )}
      {!response && tab !== 'request' && tab !== 'checks' && (
        <div className="muted">No response was received for this step.</div>
      )}

      {tab === 'checks' && (
        <>
          {(result.assertions ?? []).map((a, i) => (
            <div
              key={i}
              className={`assert-result ${a.passed ? 'pass' : 'fail'}`}
              style={{ marginBottom: 6 }}
            >
              {a.passed ? '✓' : '✕'} {a.label} · expected <b>{a.expected}</b>, actual <b>{a.actual}</b>
            </div>
          ))}
          {(result.captures ?? []).map((c) => (
            <div
              key={c.variable}
              className={`assert-result ${c.ok ? 'pass' : 'fail'}`}
              style={{ marginBottom: 6 }}
            >
              {c.ok ? '✓' : '✕'} Captured {c.field} as {`{{${c.variable}}}`}{' '}
              {c.ok && (
                <>
                  = <b>{displayValue(c.value)}</b>
                </>
              )}
            </div>
          ))}
          {!result.assertions?.length && !result.captures?.length && (
            <div className="muted">No checks on this step.</div>
          )}
        </>
      )}
      {response && tab === 'pretty' && <JsonView value={response.body} highlightKey={failedField} />}
      {response && tab === 'raw' && <JsonView value={response.body} raw />}
      {response && tab === 'headers' && (
        <table className="t">
          <tbody>
            {Object.entries(response.headers).map(([k, v]) => (
              <tr key={k}>
                <td className="code small" style={{ width: '35%' }}>
                  {k}
                </td>
                <td className="code small">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {response &&
        tab === 'cookies' &&
        (cookies.length ? (
          <table className="t">
            <tbody>
              {cookies.map(([k, v], i) => (
                <tr key={i}>
                  <td className="code small">{k}</td>
                  <td className="code small">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="muted">No cookies were set.</div>
        ))}
      {response && tab === 'timing' && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <div className="stat">
            <span>Started at</span>
            <b style={{ fontSize: 15 }}>
              <DateTime value={result.startedAt} timeOnly />
            </b>
          </div>
          <div className="stat">
            <span>Finished at</span>
            <b style={{ fontSize: 15 }}>
              <DateTime value={result.finishedAt} timeOnly />
            </b>
          </div>
          <div className="stat">
            <span>Total time</span>
            <b>{formatMs(response.durationMs)}</b>
          </div>
          <div className="stat">
            <span>Status</span>
            <b>{response.status}</b>
          </div>
          <div className="stat">
            <span>Response size</span>
            <b>{(response.sizeBytes / 1024).toFixed(1)} KB</b>
          </div>
        </div>
      )}
      {tab === 'request' && result.request && (
        <>
          <table className="t" style={{ marginBottom: 12 }}>
            <tbody>
              {Object.entries(result.request.headers).map(([k, v]) => (
                <tr key={k}>
                  <td className="code small" style={{ width: '35%' }}>
                    {k}
                  </td>
                  <td className="code small">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.request.body !== undefined && <JsonView value={result.request.body} />}
          <p className="hint">Secrets and tokens are masked.</p>
        </>
      )}
    </Modal>
  );
}
