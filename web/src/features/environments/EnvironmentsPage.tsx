import { useEffect, useState } from 'react';
import type { Environment, EnvVariable } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';
import { useDeleteEnvironment, useSaveEnvironment } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { KeyValueEditor } from '@/components/KeyValueEditor';
import { EmptyState, Field, IconButton, Loading, Toggle } from '@/components/ui';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { envColor } from '@/lib/format';
import { DateTime } from '@/components/DateTime';
import { useEditableCopy } from '@/hooks/useEditableCopy';
import { useConfirm } from '@/context/ConfirmContext';

export function EnvironmentsPage() {
  const { projectId, environments, environment: active, setEnvironmentId, loading } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string>();
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const save = useSaveEnvironment(projectId ?? '');
  const remove = useDeleteEnvironment(projectId ?? '');
  const confirm = useConfirm();
  const toast = useToast();

  const selected = environments.find((e) => e.id === selectedId) ?? environments[0];
  const { draft, setDraft, dirty } = useEditableCopy(selected);
  // Nilai secret yang sedang ditampilkan disembunyikan lagi saat pindah environment.
  useEffect(() => setRevealed(new Set()), [selected?.id]);

  if (loading) return <Loading />;
  if (!projectId) return <EmptyState title="Create a project first" />;

  const set = (patch: Partial<Environment>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setVar = (i: number, patch: Partial<EnvVariable>) =>
    set({ variables: draft!.variables.map((v, j) => (j === i ? { ...v, ...patch } : v)) });

  const submit = () =>
    draft &&
    save.mutate(draft, {
      onSuccess: () => toast('Environment saved'),
    });

  const addEnvironment = () =>
    save.mutate(
      {
        name: 'New environment',
        baseUrl: 'https://',
        variables: (selected?.variables ?? []).map((v) => ({ ...v, value: v.secret ? '' : v.value })),
        headers: selected?.headers ?? [],
      },
      { onSuccess: (env) => setSelectedId(env.id) },
    );

  const deleteSelected = async () => {
    if (
      !selected ||
      !(await confirm({
        title: `Delete “${selected.name}”?`,
        message: 'Its variables are deleted, and schedules that use this environment are removed too.',
      }))
    )
      return;
    remove.mutate(selected.id, {
      onSuccess: () => setSelectedId(undefined),
    });
  };

  return (
    <div className="env-layout">
      <div className="panel" style={{ padding: 8 }}>
        {environments.map((env) => (
          <div
            key={env.id}
            className={`env-item ${env.id === selected?.id ? 'on' : ''}`}
            onClick={() => setSelectedId(env.id)}
          >
            <span className="dot" style={{ background: envColor(env.name) }} />
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{env.name}</b>
              <div
                className="small muted code"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {env.baseUrl.replace(/^https?:\/\//, '')}
              </div>
              <div className="small muted">
                Updated <DateTime value={env.updatedAt} />
              </div>
            </div>
            {env.id === active?.id && <span className="chip var-out">active</span>}
          </div>
        ))}
        <button className="add-inline" style={{ marginTop: 6 }} onClick={addEnvironment}>
          <Icon name="plus" size={14} /> Add environment
        </button>
      </div>

      {draft ? (
        <div className="panel">
          <div className="panel-h">
            <h3>{draft.name}</h3>
            {draft.createdAt && (
              <span className="small muted">
                Created <DateTime value={draft.createdAt} /> · Updated <DateTime value={draft.updatedAt} />
              </span>
            )}
            <div className="grow" />
            {draft.id !== active?.id && (
              <button className="btn sm" onClick={() => setEnvironmentId(draft.id)}>
                Use for runs
              </button>
            )}
            <button className="btn sm ghost danger" onClick={deleteSelected}>
              <Icon name="trash" size={14} /> Delete
            </button>
            <button className="btn sm primary" onClick={submit} disabled={!dirty || save.isPending}>
              {dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>

          <div className="cfg-section">
            <div className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
              <Field label="Name">
                <input className="in" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Base URL" hint="Every API path is added to this address.">
                <input
                  className="in code"
                  value={draft.baseUrl}
                  onChange={(e) => set({ baseUrl: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <div className="cfg-section">
            <h4>Variables</h4>
            <p>
              Values your tests can use as {'{{NAME}}'}. Secrets are stored on the server, never sent back to
              the browser, and masked in every log.
            </p>
            <table className="kv">
              <thead>
                <tr>
                  <th style={{ width: '34%' }}>Name</th>
                  <th>Value</th>
                  <th style={{ width: 70 }}>Secret</th>
                  <th style={{ width: 30 }} />
                </tr>
              </thead>
              <tbody>
                {draft.variables.map((v, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="in code"
                        value={v.key}
                        placeholder="VARIABLE_NAME"
                        onChange={(e) => setVar(i, { key: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <input
                          className="in code"
                          type={v.secret && !revealed.has(i) ? 'password' : 'text'}
                          value={v.value}
                          autoComplete="off"
                          onFocus={(e) => v.value === SECRET_MASK && e.target.select()}
                          onChange={(e) => setVar(i, { value: e.target.value })}
                        />
                        {v.secret && v.value !== SECRET_MASK && (
                          <IconButton
                            icon="eye"
                            label="Show or hide"
                            onClick={() =>
                              setRevealed(
                                (s) => new Set(s.has(i) ? [...s].filter((x) => x !== i) : [...s, i]),
                              )
                            }
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <Toggle
                        checked={v.secret}
                        onChange={(secret) => setVar(i, { secret })}
                        label="Secret"
                      />
                    </td>
                    <td>
                      <IconButton
                        icon="trash"
                        label={`Remove variable ${v.key || i + 1}`}
                        onClick={() => set({ variables: draft.variables.filter((_, j) => j !== i) })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              className="btn sm ghost"
              style={{ marginTop: 6 }}
              onClick={() => set({ variables: [...draft.variables, { key: '', value: '', secret: false }] })}
            >
              <Icon name="plus" size={14} /> Add variable
            </button>
            <p className="hint">
              A stored secret shows as dots. Leave it as is to keep the current value, or type a new one to
              replace it.
            </p>
          </div>

          <div className="cfg-section">
            <h4>Default headers</h4>
            <p>Sent with every request in this environment.</p>
            <KeyValueEditor
              rows={draft.headers}
              onChange={(headers) => set({ headers })}
              keyPlaceholder="Header-Name"
              addLabel="Add header"
            />
          </div>

          <div className="cfg-section">
            <details className="adv">
              <summary>Advanced settings</summary>
              <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <Field label="Timeout (ms)">
                  <input
                    className="in"
                    type="number"
                    value={draft.timeoutMs}
                    onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Proxy">
                  <input
                    className="in code"
                    value={draft.proxy}
                    placeholder="http://proxy.local:8080"
                    onChange={(e) => set({ proxy: e.target.value })}
                  />
                </Field>
                <Toggle checked={draft.verifySsl} onChange={(verifySsl) => set({ verifySsl })}>
                  Verify SSL certificates
                </Toggle>
              </div>
            </details>
          </div>
        </div>
      ) : (
        <div className="panel">
          <EmptyState title="No environments yet">
            Add one with the base URL of the system you want to test.
          </EmptyState>
        </div>
      )}
    </div>
  );
}
