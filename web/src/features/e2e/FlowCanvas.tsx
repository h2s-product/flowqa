import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FlowEdge, FlowNode, FlowNodeKind, FlowNodeStatus } from '@flowqa/shared';
import { progressLabel, StepBar, type NodeProgress } from './nodeProgress';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/ui';

export const NODE_W = 240;
export const NODE_H = 76;
const GRID = 20;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.6;
/** Tipe data drag & drop dari palet ke kanvas. */
export const PALETTE_MIME = 'application/x-testora-flow-node';

export const KIND_META: Record<FlowNodeKind, { label: string; icon: IconName }> = {
  start: { label: 'Start', icon: 'play' },
  web: { label: 'Web UI test', icon: 'cursor' },
  mobile: { label: 'Android test', icon: 'android' },
  api: { label: 'API scenario', icon: 'code' },
  wait: { label: 'Wait', icon: 'clock' },
};

export interface PaletteItem {
  kind: FlowNodeKind;
  refId: string | null;
  label: string;
}

export interface NodeInfo {
  /** Keterangan kecil di bawah judul (jumlah step, mode, lama jeda, …). */
  subtitle: string;
  /** Test case / scenario sudah tidak ada. */
  missing?: boolean;
}

type View = { x: number; y: number; k: number };
type Drag =
  | { type: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { type: 'node'; id: string; dx: number; dy: number; moved: boolean }
  | { type: 'connect'; from: string; x: number; y: number };

const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Apakah `target` bisa dicapai dari `source` (untuk menolak panah yang membuat putaran). */
export function reaches(edges: FlowEdge[], source: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [source];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.from === id) stack.push(e.to);
  }
  return false;
}

/** Tata letak rapi: kolom = kedalaman terpanjang dari node awal, baris berurutan. */
export function tidyLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const depth = new Map<string, number>();
  const parents = (id: string) => edges.filter((e) => e.to === id).map((e) => e.from);
  const depthOf = (id: string, trail = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const d = Math.max(-1, ...parents(id).map((p) => depthOf(p, trail))) + 1;
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => depthOf(n.id));
  const columns = new Map<number, FlowNode[]>();
  for (const n of [...nodes].sort((a, b) => a.y - b.y)) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const placed = new Map<string, { x: number; y: number }>();
  for (const [d, col] of columns)
    col.forEach((n, i) =>
      placed.set(n.id, { x: d * (NODE_W + 100), y: (i - (col.length - 1) / 2) * (NODE_H + 60) }),
    );
  return nodes.map((n) => ({ ...n, ...placed.get(n.id)! }));
}

const edgePath = (x1: number, y1: number, x2: number, y2: number) => {
  const c = Math.max(60, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
};

export function FlowCanvas({
  nodes,
  edges,
  editable,
  statuses,
  progress,
  info,
  selected,
  onSelect,
  onChange,
  onDropItem,
  onReject,
  fitKey,
}: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  editable: boolean;
  /** Tampilan hasil run: status per node. */
  statuses?: Record<string, FlowNodeStatus>;
  /** Tampilan hasil run: progress step di dalam tiap node (UI test / API scenario). */
  progress?: Record<string, NodeProgress>;
  info: (node: FlowNode) => NodeInfo;
  selected: { node?: string; edge?: string } | null;
  onSelect: (selection: { node?: string; edge?: string } | null) => void;
  onChange?: (nodes: FlowNode[], edges: FlowEdge[]) => void;
  onDropItem?: (item: PaletteItem, at: { x: number; y: number }) => void;
  onReject?: (reason: string) => void;
  /** Ganti nilai ini untuk menyesuaikan tampilan ke semua node (mis. saat flow dimuat). */
  fitKey?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 80, y: 200, k: 1 });
  const drag = useRef<Drag | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null);
  const markerId = useId().replace(/:/g, '');
  const node = (id: string) => nodes.find((n) => n.id === id);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = box.current!.getBoundingClientRect();
      return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
    },
    [view],
  );

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !nodes.length) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const w = Math.max(...xs) + NODE_W - minX;
    const h = Math.max(...ys) + NODE_H - minY;
    const k = Math.min(
      1.1,
      Math.max(MIN_ZOOM, Math.min(el.clientWidth / (w + 160), el.clientHeight / (h + 160))),
    );
    setView({ k, x: (el.clientWidth - w * k) / 2 - minX * k, y: (el.clientHeight - h * k) / 2 - minY * k });
  }, [nodes]);

  // "Tidy up": sesuaikan tampilan setelah posisi baru ter-render.
  const [fitPending, setFitPending] = useState(false);
  useEffect(() => {
    if (!fitPending) return;
    fit();
    setFitPending(false);
  }, [fitPending, fit]);

  // Sesuaikan tampilan saat flow pertama kali dimuat.
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const r = box.current!.getBoundingClientRect();
    const cx = (clientX ?? r.left + r.width / 2) - r.left;
    const cy = (clientY ?? r.top + r.height / 2) - r.top;
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.k * factor));
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  // Scroll = geser; Ctrl/⌘ + scroll atau pinch trackpad = zoom (seperti n8n).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Delete / Backspace menghapus node atau panah yang dipilih.
  useEffect(() => {
    if (!editable || !onChange) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]');
      if (typing || !selected || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
      e.preventDefault();
      if (selected.edge)
        onChange(
          nodes,
          edges.filter((x) => x.id !== selected.edge),
        );
      if (selected.node)
        onChange(
          nodes.filter((n) => n.id !== selected.node),
          edges.filter((x) => x.from !== selected.node && x.to !== selected.node),
        );
      onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editable, selected, nodes, edges, onChange, onSelect]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const port = target.closest('[data-port="out"]') as HTMLElement | null;
    const nodeEl = target.closest('[data-node-id]') as HTMLElement | null;
    box.current!.setPointerCapture(e.pointerId);
    if (port && editable) {
      const id = port.dataset.nodeFor!;
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { type: 'connect', from: id, ...w };
      setConnecting({ from: id, ...w });
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      onSelect({ node: id });
      if (!editable) return;
      const n = node(id)!;
      const w = toWorld(e.clientX, e.clientY);
      drag.current = { type: 'node', id, dx: w.x - n.x, dy: w.y - n.y, moved: false };
      return;
    }
    if (target.closest('[data-edge-id]')) return;
    onSelect(null);
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.type === 'pan') setView((v) => ({ ...v, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy }));
    else if (d.type === 'node' && onChange) {
      const w = toWorld(e.clientX, e.clientY);
      d.moved = true;
      onChange(
        nodes.map((n) => (n.id === d.id ? { ...n, x: w.x - d.dx, y: w.y - d.dy } : n)),
        edges,
      );
    } else if (d.type === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      setConnecting({ from: d.from, ...w });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.type === 'node' && d.moved && onChange)
      onChange(
        nodes.map((n) => (n.id === d.id ? { ...n, x: snap(n.x), y: snap(n.y) } : n)),
        edges,
      );
    if (d.type === 'connect') {
      setConnecting(null);
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest('[data-node-id]') as HTMLElement | null;
      const to = hit?.dataset.nodeId;
      if (!to || !onChange) return;
      if (to === d.from) return;
      if (node(to)?.kind === 'start') return onReject?.('The Start node cannot have incoming arrows.');
      if (edges.some((x) => x.from === d.from && x.to === to)) return;
      if (reaches(edges, to, d.from))
        return onReject?.('That arrow would create a loop. A flow must go one way.');
      const edge: FlowEdge = {
        id: `e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        from: d.from,
        to,
      };
      onChange(nodes, [...edges, edge]);
      onSelect({ edge: edge.id });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    if (!raw || !onDropItem) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    onDropItem(JSON.parse(raw) as PaletteItem, { x: snap(w.x - NODE_W / 2), y: snap(w.y - NODE_H / 2) });
  };

  const statusOf = (id: string) => statuses?.[id];
  const edgeClass = (edge: FlowEdge) => {
    const from = statusOf(edge.from);
    const to = statusOf(edge.to);
    if (!statuses) return '';
    if (to === 'running') return 'flowing';
    if (from === 'passed' && to && to !== 'pending' && to !== 'skipped') return 'done';
    if (to === 'skipped') return 'dim';
    return '';
  };

  return (
    <div
      ref={box}
      className={`flow-canvas ${editable ? 'editable' : ''} ${connecting ? 'connecting' : ''}`}
      style={{
        backgroundSize: `${GRID * view.k}px ${GRID * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragOver={(e) => editable && e.dataTransfer.types.includes(PALETTE_MIME) && e.preventDefault()}
      onDrop={onDrop}
      role="application"
      aria-label="E2E flow canvas"
    >
      <div
        className="flow-world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
      >
        <svg className="flow-edges" width="1" height="1" overflow="visible">
          <defs>
            <marker
              id={`arrow-${markerId}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow" />
            </marker>
            <marker
              id={`arrow-sel-${markerId}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow selected" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const a = node(edge.from);
            const b = node(edge.to);
            if (!a || !b) return null;
            const d = edgePath(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2);
            const isSel = selected?.edge === edge.id;
            return (
              <g
                key={edge.id}
                data-edge-id={edge.id}
                className={`flow-edge ${edgeClass(edge)} ${isSel ? 'selected' : ''}`}
              >
                <path d={d} className="hit" onPointerDown={() => onSelect({ edge: edge.id })} />
                <path
                  d={d}
                  className="line"
                  markerEnd={`url(#${isSel ? 'arrow-sel-' : 'arrow-'}${markerId})`}
                />
              </g>
            );
          })}
          {connecting &&
            (() => {
              const a = node(connecting.from);
              return a ? (
                <path
                  className="flow-edge-draft"
                  d={edgePath(a.x + NODE_W, a.y + NODE_H / 2, connecting.x, connecting.y)}
                  markerEnd={`url(#arrow-sel-${markerId})`}
                />
              ) : null;
            })()}
        </svg>
        {nodes.map((n) => {
          const meta = KIND_META[n.kind];
          const i = info(n);
          const status = statusOf(n.id);
          const p = progress?.[n.id];
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              className={`flow-node k-${n.kind} ${selected?.node === n.id ? 'selected' : ''} ${status ? `s-${status}` : ''} ${i.missing ? 'missing' : ''}`}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            >
              {n.kind !== 'start' && <span className="flow-port in" aria-hidden="true" />}
              <span className="flow-node-icon">
                <Icon name={meta.icon} size={16} />
              </span>
              <div className="flow-node-text">
                <span className="flow-node-kind">{meta.label}</span>
                <b title={n.label}>{n.label}</b>
                <span
                  className={`flow-node-sub ${p && status === 'running' ? 'live' : ''}`}
                  title={p ? progressLabel(p) : undefined}
                >
                  {i.missing ? 'Deleted — choose another' : p ? progressLabel(p) : i.subtitle}
                </span>
              </div>
              {status && status !== 'pending' && (
                <span className={`flow-node-status ${status}`} title={status}>
                  <Icon
                    name={
                      status === 'passed'
                        ? 'check'
                        : status === 'failed'
                          ? 'x'
                          : status === 'running'
                            ? 'spin'
                            : status === 'stopped'
                              ? 'stop'
                              : 'minus'
                    }
                    size={11}
                    strokeWidth={3}
                  />
                </span>
              )}
              {p && status === 'running' && (
                <span className="flow-node-progress">
                  <StepBar p={p} />
                </span>
              )}
              {n.config.continueOnFail && (
                <span className="flow-node-flag" title="Continues when this node fails">
                  ↷
                </span>
              )}
              {editable && (
                <span
                  className="flow-port out"
                  data-port="out"
                  data-node-for={n.id}
                  title="Drag to another node to connect"
                />
              )}
            </div>
          );
        })}
      </div>

      {!nodes.length && (
        <div className="flow-empty">
          <Icon name="flow" size={28} />
          <b>Drag test cases here</b>
          <span className="small muted">
            From the left panel: web UI tests, Android tests and API scenarios. Then drag from a node’s right
            dot to another node to connect them.
          </span>
        </div>
      )}

      <div className="flow-controls" onPointerDown={(e) => e.stopPropagation()}>
        <IconButton icon="plus" label="Zoom in" onClick={() => zoomAt(1.2)} />
        <IconButton icon="minus" label="Zoom out" onClick={() => zoomAt(1 / 1.2)} />
        <IconButton icon="eye" label="Fit to view" onClick={fit} />
        {editable && onChange && (
          <IconButton
            icon="flow"
            label="Tidy up (arrange automatically)"
            onClick={() => {
              onChange(tidyLayout(nodes, edges), edges);
              setFitPending(true);
            }}
          />
        )}
        <span className="small muted flow-zoom">{Math.round(view.k * 100)}%</span>
      </div>
    </div>
  );
}
