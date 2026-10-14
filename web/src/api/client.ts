/**
 * HTTP client tipis untuk backend FlowQA. Semua pemanggilan API lewat sini
 * agar penanganan error & base URL konsisten.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Dikirim saat server membalas 401 (sesi habis) supaya UI kembali ke halaman login. */
export const UNAUTHORIZED_EVENT = 'flowqa:unauthorized';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'same-origin',
    headers: {
      // Wajib untuk request yang mengubah data (perlindungan CSRF di server).
      'X-Requested-With': 'FlowQA',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && !path.startsWith('/auth/'))
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

/** URL lengkap endpoint API (untuk <img src>, link unduhan, dsb.). */
export const apiUrl = (path: string) => `/api${path}`;

/** Query string dari objek; nilai undefined/null/'' dilewati. Mengembalikan '' atau '?a=1&b=2'. */
export function toQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}
