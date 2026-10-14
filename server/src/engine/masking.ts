import type { Environment } from '@flowqa/shared';
import { SECRET_MASK } from '@flowqa/shared';

/**
 * Menyamarkan nilai rahasia sebelum disimpan ke hasil run / log.
 * Prinsip: nilai secret TIDAK PERNAH keluar dari server dalam bentuk asli.
 */
export class SecretMasker {
  private readonly secrets: string[];

  constructor(environment: Environment) {
    this.secrets = environment.variables
      .filter((v) => v.secret && v.value.length >= 3)
      .map((v) => v.value)
      .sort((a, b) => b.length - a.length);
  }

  text(value: string): string {
    return this.secrets.reduce((acc, secret) => acc.split(secret).join(SECRET_MASK), value);
  }

  value<T>(value: T): T {
    if (value === undefined) return value;
    try {
      return JSON.parse(this.text(JSON.stringify(value))) as T;
    } catch {
      return value;
    }
  }

  /** Samarkan header sensitif (Authorization, Cookie) selain secret environment. */
  headers(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(headers)) {
      const value = this.text(raw);
      const lower = key.toLowerCase();
      if (lower === 'authorization') out[key] = maskToken(value);
      else if (lower === 'cookie' || lower === 'set-cookie')
        out[key] = value.replace(/=([^;]{4})[^;]*/g, '=$1••••');
      else out[key] = value;
    }
    return out;
  }
}

function maskToken(value: string): string {
  const match = value.match(/^(\w+)\s+(.+)$/);
  if (!match || match[2].length < 12 || match[2].includes('{{')) return value;
  const token = match[2];
  return `${match[1]} ${token.slice(0, 6)}••••${token.slice(-4)}`;
}
