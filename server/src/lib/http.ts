import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { log } from '../lib/log';

/** Error dengan status HTTP; dilempar dari route/service dan dirender oleh errorHandler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

/** Bungkus handler async supaya error diteruskan ke errorHandler Express. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  log.error('unexpected error', error);
  res.status(500).json({ error: 'Unexpected server error' });
}
