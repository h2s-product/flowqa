import { useState } from 'react';
import type { ApiDefinition, Step, StepResult } from '@flowqa/shared';
import { describeAssertion } from '@flowqa/shared';
import { Icon } from '@/components/Icon';
import { IconButton, MethodBadge } from '@/components/ui';
import { formatMs } from '@/lib/format';
import { variablesProduced, variablesUsed } from './variables';

interface Props {
  step: Step;
  index: number;
  total: number;
  api?: ApiDefinition;
  apis: ApiDefinition[];
  result?: StepResult;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleSelected: () => void;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onToggleDisabled: () => void;
  onDelete: () => void;
  onDropStep: (fromIndex: number) => void;
}

function Summary({ step, api }: { step: Step; api?: ApiDefinition }) {
  switch (step.type) {
    case 'api':
      return api ? (
        <>
          <MethodBadge method={api.method} />
          <span className="code">{api.path}</span>
        </>
      ) : (
        <span className="muted">API removed</span>
      );
    case 'wait':
      return (
        <>
          <span className="chip plain">Wait</span> {formatMs(step.durationMs)}
        </>
      );
    case 'setVariable':
      return (
        <>
          <span className="chip plain">Set</span>{' '}
          <span className="code">
            {step.variable || '…'} = {step.value}
          </span>
        </>
      );
    case 'condition':
      return (
        <>
          <span className="chip plain">If</span>{' '}
          <span className="code">
            {step.left || '…'} {step.operator} {step.right}
          </span>
        </>
      );
  }
}

/** Kartu satu step di alur scenario, termasuk "kabel" variabel yang diteruskan ke step berikutnya. */
export function StepCard(props: Props) {
  const { step, index, total, api, apis, result, active, selected } = props;
  const [dragOver, setDragOver] = useState(false);
  const status = result?.status;
  const icon =
    status === 'passed'
      ? 'check'
      : status === 'failed'
        ? 'x'
        : status === 'running'
          ? 'spin'
          : status === 'skipped'
            ? 'minus'
            : null;
  const used = variablesUsed(step, apis);
  const produced = variablesProduced(step);

  const checks: { text: string; state: 'ok' | 'bad' | 'idle' }[] = [];
  if (step.type === 'api') {
    step.assertions.slice(0, 3).forEach((a) => {
      const r = result?.assertions?.find((x) => x.assertionId === a.id);
      checks.push({
        text: describeAssertion(a) + (r && !r.passed ? ` (got ${r.actual})` : ''),
        state: r ? (r.passed ? 'ok' : 'bad') : 'idle',
      });
    });
    if (step.assertions.length > 3)
      checks.push({ text: `+ ${step.assertions.length - 3} more checks`, state: 'idle' });
    step.captures
      .filter((c) => c.variable)
      .slice(0, 2)
      .forEach((c) => {
        const r = result?.captures?.find((x) => x.variable === c.variable);
        checks.push({ text: `Captures ${c.field}`, state: r ? (r.ok ? 'ok' : 'bad') : 'idle' });
      });
  }

  return (
    <>
      <div
        className={`step ${active ? 'on' : ''} ${step.disabled ? 'off' : ''} ${dragOver ? 'drag-over' : ''}`}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/step-index', String(index))}
        onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const from = Number(e.dataTransfer.getData('text/step-index'));
          if (!Number.isNaN(from)) props.onDropStep(from);
        }}
        onClick={props.onSelect}
        onKeyDown={(e) => e.key === 'Enter' && props.onSelect()}
        role="button"
        tabIndex={0}
        aria-label={`Step ${index + 1}: ${step.name}`}
      >
        <input
          type="checkbox"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={props.onToggleSelected}
          aria-label={`Select step ${index + 1}`}
        />
        <span className={`s-num ${status ?? ''}`}>
          {icon ? <Icon name={icon} size={12} strokeWidth={3.2} /> : index + 1}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="s-title">{step.name || 'Untitled step'}</div>
          <div className="s-sub">
            <Summary step={step} api={api} />
          </div>
          {checks.length > 0 && (
            <div className="s-checks">
              {checks.map((c, i) => (
                <span key={i} className={c.state}>
                  {c.state === 'ok' ? '✓' : c.state === 'bad' ? '✕' : '○'} {c.text}
                </span>
              ))}
            </div>
          )}
          {step.type !== 'api' && result?.note && (
            <div className="s-checks">
              <span className="idle">{result.note}</span>
            </div>
          )}
          {used.length > 0 && (
            <div className="s-uses">
              {used.map((v) => (
                <span key={v} className="chip var-in" title="Uses this value">
                  ⤷ {v}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="s-ops">
          {result?.durationMs != null && status !== 'skipped' && (
            <span className="s-ms">{formatMs(result.durationMs)}</span>
          )}
          {status === 'skipped' && <span className="s-ms">skipped</span>}
          <div className="s-tools" onClick={(e) => e.stopPropagation()}>
            <IconButton
              icon="up"
              label="Move up"
              disabled={index === 0}
              onClick={() => props.onMove(index - 1)}
            />
            <IconButton
              icon="down"
              label="Move down"
              disabled={index === total - 1}
              onClick={() => props.onMove(index + 1)}
            />
            <IconButton icon="copy" label="Duplicate" onClick={props.onDuplicate} />
            <IconButton
              icon="power"
              label={step.disabled ? 'Turn on' : 'Turn off'}
              onClick={props.onToggleDisabled}
            />
            <IconButton icon="trash" label="Delete" onClick={props.onDelete} />
          </div>
        </div>
      </div>
      <div className={`wire ${produced.length ? 'has' : ''}`}>
        {produced.length > 0 && (
          <>
            <span className="lbl">passes on</span>
            {produced.map((v) => (
              <span key={v} className="chip var-out">{`{{${v}}}`}</span>
            ))}
          </>
        )}
      </div>
    </>
  );
}
