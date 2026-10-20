import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FlowNode, FlowRunOptions, MobileExecutionMode } from '@flowqa/shared';
import { MOBILE_EXECUTION_MODE_LABEL } from '@flowqa/shared';
import { useAndroidDevices, useRunFlow } from '@/api/queries';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { Field, Segmented, Toggle } from '@/components/ui';
import { useExecutionMode } from '@/features/ui/mobileMode';

const VISIBLE_KEY = 'testora.flowVisible';
const MODES: { id: Exclude<MobileExecutionMode, 'mock'>; label: string }[] = [
  { id: 'emulator', label: MOBILE_EXECUTION_MODE_LABEL.emulator },
  { id: 'device', label: MOBILE_EXECUTION_MODE_LABEL.device },
];

type Target = { id: string; nodes: FlowNode[]; environmentId?: string | null };

function savedVisible(): boolean | undefined {
  try {
    const v = localStorage.getItem(VISIBLE_KEY);
    return v === null ? undefined : v === '1';
  } catch {
    return undefined;
  }
}

/**
 * Tombol Run E2E Flow: bila flow punya node web atau mobile, tampilkan dialog
 * "tampilkan browser" (web) dan "jalankan di Emulator / Device" (mobile) dulu.
 * Flow yang hanya berisi API/jeda langsung dijalankan.
 */
export function useFlowRunner(projectId: string) {
  const run = useRunFlow(projectId);
  const navigate = useNavigate();
  const [target, setTarget] = useState<{ flow: Target; initial?: FlowRunOptions } | null>(null);

  const go = (flow: Target, options?: FlowRunOptions) =>
    run.mutate(
      { id: flow.id, environmentId: flow.environmentId, options },
      {
        onSuccess: (r) => {
          setTarget(null);
          navigate(`/e2e/runs/${r.id}`);
        },
      },
    );
  const request = (flow: Target, initial?: FlowRunOptions) => {
    if (flow.nodes.some((n) => n.kind === 'web' || n.kind === 'mobile')) setTarget({ flow, initial });
    else go(flow);
  };
  const dialog = target && (
    <FlowRunDialog
      nodes={target.flow.nodes}
      initial={target.initial}
      pending={run.isPending}
      onRun={(options) => go(target.flow, options)}
      onClose={() => setTarget(null)}
    />
  );
  return { request, dialog, isPending: run.isPending };
}

function FlowRunDialog({
  nodes,
  initial,
  pending,
  onRun,
  onClose,
}: {
  nodes: FlowNode[];
  initial?: FlowRunOptions;
  pending: boolean;
  onRun: (options: FlowRunOptions) => void;
  onClose: () => void;
}) {
  const web = nodes.filter((n) => n.kind === 'web');
  const mobile = nodes.filter((n) => n.kind === 'mobile');
  const [lastMode, rememberMode] = useExecutionMode();
  const [visible, setVisible] = useState(
    () => initial?.visible ?? (web.some((n) => n.config.visible) || (savedVisible() ?? false)),
  );
  const [mode, setMode] = useState<MobileExecutionMode>(() => {
    const m = initial?.mode ?? mobile.find((n) => n.config.mode)?.config.mode ?? lastMode;
    return m === 'mock' ? 'emulator' : m;
  });
  const { data: devices = [], isLoading } = useAndroidDevices(mobile.length > 0, true);
  const ready = devices.filter(
    (d) => d.type === mode && !d.id.startsWith('avd:') && d.status !== 'DISCONNECTED',
  );
  const offlineAvd = mode === 'emulator' && devices.some((d) => d.id.startsWith('avd:'));

  const submit = () => {
    const options: FlowRunOptions = {};
    if (web.length) {
      options.visible = visible;
      try {
        localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
      } catch {
        // Penyimpanan browser tidak tersedia: pilihan hanya berlaku untuk run ini.
      }
    }
    if (mobile.length) {
      options.mode = mode;
      rememberMode(mode);
    }
    onRun(options);
  };

  return (
    <Modal
      title="Run flow"
      subtitle="Choose how the test cases in this flow run. The flow itself is not changed."
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" autoFocus disabled={pending} onClick={submit}>
            <Icon name="play" size={13} /> {pending ? 'Starting…' : 'Run flow'}
          </button>
        </>
      }
    >
      <div className="grid">
        {web.length > 0 && (
          <Field group label={`Web (${web.length} ${web.length === 1 ? 'node' : 'nodes'}, e.g. Backoffice)`}>
            <Toggle checked={visible} onChange={setVisible}>
              <span>
                <b>Show the browser</b>
                <span className="small muted">
                  {' '}
                  —{' '}
                  {visible
                    ? 'replays in a Chrome window at recorded speed.'
                    : 'runs headless (faster, no window).'}
                </span>
              </span>
            </Toggle>
          </Field>
        )}
        {mobile.length > 0 && (
          <Field
            group
            label={`Android (${mobile.length} ${mobile.length === 1 ? 'node' : 'nodes'}, e.g. Sales App)`}
            hint={
              isLoading
                ? 'Checking connected devices…'
                : ready.length
                  ? `Ready: ${ready.map((d) => `${d.name} (${d.id})`).join(', ')}`
                  : mode === 'emulator'
                    ? offlineAvd
                      ? 'No emulator is running. Testora starts one when the flow reaches the Android node.'
                      : 'No emulator is running or created. Create one in Settings → Mobile (Android) → Device Manager.'
                    : 'No phone is connected. Plug it in over USB with USB debugging on, then unlock it.'
            }
          >
            <Segmented options={MODES} value={mode as (typeof MODES)[number]['id']} onChange={setMode} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
