/**
 * Konversi body request antara visual builder (daftar field) dan JSON
 * ("Advanced JSON"). Dipakai editor API dan step scenario.
 */
import type { BodyField } from '@flowqa/shared';
import { flattenObject } from '@flowqa/shared';

/** Field → JSON (dot notation menjadi object bersarang). */
function fieldsToJson(fields: BodyField[]): string {
  const out: Record<string, unknown> = {};
  for (const f of fields.filter((x) => x.field)) {
    const value =
      f.type === 'number' && f.value !== '' && !Number.isNaN(Number(f.value))
        ? Number(f.value)
        : f.type === 'boolean'
          ? f.value === 'true'
          : f.type === 'null'
            ? null
            : f.value;
    f.field.split('.').reduce<Record<string, unknown>>((node, key, i, keys) => {
      if (i === keys.length - 1) node[key] = value;
      else node[key] = (node[key] as Record<string, unknown>) ?? {};
      return node[key] as Record<string, unknown>;
    }, out);
  }
  return JSON.stringify(out, null, 2);
}

function jsonToFields(json: string): BodyField[] {
  return flattenObject(JSON.parse(json || '{}')).map(([field, v]) => ({
    field,
    type:
      typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : v === null ? 'null' : 'text',
    value: v === null ? '' : String(v),
  }));
}

/** Field → JSON. Angka berupa {{variabel}} ditulis tanpa kutip agar tetap bertipe number. */
export function bodyToJson(body: BodyField[]): string {
  const marked = body.map((f) =>
    f.type === 'number' && /^\{\{.+\}\}$/.test(f.value.trim())
      ? { ...f, type: 'text' as const, value: `__RAW__${f.value}` }
      : f,
  );
  return fieldsToJson(marked).replace(/"__RAW__(.*?)"/g, '$1');
}

/** JSON → field. {{variabel}} tanpa kutip dibaca sebagai field bertipe number. Melempar error bila JSON tidak valid. */
export function jsonToBody(json: string): BodyField[] {
  const quoted = json.replace(/:\s*(\{\{[\w.]+\}\})(\s*[,}\n])/g, ':"__NUM__$1"$2');
  return jsonToFields(quoted).map((f) =>
    f.value.startsWith('__NUM__') ? { ...f, type: 'number', value: f.value.slice(7) } : f,
  );
}
