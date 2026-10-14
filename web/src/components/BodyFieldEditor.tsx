import type { ReactNode } from 'react';
import type { BodyField, FieldType } from '@flowqa/shared';
import { Icon } from './Icon';
import { IconButton } from '@/components/ui';

const TYPES: { id: FieldType; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'boolean', label: 'Boolean' },
  { id: 'null', label: 'Null' },
];

interface Props {
  rows: BodyField[];
  onChange: (rows: BodyField[]) => void;
  /** Elemen tambahan di samping input value, mis. pemilih variabel. */
  renderValueExtras?: (row: BodyField, index: number) => ReactNode;
  renderHint?: (row: BodyField) => ReactNode;
}

/** Visual JSON body builder: Field | Type | Value. */
export function BodyFieldEditor({ rows, onChange, renderValueExtras, renderHint }: Props) {
  const update = (index: number, patch: Partial<BodyField>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <>
      <table className="kv">
        <thead>
          <tr>
            <th style={{ width: '30%' }}>Field</th>
            <th style={{ width: 110 }}>Type</th>
            <th>Value</th>
            {renderHint && <th />}
            <th style={{ width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  className="in code"
                  value={row.field}
                  placeholder="field or address.city"
                  onChange={(e) => update(i, { field: e.target.value })}
                />
              </td>
              <td>
                <select
                  className="in"
                  value={row.type}
                  onChange={(e) => update(i, { type: e.target.value as FieldType })}
                >
                  {TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {row.type === 'boolean' ? (
                  <select
                    className="in"
                    value={row.value === 'false' ? 'false' : 'true'}
                    onChange={(e) => update(i, { value: e.target.value })}
                  >
                    <option>true</option>
                    <option>false</option>
                  </select>
                ) : row.type === 'null' ? (
                  <span className="muted small">null</span>
                ) : (
                  <div className="row" style={{ gap: 4 }}>
                    <input
                      className="in code"
                      value={row.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                    />
                    {renderValueExtras?.(row, i)}
                  </div>
                )}
              </td>
              {renderHint && <td style={{ width: '1%' }}>{renderHint(row)}</td>}
              <td>
                <IconButton
                  icon="trash"
                  label="Remove field"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn sm ghost"
        style={{ marginTop: 6 }}
        onClick={() => onChange([...rows, { field: '', type: 'text', value: '' }])}
      >
        <Icon name="plus" size={14} /> Add field
      </button>
    </>
  );
}
