/** Log server dengan prefix seragam. */
const PREFIX = '[testora]';

export const log = {
  info: (message: string) => console.log(`${PREFIX} ${message}`),
  warn: (message: string) => console.warn(`${PREFIX} ${message}`),
  error: (message: string, error?: unknown) => console.error(`${PREFIX} ${message}`, error ?? ''),
};
