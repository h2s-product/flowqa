import { pathParameters } from '@flowqa/shared';
import { BodyFieldEditor } from '@/components/BodyFieldEditor';
import { KeyValueEditor } from '@/components/KeyValueEditor';
import { MethodBadge, Segmented } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { SourceHint, VariablePicker } from '../VariablePicker';
import { availableVariables } from '../variables';
import type { ApiStepTabProps } from './types';
import { bodyToJson, jsonToBody } from '@/lib/bodyJson';

export function RequestTab(props: ApiStepTabProps) {
  const { step, update, api, apis, scenario, index, environment } = props;
  const toast = useToast();
  if (!api)
    return (
      <div className="cfg-section">
        <div className="banner warn">
          The API used by this step was removed from the catalog. Pick another one below.
        </div>
        <ApiSelect step={step} apis={apis} update={update} />
      </div>
    );

  const vars = availableVariables(scenario, index, environment);
  const params = pathParameters(api.path);
  const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(api.method);
  const hint = (value: string) => (
    <SourceHint value={value} scenario={scenario} index={index} environment={environment} />
  );
  const tokenOptions = [
    ...new Set([
      step.tokenVariable || 'auth_token',
      ...vars.filter((v) => v.source !== 'dynamic').map((v) => v.key),
    ]),
  ];

  const switchBodyMode = (mode: 'visual' | 'json') => {
    if (mode === step.bodyMode) return;
    try {
      if (mode === 'json') update({ bodyMode: 'json', bodyJson: bodyToJson(step.body) });
      else update({ bodyMode: 'visual', body: jsonToBody(step.bodyJson) });
    } catch {
      toast('The JSON has an error, so it can’t be shown in the visual builder yet.');
    }
  };

  return (
    <>
      <div className="cfg-section">
        <h4>API</h4>
        <p>What this step calls. Edit the API itself in the API Catalog.</p>
        <ApiSelect step={step} apis={apis} update={update} />
        <div className="url-bar" style={{ marginTop: 10 }}>
          <MethodBadge method={api.method} />
          <span className="code muted">{environment?.baseUrl}</span>
          <span className="code" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {api.path.split(/(\{\w+\})/).map((part, i) =>
              /^\{\w+\}$/.test(part) ? (
                <span key={i} className="chip var-in">
                  {step.pathParams[part.slice(1, -1)] || `{{${part.slice(1, -1)}}}`}
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </span>
        </div>
      </div>

      {params.length > 0 && (
        <div className="cfg-section">
          <h4>Values in the address</h4>
          <p>These parts of the URL change every run.</p>
          <table className="kv">
            <tbody>
              {params.map((p) => {
                const value = step.pathParams[p] || `{{${p}}}`;
                const set = (v: string) => update({ pathParams: { ...step.pathParams, [p]: v } });
                return (
                  <tr key={p}>
                    <td style={{ width: '30%' }} className="code">
                      {p}
                    </td>
                    <td>
                      <input className="in code" value={value} onChange={(e) => set(e.target.value)} />
                    </td>
                    <td style={{ width: '1%' }}>
                      <VariablePicker variables={vars} onPick={set} />
                    </td>
                    <td style={{ width: '1%' }}>{hint(value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {api.auth === 'bearer' && (
        <div className="cfg-section">
          <h4>Login token</h4>
          <p>This API needs a signed-in user. Testora sends the token for you.</p>
          <div className="row wrap">
            <span className="code small">Authorization: Bearer</span>
            <select
              className="in"
              style={{ width: 'auto' }}
              value={step.tokenVariable}
              onChange={(e) => update({ tokenVariable: e.target.value })}
            >
              {tokenOptions.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            {hint(`{{${step.tokenVariable}}}`)}
          </div>
        </div>
      )}

      {hasBody && (
        <div className="cfg-section">
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="grow">
              <h4>Data to send</h4>
              <p style={{ margin: 0, color: 'var(--ink3)', fontSize: 12.5 }}>
                The request body. Use generated values to keep each run unique.
              </p>
            </div>
            <Segmented
              options={[
                { id: 'visual', label: 'Visual builder' },
                { id: 'json', label: 'Advanced JSON' },
              ]}
              value={step.bodyMode}
              onChange={switchBodyMode}
            />
          </div>
          {step.bodyMode === 'json' ? (
            <>
              <textarea
                className="in"
                rows={10}
                spellCheck={false}
                value={step.bodyJson}
                onChange={(e) => update({ bodyJson: e.target.value })}
              />
              <div className="hint" style={{ marginTop: 6 }}>
                Variables work here too. Leave numbers unquoted:{' '}
                <span className="code">"amount": {'{{order_total}}'}</span>
              </div>
            </>
          ) : (
            <BodyFieldEditor
              rows={step.body}
              onChange={(body) => update({ body })}
              renderValueExtras={(_row, i) => (
                <VariablePicker
                  variables={vars}
                  onPick={(token) =>
                    update({ body: step.body.map((f, j) => (j === i ? { ...f, value: token } : f)) })
                  }
                />
              )}
              renderHint={(row) => hint(row.value)}
            />
          )}
        </div>
      )}

      <div className="cfg-section">
        <details className="adv">
          <summary>Advanced settings: query parameters and extra headers</summary>
          <h4 style={{ marginTop: 4 }}>Query parameters</h4>
          <KeyValueEditor
            rows={step.query}
            onChange={(query) => update({ query })}
            addLabel="Add parameter"
          />
          <h4 style={{ marginTop: 12 }}>Extra headers</h4>
          <KeyValueEditor
            rows={step.headers}
            onChange={(headers) => update({ headers })}
            keyPlaceholder="Header-Name"
            addLabel="Add header"
          />
          <p className="hint">
            Environment headers ({environment?.headers.map((h) => h.key).join(', ') || 'none'}) are added
            automatically.
          </p>
        </details>
      </div>
    </>
  );
}

function ApiSelect({ step, apis, update }: Pick<ApiStepTabProps, 'step' | 'apis' | 'update'>) {
  return (
    <select
      className="in"
      value={step.apiId}
      onChange={(e) => {
        const next = apis.find((a) => a.id === e.target.value);
        if (next)
          update({ apiId: next.id, body: structuredClone(next.body), pathParams: {}, bodyMode: 'visual' });
      }}
    >
      {!apis.some((a) => a.id === step.apiId) && <option value={step.apiId}>(removed API)</option>}
      {apis.map((a) => (
        <option key={a.id} value={a.id}>
          {a.method} · {a.name} — {a.path}
        </option>
      ))}
    </select>
  );
}
