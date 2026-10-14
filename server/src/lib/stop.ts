/**
 * Menghentikan run yang sedang berjalan ("Stop"). Setiap run punya satu
 * AbortSignal; sinyal itu diteruskan ke semua proses turunannya (request HTTP,
 * browser, sesi Appium, antrean perangkat, API scenario di dalam UI test,
 * node E2E Flow) sehingga semuanya berhenti bersama.
 */

/** Dilempar saat run dihentikan pengguna. */
export class StoppedError extends Error {
  constructor(message = 'Stopped by user') {
    super(message);
    this.name = 'StoppedError';
  }
}

export const isStopped = (error: unknown): error is StoppedError => error instanceof StoppedError;

/**
 * Tunggu `promise`, atau lempar StoppedError begitu `signal` dihentikan.
 * Promise aslinya tetap berjalan di belakang; kegagalannya nanti diabaikan.
 */
export function untilStopped<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  promise.catch(() => {});
  if (signal.aborted) return Promise.reject(new StoppedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new StoppedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Hubungkan run anak ke run induk: induk dihentikan → anak ikut berhenti. */
export function linkSignal(controller: AbortController, parent?: AbortSignal): void {
  if (!parent) return;
  // `reason` = nama pengguna yang menekan Stop; diteruskan ke run anak.
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
}

/** Nama pengguna yang menekan Stop (disimpan sebagai `reason` sinyal). */
export function stoppedByOf(signal: AbortSignal): string | undefined {
  return signal.aborted && typeof signal.reason === 'string' ? signal.reason : undefined;
}

/** Jalankan `fn` sekali saja (mis. melepas sesi Appium dari dua tempat). */
export function once(fn: () => Promise<void>): () => Promise<void> {
  let done: Promise<void> | null = null;
  return () => (done ??= fn());
}
