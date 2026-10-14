import type { FlowNode, MobileExecutionMode, Scenario, UiTestCase } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import type { NodeInfo, PaletteItem } from './FlowCanvas';

export interface FlowLookups {
  tests: Map<string, UiTestCase>;
  scenarios: Map<string, Scenario>;
}

export const newNodeId = () => `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Keterangan di node: jumlah step, mode Android, lama jeda, atau "sudah dihapus". */
export function nodeInfo(node: FlowNode, lookups: FlowLookups): NodeInfo {
  switch (node.kind) {
    case 'start':
      return { subtitle: 'Runs first' };
    case 'wait':
      return { subtitle: `Pause ${((node.config.waitMs ?? 2000) / 1000).toLocaleString()} s` };
    case 'api': {
      const s = node.refId ? lookups.scenarios.get(node.refId) : undefined;
      return s ? { subtitle: plural(s.steps.length, 'request') } : { subtitle: '', missing: true };
    }
    case 'web':
    case 'mobile': {
      const t = node.refId ? lookups.tests.get(node.refId) : undefined;
      if (!t || (t.target === 'mobile') !== (node.kind === 'mobile')) return { subtitle: '', missing: true };
      const extra =
        node.kind === 'mobile'
          ? ` · ${node.config.mode ? MOBILE_EXECUTION_MODE_LABEL[node.config.mode as MobileExecutionMode] : 'default mode'}`
          : node.config.visible
            ? ' · visible'
            : '';
      return { subtitle: `${t.code ? `${t.code} · ` : ''}${plural(t.steps.length, 'step')}${extra}` };
    }
  }
}

export const itemFromTest = (t: UiTestCase): PaletteItem => ({
  kind: t.target === 'mobile' ? 'mobile' : 'web',
  refId: t.id,
  label: t.name,
});

export const itemFromScenario = (s: Scenario): PaletteItem => ({ kind: 'api', refId: s.id, label: s.name });

export const CONTROL_ITEMS: PaletteItem[] = [
  { kind: 'start', refId: null, label: 'Start' },
  { kind: 'wait', refId: null, label: 'Wait' },
];

export function nodeFromItem(item: PaletteItem, at: { x: number; y: number }): FlowNode {
  return {
    id: newNodeId(),
    kind: item.kind,
    refId: item.refId,
    label: item.label,
    x: at.x,
    y: at.y,
    config: item.kind === 'wait' ? { waitMs: 2000 } : {},
  };
}

/** Tautan ke test case / scenario asli. */
export function refLink(node: FlowNode): string | null {
  if (!node.refId) return null;
  return node.kind === 'api' ? `/scenarios/${node.refId}` : `/ui/tests/${node.refId}`;
}
