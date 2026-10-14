import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { E2EFlow, FlowEdge, FlowNode, MobileExecutionMode } from '@flowqa/shared';
import { useFlow, useFlowRuns, useRunFlow, useSaveFlow, useScenarios, useUiTests } from '@/api/queries';
import { DateTime } from '@/components/DateTime';
import { Icon } from '@/components/Icon';
import {
  BackLink,
  ErrorBox,
  Field,
  IconButton,
  Loading,
  SearchInput,
  Segmented,
  StatusBadge,
  Toggle,
} from '@/components/ui';
import { useConfirm } from '@/context/ConfirmContext';
import { useToast } from '@/context/ToastContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { FlowCanvas, KIND_META, NODE_W, PALETTE_MIME, type PaletteItem } from './FlowCanvas';
import {
  CONTROL_ITEMS,
  itemFromScenario,
  itemFromTest,
  nodeFromItem,
  nodeInfo,
  refLink,
  type FlowLookups,
} from './flowNodes';

type Draft = Pick<E2EFlow, 'name' | 'description' | 'environmentId' | 'nodes' | 'edges'>;
const snapshot = (d: Draft | null) => JSON.stringify(d);

/** Editor E2E Flow: palet test case (web, Android, API) → kanvas → panah. */
export function FlowEditorPage() {
  const { flowId = '' } = useParams();
  const { projectId = '', environments } = useWorkspace();
  const { data: flow, isLoading, error } = useFlow(flowId);
  const { data: tests = [] } = useUiTests(projectId);
  const { data: scenarios = [] } = useScenarios(projectId);
  const { data: runs = [] } = useFlowRuns(projectId, { flowId, limit: 5 });
  const save = useSaveFlow(projectId);
  const run = useRunFlow(projectId);
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState('');
  const [selected, setSelected] = useState<{ node?: string; edge?: string } | null>(null);

  useEffect(() => {
    if (flow && !draft) {
      const d = {
        name: flow.name,
        description: flow.description,
        environmentId: flow.environmentId,
        nodes: flow.nodes,
        edges: flow.edges,
      };
      setDraft(d);
      setSaved(snapshot(d));
    }
  }, [flow, draft]);

  const lookups: FlowLookups = useMemo(
    () => ({
      tests: new Map(tests.map((t) => [t.id, t])),
      scenarios: new Map(scenarios.map((s) => [s.id, s])),
    }),
    [tests, scenarios],
  );
  const dirty = !!draft && snapshot(draft) !== saved;

  // Peringatan saat meninggalkan halaman dengan perubahan yang belum disimpan.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const persist = useCallback(
    (then?: () => void) => {
      if (!draft) return;
      save.mutate(
        { ...draft, id: flowId },
        {
          onSuccess: (f) => {
            const d = {
              name: f.name,
              description: f.description,
              environmentId: f.environmentId,
              nodes: f.nodes,
              edges: f.edges,
            };
            setDraft(d);
            setSaved(snapshot(d));
            if (then) then();
            else toast('Flow saved');
          },
        },
      );
    },
    [draft, flowId, save, toast],
  );

  // Ctrl/⌘ + S menyimpan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) persist();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, persist]);

  if (isLoading || (flow && !draft)) return <Loading />;
  if (error || !flow || !draft) return <ErrorBox error={error} />;

  const setGraph = (nodes: FlowNode[], edges: FlowEdge[]) =>
    setDraft((d) => (d ? { ...d, nodes, edges } : d));
  const selectedNode = selected?.node ? draft.nodes.find((n) => n.id === selected.node) : undefined;
  const selectedEdge = selected?.edge ? draft.edges.find((e) => e.id === selected.edge) : undefined;

  /** Tambah node: di posisi drop, atau di kanan node terpilih (lalu disambungkan otomatis). */
  const addNode = (item: PaletteItem, at?: { x: number; y: number }) => {
    if (item.kind === 'start' && draft.nodes.some((n) => n.kind === 'start'))
      return toast('This flow already has a Start node.');
    const anchor = selectedNode ?? draft.nodes.at(-1);
    const pos = at ?? (anchor ? { x: anchor.x + NODE_W + 100, y: anchor.y } : { x: 0, y: 0 });
    const n = nodeFromItem(item, pos);
    const edges =
      !at && selectedNode && item.kind !== 'start'
        ? [...draft.edges, { id: `e_${n.id}`, from: selectedNode.id, to: n.id }]
        : draft.edges;
    setGraph([...draft.nodes, n], edges);
    setSelected({ node: n.id });
  };
  const updateNode = (id: string, patch: Partial<FlowNode>) =>
    setGraph(
      draft.nodes.map((n) =>
        n.id === id ? { ...n, ...patch, config: { ...n.config, ...patch.config } } : n,
      ),
      draft.edges,
    );
  const removeNode = (id: string) => {
    setGraph(
      draft.nodes.filter((n) => n.id !== id),
      draft.edges.filter((e) => e.from !== id && e.to !== id),
    );
    setSelected(null);
  };
  const start = () => {
    const go = () =>
      run.mutate(
        { id: flowId, environmentId: draft.environmentId },
        { onSuccess: (r) => navigate(`/e2e/runs/${r.id}`) },
      );
    if (dirty) persist(go);
    else go();
  };
  const problems = flow.problems ?? [];
  const runnable = draft.nodes.some((n) => n.kind !== 'start');

  return (
    <div className="flow-editor">
      <div className="row wrap detail-bar flow-bar">
        <BackLink to="/e2e/flows" label="E2E flows" />
        <input
          className="in flow-name"
          value={draft.name}
          aria-label="Flow name"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <label className="row small" style={{ gap: 6 }}>
          <span className="muted">Environment</span>
          <select
            className="in"
            value={draft.environmentId ?? ''}
            onChange={(e) => setDraft({ ...draft, environmentId: e.target.value || null })}
          >
            <option value="">None</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grow" />
        {runs[0] && (
          <Link className="small" to={`/e2e/runs/${runs[0].id}`}>
            Last run: <StatusBadge status={runs[0].status} /> <DateTime value={runs[0].startedAt} relative />
          </Link>
        )}
        <button className="btn" disabled={!dirty || save.isPending} onClick={() => persist()}>
          {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button
          className="btn primary"
          disabled={!runnable || run.isPending || !draft.name.trim()}
          onClick={start}
        >
          <Icon name="play" size={13} /> {run.isPending ? 'Starting…' : 'Run flow'}
        </button>
      </div>
      {problems.length > 0 && !dirty && (
        <div className="banner warn mb-12">
          <Icon name="x" size={14} /> <span>{problems.join(' ')}</span>
        </div>
      )}

      <div className="flow-layout">
        <FlowPalette tests={tests} scenarios={scenarios} onAdd={(item) => addNode(item)} />
        <FlowCanvas
          nodes={draft.nodes}
          edges={draft.edges}
          editable
          info={(n) => nodeInfo(n, lookups)}
          selected={selected}
          onSelect={setSelected}
          onChange={setGraph}
          onDropItem={(item, at) => addNode(item, at)}
          onReject={(reason) => toast(reason)}
          fitKey={flow.id}
        />
        <aside className="flow-inspector panel">
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              flow={draft}
              lookups={lookups}
              onChange={(patch) => updateNode(selectedNode.id, patch)}
              onRemove={async () =>
                (await confirm({
                  title: `Remove “${selectedNode.label}” from the flow?`,
                  message: 'Its arrows are removed too. The test case itself stays.',
                  confirmLabel: 'Remove',
                })) && removeNode(selectedNode.id)
              }
            />
          ) : selectedEdge ? (
            <div className="panel-b grid">
              <h3 style={{ margin: 0 }}>Arrow</h3>
              <p className="small" style={{ margin: 0 }}>
                <b>{draft.nodes.find((n) => n.id === selectedEdge.from)?.label}</b> →{' '}
                <b>{draft.nodes.find((n) => n.id === selectedEdge.to)?.label}</b>
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                The second node starts after the first one finishes, and receives every variable it produced
                (for example <span className="code">{'{{order_id}}'}</span> captured by an API scenario).
              </p>
              <button
                className="btn danger sm"
                onClick={() => {
                  setGraph(
                    draft.nodes,
                    draft.edges.filter((e) => e.id !== selectedEdge.id),
                  );
                  setSelected(null);
                }}
              >
                <Icon name="trash" size={12} /> Delete arrow
              </button>
            </div>
          ) : (
            <div className="panel-b grid">
              <h3 style={{ margin: 0 }}>How it works</h3>
              <ol className="setup-steps small">
                <li>
                  Drag web UI tests, Android tests and API scenarios from the left onto the canvas (or click
                  one to add it after the selected node).
                </li>
                <li>
                  Drag from a node’s <b>right dot</b> to another node to draw an arrow.
                </li>
                <li>A node runs when all nodes pointing to it have passed. Branches run at the same time.</li>
                <li>
                  Variables flow along the arrows: a value captured or set in one node is available as{' '}
                  <span className="code">{'{{name}}'}</span> in the next ones.
                </li>
              </ol>
              <Field label="Description">
                <textarea
                  className="in"
                  rows={4}
                  value={draft.description}
                  placeholder="What does this end-to-end flow prove?"
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              <p className="small muted" style={{ margin: 0 }}>
                Scroll to move · Ctrl/⌘ + scroll to zoom · Delete removes the selected node or arrow · Ctrl/⌘
                + S saves
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Palet kiri: test case dari semua platform, bisa di-drag ke kanvas atau diklik. */
function FlowPalette({
  tests,
  scenarios,
  onAdd,
}: {
  tests: { id: string; name: string; target?: string; steps: unknown[] }[];
  scenarios: { id: string; name: string; steps: unknown[] }[];
  onAdd: (item: PaletteItem) => void;
}) {
  const [q, setQ] = useState('');
  const match = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase());
  const sections: { title: string; kind: PaletteItem['kind']; items: PaletteItem[] }[] = [
    {
      title: 'Web UI tests',
      kind: 'web',
      items: tests.filter((t) => t.target !== 'mobile').map((t) => itemFromTest(t as never)),
    },
    {
      title: 'Android tests',
      kind: 'mobile',
      items: tests.filter((t) => t.target === 'mobile').map((t) => itemFromTest(t as never)),
    },
    { title: 'API scenarios', kind: 'api', items: scenarios.map((s) => itemFromScenario(s as never)) },
    { title: 'Controls', kind: 'wait', items: CONTROL_ITEMS },
  ];
  return (
    <aside className="flow-palette panel">
      <div className="panel-b">
        <SearchInput value={q} onChange={setQ} placeholder="Search test cases" />
      </div>
      <div className="flow-palette-list">
        {sections.map((section) => {
          const items = section.items.filter((i) => match(i.label));
          return (
            <section key={section.title}>
              <h4>
                <Icon name={KIND_META[section.kind].icon} size={12} /> {section.title}
                <span className="muted"> {items.length}</span>
              </h4>
              {items.map((item) => (
                <button
                  key={`${item.kind}-${item.refId ?? item.label}`}
                  type="button"
                  className={`flow-palette-item k-${item.kind}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(item));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => onAdd(item)}
                  title="Drag onto the canvas, or click to add after the selected node"
                >
                  <Icon name={KIND_META[item.kind].icon} size={13} />
                  <span className="ellipsis">{item.label}</span>
                </button>
              ))}
              {!items.length && (
                <p className="small muted flow-palette-empty">{q ? 'No match' : 'None yet'}</p>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function NodeInspector({
  node,
  flow,
  lookups,
  onChange,
  onRemove,
}: {
  node: FlowNode;
  flow: Draft;
  lookups: FlowLookups;
  onChange: (patch: Partial<FlowNode>) => void;
  onRemove: () => void;
}) {
  const meta = KIND_META[node.kind];
  const link = refLink(node);
  const info = nodeInfo(node, lookups);
  const upstream = flow.edges
    .filter((e) => e.to === node.id)
    .map((e) => flow.nodes.find((n) => n.id === e.from)?.label);
  const downstream = flow.edges
    .filter((e) => e.from === node.id)
    .map((e) => flow.nodes.find((n) => n.id === e.to)?.label);
  return (
    <div className="panel-b grid">
      <div className="row" style={{ gap: 8 }}>
        <span className={`flow-node-icon k-${node.kind}`}>
          <Icon name={meta.icon} size={15} />
        </span>
        <b className="grow">{meta.label}</b>
        <IconButton icon="trash" label="Remove from flow" onClick={onRemove} />
      </div>
      <Field label="Name on the canvas">
        <input className="in" value={node.label} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      {info.missing && (
        <ErrorBox>This test case was deleted. Remove the node, or drag another test case in.</ErrorBox>
      )}
      {link && !info.missing && (
        <Link className="small" to={link}>
          <Icon name="edit" size={12} /> Open the {node.kind === 'api' ? 'API scenario' : 'test case'} (
          {info.subtitle})
        </Link>
      )}
      {node.kind === 'wait' && (
        <Field label="Pause (seconds)">
          <input
            className="in"
            type="number"
            min={0}
            max={600}
            value={(node.config.waitMs ?? 2000) / 1000}
            onChange={(e) => onChange({ config: { waitMs: Math.round(Number(e.target.value) * 1000) } })}
          />
        </Field>
      )}
      {node.kind === 'web' && (
        <Toggle checked={!!node.config.visible} onChange={(visible) => onChange({ config: { visible } })}>
          <span>
            <b>Show the browser</b>
            <span className="small muted"> — replays at recorded speed in a Chrome window.</span>
          </span>
        </Toggle>
      )}
      {node.kind === 'mobile' && (
        <Field group label="Run on">
          <Segmented
            options={[
              { id: 'default', label: 'Default' },
              { id: 'mock', label: 'Mock' },
              { id: 'emulator', label: 'Emulator' },
              { id: 'device', label: 'Device' },
            ]}
            value={node.config.mode ?? 'default'}
            onChange={(m) =>
              onChange({ config: { mode: m === 'default' ? undefined : (m as MobileExecutionMode) } })
            }
          />
        </Field>
      )}
      {node.kind !== 'start' && (
        <Toggle
          checked={!!node.config.continueOnFail}
          onChange={(continueOnFail) => onChange({ config: { continueOnFail } })}
        >
          <span>
            <b>Continue when this fails</b>
            <span className="small muted">
              {' '}
              — the next nodes still run (the flow is still reported as failed).
            </span>
          </span>
        </Toggle>
      )}
      <div className="small muted">
        {upstream.length ? (
          <>
            Runs after: <b>{upstream.join(', ')}</b>
          </>
        ) : (
          'Runs first (no arrow points to it).'
        )}
        {downstream.length > 0 && (
          <>
            <br />
            Then: <b>{downstream.join(', ')}</b>
          </>
        )}
      </div>
    </div>
  );
}
