import type { KeyValue } from '@flowqa/shared';
import { Icon } from './Icon';
import { IconButton } from '@/components/ui';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}

/** Tabel sederhana untuk pasangan key/value (header, query, dll). */
export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = 'name',
  valuePlaceholder = 'value',
  addLabel = 'Add row',
}: Props) {
  const update = (index: number, patch: Partial<KeyValue>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <>
      <table className="kv">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td style={{ width: '34%' }}>
                <input
                  className="in code"
                  value={row.key}
                  placeholder={keyPlaceholder}
                  onChange={(e) => update(i, { key: e.target.value })}
                />
              </td>
              <td>
                <input
                  className="in code"
                  value={row.value}
                  placeholder={valuePlaceholder}
                  onChange={(e) => update(i, { value: e.target.value })}
                />
              </td>
              <td style={{ width: 30 }}>
                <IconButton
                  icon="trash"
                  label="Remove"
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
        onClick={() => onChange([...rows, { key: '', value: '' }])}
      >
        <Icon name="plus" size={14} /> {addLabel}
      </button>
    </>
  );
}
