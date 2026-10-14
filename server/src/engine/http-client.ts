import { Agent, ProxyAgent, fetch, type Dispatcher } from 'undici';
import type { HttpMethod } from '@flowqa/shared';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  verifySsl: boolean;
  proxy?: string;
  /** Run dihentikan (Stop) → request dibatalkan. */
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  sizeBytes: number;
  durationMs: number;
}

/** Kesalahan jaringan (DNS, koneksi ditolak, timeout) — berbeda dari response HTTP error. */
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'connection' | 'other',
    readonly durationMs: number,
  ) {
    super(message);
  }
}

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/** Implementasi HTTP client nyata berbasis undici (fetch bawaan Node). */
export class UndiciHttpClient implements HttpClient {
  private readonly dispatchers = new Map<string, Dispatcher>();

  private dispatcher(verifySsl: boolean, proxy?: string): Dispatcher {
    const key = `${verifySsl}|${proxy ?? ''}`;
    let dispatcher = this.dispatchers.get(key);
    if (!dispatcher) {
      const connect = { rejectUnauthorized: verifySsl };
      dispatcher = proxy ? new ProxyAgent({ uri: proxy, requestTls: connect }) : new Agent({ connect });
      this.dispatchers.set(key, dispatcher);
    }
    return dispatcher;
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    const started = performance.now();
    const hasBody = request.body !== undefined && request.method !== 'GET';
    const contentType = request.headers['Content-Type'] ?? 'application/json';
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? serializeBody(request.body, contentType) : undefined,
        signal: request.signal
          ? AbortSignal.any([AbortSignal.timeout(request.timeoutMs), request.signal])
          : AbortSignal.timeout(request.timeoutMs),
        dispatcher: this.dispatcher(request.verifySsl, request.proxy || undefined),
      });
      const raw = await response.text();
      const durationMs = performance.now() - started;
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => (headers[key] = value));
      return {
        status: response.status,
        statusText: response.statusText,
        headers,
        body: parseBody(raw, headers['content-type']),
        sizeBytes: Buffer.byteLength(raw),
        durationMs,
      };
    } catch (error) {
      const durationMs = performance.now() - started;
      const err = error as Error & { cause?: { code?: string; message?: string } };
      if (request.signal?.aborted) throw new NetworkError('The run was stopped', 'other', durationMs);
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new NetworkError(`No response within ${request.timeoutMs} ms`, 'timeout', durationMs);
      }
      const code = err.cause?.code;
      const message = code ? `${code}: ${err.cause?.message ?? err.message}` : err.message;
      throw new NetworkError(message, code ? 'connection' : 'other', durationMs);
    }
  }
}

function serializeBody(body: unknown, contentType: string): string {
  if (typeof body === 'string') return body;
  if (contentType.includes('application/x-www-form-urlencoded') && body && typeof body === 'object') {
    return new URLSearchParams(
      Object.entries(body as Record<string, unknown>).map(([k, v]): [string, string] => [
        k,
        typeof v === 'object' ? JSON.stringify(v) : String(v),
      ]),
    ).toString();
  }
  return JSON.stringify(body);
}

function parseBody(raw: string, contentType = ''): unknown {
  if (!raw) return null;
  if (contentType.includes('json') || /^\s*[[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      /* bukan JSON valid, kembalikan teks */
    }
  }
  return raw;
}
