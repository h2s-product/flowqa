/**
 * Satu perangkat = satu sesi Appium aktif. Test/Inspector berikutnya yang
 * butuh perangkat yang sama menunggu (QUEUED) sampai perangkat dilepas, lalu
 * antrean dilanjutkan sesuai urutan datang (FIFO).
 */
import { StoppedError } from '../lib/stop';

interface Waiter {
  ids: string[];
  owner: string;
  resolve: (id: string) => void;
}

export interface DeviceLease {
  udid: string;
  release(): void;
}

export class DeviceLockManager {
  private readonly busy = new Map<string, string>();
  /** Penanda kunci aktif per perangkat: lease lama yang sudah dilepas paksa tidak melepas kunci pemakai baru. */
  private readonly tokens = new Map<string, symbol>();
  private readonly waiters: Waiter[] = [];

  /** Serial yang sedang dipakai → pemakainya (mis. "UI run uir_…"). */
  owners(): Map<string, string> {
    return new Map(this.busy);
  }

  busyIds(): Set<string> {
    return new Set(this.busy.keys());
  }

  queued(): number {
    return this.waiters.length;
  }

  /**
   * Kunci salah satu perangkat dari `ids` (yang pertama bebas). Bila semuanya
   * sedang dipakai, `onQueued` dipanggil sekali lalu menunggu giliran.
   * `signal` dihentikan (Stop) saat masih antre → keluar dari antrean.
   */
  async acquire(
    ids: string[],
    owner: string,
    onQueued?: () => void,
    signal?: AbortSignal,
  ): Promise<DeviceLease> {
    if (!ids.length) throw new Error('No device to lock.');
    if (signal?.aborted) throw new StoppedError();
    const free = ids.find((id) => !this.busy.has(id));
    let udid: string;
    if (free && !this.waiters.some((w) => w.ids.includes(free))) udid = free;
    else {
      onQueued?.();
      udid = await new Promise<string>((resolve, reject) => {
        const waiter: Waiter = {
          ids,
          owner,
          resolve: (id) => {
            signal?.removeEventListener('abort', leave);
            resolve(id);
          },
        };
        const leave = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new StoppedError());
        };
        signal?.addEventListener('abort', leave, { once: true });
        this.waiters.push(waiter);
      });
    }
    this.busy.set(udid, owner);
    const token = Symbol(owner);
    this.tokens.set(udid, token);
    let released = false;
    return {
      udid,
      release: () => {
        if (released) return;
        released = true;
        // Sudah dilepas paksa (Force stop) dan mungkin dipakai pemakai lain: jangan diganggu.
        if (this.tokens.get(udid) !== token) return;
        this.tokens.delete(udid);
        this.busy.delete(udid);
        this.next(udid);
      },
    };
  }

  /**
   * Lepas kunci perangkat secara paksa (Force stop emulator). Penunggu di antrean
   * untuk perangkat ini dilanjutkan seperti biasa.
   */
  forceRelease(udid: string): boolean {
    if (!this.busy.has(udid)) return false;
    this.tokens.delete(udid);
    this.busy.delete(udid);
    this.next(udid);
    return true;
  }

  /** Beri perangkat yang baru dilepas ke penunggu pertama yang bisa memakainya. */
  private next(udid: string) {
    const index = this.waiters.findIndex((w) => w.ids.includes(udid));
    if (index < 0) return;
    const [waiter] = this.waiters.splice(index, 1);
    // Tandai langsung supaya tidak diambil pemanggil acquire() lain di tick yang sama.
    this.busy.set(udid, waiter.owner);
    this.tokens.delete(udid);
    waiter.resolve(udid);
  }
}
