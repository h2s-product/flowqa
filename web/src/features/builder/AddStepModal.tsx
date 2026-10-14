import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiDefinition, AssertionKind, Step } from '@flowqa/shared';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { MethodBadge } from '@/components/ui';
import { createApiStep, createConditionStep, createSetVariableStep, createWaitStep } from './step-factory';

export type AddStepAction =
  | { kind: 'insert'; step: Step }
  | { kind: 'assertion'; assertion: AssertionKind }
  | { kind: 'openTab'; tab: 'capture' | 'settings' };

interface Props {
  apis: ApiDefinition[];
  /** Step yang sedang dipilih; validasi & capture ditambahkan ke step ini. */
  currentStep?: Step;
  currentIndex: number;
  onAction: (action: AddStepAction) => void;
  onClose: () => void;
}

function Option({
  title,
  description,
  onClick,
  locked,
}: {
  title: string;
  description: string;
  onClick?: () => void;
  locked?: boolean;
}): ReactNode {
  return (
    <button className={`opt ${locked ? 'locked' : ''}`} disabled={locked} onClick={onClick}>
      <div>
        <b>{title}</b>
        <small>{description}</small>
      </div>
      {locked && (
        <span style={{ marginLeft: 'auto' }}>
          <Icon name="lock" size={14} />
        </span>
      )}
    </button>
  );
}

export function AddStepModal({ apis, currentStep, currentIndex, onAction, onClose }: Props) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();
  const filtered = apis.filter((a) => !q || `${a.name} ${a.path} ${a.method}`.toLowerCase().includes(q));
  const isApi = currentStep?.type === 'api';
  const insert = (step: Step) => onAction({ kind: 'insert', step });

  return (
    <Modal wide title="Add step" subtitle="Choose what happens next in the scenario." onClose={onClose}>
      <div className="cat">
        <h5>API request</h5>
        <input
          className="in"
          autoFocus
          placeholder="Search APIs in the catalog"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <div
          style={{
            maxHeight: 260,
            overflow: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))',
            gap: 2,
          }}
        >
          {filtered.map((a) => (
            <div
              key={a.id}
              className="api-pick"
              role="button"
              tabIndex={0}
              onClick={() => insert(createApiStep(a, { captureToken: true }))}
              onKeyDown={(e) => e.key === 'Enter' && insert(createApiStep(a))}
            >
              <MethodBadge method={a.method} />
              <div style={{ minWidth: 0 }}>
                <b>{a.name}</b>
                <div
                  className="code small muted"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {a.path}
                </div>
              </div>
            </div>
          ))}
          {!filtered.length && (
            <div className="muted small" style={{ padding: 8 }}>
              No APIs found. <Link to="/apis">Add one to the catalog</Link>.
            </div>
          )}
        </div>
      </div>

      <div className="cat">
        <h5>
          Validation{' '}
          {isApi && (
            <span style={{ fontWeight: 400 }}>
              · adds a check to step {currentIndex + 1}, “{currentStep?.name}”
            </span>
          )}
        </h5>
        <div className="opt-grid">
          <Option
            title="Response status"
            description="Status code equals 200"
            locked={!isApi}
            onClick={() => onAction({ kind: 'assertion', assertion: 'status' })}
          />
          <Option
            title="Response field"
            description="A value in the response"
            locked={!isApi}
            onClick={() => onAction({ kind: 'assertion', assertion: 'field' })}
          />
          <Option
            title="Response schema"
            description="Required fields are present"
            locked={!isApi}
            onClick={() => onAction({ kind: 'assertion', assertion: 'schema' })}
          />
          <Option
            title="Response time"
            description="Faster than a limit"
            locked={!isApi}
            onClick={() => onAction({ kind: 'assertion', assertion: 'time' })}
          />
        </div>
        {!isApi && <p className="hint">Select an API step first to add checks to it.</p>}
      </div>

      <div className="cat">
        <h5>Data</h5>
        <div className="opt-grid">
          <Option
            title="Set variable"
            description="Save a fixed or combined value"
            onClick={() => insert(createSetVariableStep())}
          />
          <Option
            title="Capture response value"
            description="Pass a value to later steps"
            locked={!isApi}
            onClick={() => onAction({ kind: 'openTab', tab: 'capture' })}
          />
          <Option
            title="Generate random data"
            description="Name, email or phone"
            onClick={() => insert(createSetVariableStep('{{random_email}}', 'customer_email'))}
          />
          <Option
            title="Generate UUID"
            description="Unique ID for each run"
            onClick={() => insert(createSetVariableStep('{{uuid}}', 'request_id'))}
          />
          <Option
            title="Generate timestamp"
            description="Current date and time"
            onClick={() => insert(createSetVariableStep('{{timestamp}}', 'run_timestamp'))}
          />
        </div>
      </div>

      <div className="cat">
        <h5>Flow control</h5>
        <div className="opt-grid">
          <Option
            title="Condition (if / else)"
            description="Skip steps when a check is false"
            onClick={() => insert(createConditionStep())}
          />
          <Option
            title="Wait"
            description="Pause before continuing"
            onClick={() => insert(createWaitStep())}
          />
          <Option
            title="Retry"
            description="On each API step’s Settings tab"
            locked={!isApi}
            onClick={() => onAction({ kind: 'openTab', tab: 'settings' })}
          />
          <Option
            title="Loop"
            description="Repeat a request, on the Settings tab"
            locked={!isApi}
            onClick={() => onAction({ kind: 'openTab', tab: 'settings' })}
          />
        </div>
      </div>

      <div className="cat">
        <h5>Database · Enterprise</h5>
        <div className="opt-grid">
          <Option title="Execute SQL" description="Prepare or clean test data" locked />
          <Option title="Verify database value" description="Check a row after an API call" locked />
        </div>
      </div>
    </Modal>
  );
}
