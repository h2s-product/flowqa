import type { ApiStep, BodyField, Environment, FieldType } from '@flowqa/shared';
import { setByPath } from '@flowqa/shared';
import { dynamicGenerators } from './dynamic-variables';

const VARIABLE_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;
const WHOLE_VARIABLE = /^\s*\{\{\s*([\w.]+)\s*\}\}\s*$/;

/**
 * Menyimpan variabel selama satu run dan menerjemahkan {{nama}} menjadi nilai.
 * Urutan prioritas: variabel test (capture) → variabel environment → BASE_URL → generator dinamis.
 */
export class VariableContext {
  private readonly values: Record<string, unknown>;

  constructor(
    private readonly environment: Environment,
    initial: Record<string, unknown> = {},
  ) {
    this.values = { ...initial };
  }

  set(name: string, value: unknown): void {
    this.values[name] = value;
  }

  /** Salinan variabel test yang terkumpul selama run. */
  snapshot(): Record<string, unknown> {
    return { ...this.values };
  }

  private lookup(name: string): { found: boolean; value?: unknown } {
    if (name in this.values) return { found: true, value: this.values[name] };
    const envVar = this.environment.variables.find((v) => v.key === name);
    if (envVar) return { found: true, value: envVar.value };
    if (name === 'BASE_URL') return { found: true, value: this.environment.baseUrl };
    const generator = (dynamicGenerators as Record<string, (() => string) | undefined>)[name];
    if (generator) return { found: true, value: generator() };
    return { found: false };
  }

  /** Ganti semua {{nama}} di teks. Nama yang tidak ditemukan dicatat ke `missing`. */
  resolve(text: string, missing?: string[]): string {
    return text.replace(VARIABLE_PATTERN, (match, name: string) => {
      const { found, value } = this.lookup(name);
      if (!found) {
        missing?.push(name);
        return match;
      }
      return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    });
  }

  /** Resolve lalu konversi ke tipe field body builder. */
  resolveTyped(type: FieldType, raw: string, missing?: string[]): unknown {
    if (type === 'null') return null;
    // Jika seluruh nilai adalah satu variabel non-string, pertahankan tipe aslinya.
    const whole = raw.match(WHOLE_VARIABLE);
    if (whole && type !== 'text') {
      const { found, value } = this.lookup(whole[1]);
      if (found && typeof value !== 'string') return value;
    }
    const resolved = this.resolve(raw, missing);
    if (type === 'number') {
      const n = Number(resolved);
      return resolved === '' || Number.isNaN(n) ? resolved : n;
    }
    if (type === 'boolean') return resolved.toLowerCase() === 'true';
    return resolved;
  }

  buildBodyFromFields(fields: BodyField[], missing?: string[]): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    fields
      .filter((f) => f.field.trim())
      .forEach((f) => setByPath(body, f.field.trim(), this.resolveTyped(f.type, f.value, missing)));
    return body;
  }

  /** Bangun body request sebuah step. Melempar error jika JSON mode tidak valid. */
  buildBody(step: ApiStep, missing?: string[]): unknown {
    if (step.bodyMode === 'json') {
      const text = this.resolve(step.bodyJson ?? '', missing);
      return text.trim() ? JSON.parse(text) : undefined;
    }
    return this.buildBodyFromFields(step.body, missing);
  }
}
