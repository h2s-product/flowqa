import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AuthStatus } from '@flowqa/shared';
import { HttpError, asyncHandler } from '../lib/http';
import type { AppContext } from './context';

export const SESSION_COOKIE = 'flowqa_session';
/** Header wajib untuk request yang mengubah data (perlindungan CSRF tambahan di atas SameSite). */
export const CLIENT_HEADER = 'x-requested-with';

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: maxAgeMs,
  });
}

/** Tolak request non-GET tanpa header X-Requested-With (form lintas situs tidak bisa mengirimnya). */
export function requireClientHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.headers[CLIENT_HEADER]) return next();
  next(new HttpError(403, 'Missing X-Requested-With header'));
}

/** Middleware: hanya teruskan request dengan sesi valid. User tersedia di res.locals.user. */
export function requireAuth(ctx: AppContext) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = ctx.auth.authenticate(readSessionToken(req));
    if (!user) return next(new HttpError(401, 'Please sign in to continue'));
    res.locals.user = user;
    next();
  };
}

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    '/auth/status',
    asyncHandler((req, res) => {
      const status: AuthStatus = {
        user: ctx.auth.authenticate(readSessionToken(req)) ?? null,
        setupRequired: ctx.auth.setupRequired,
      };
      res.json(status);
    }),
  );

  /** Buat akun admin pertama, lalu langsung login. */
  router.post(
    '/auth/setup',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      await ctx.auth.setup(body);
      const session = await ctx.auth.login(body.email, body.password, req.ip ?? '');
      setSessionCookie(req, res, session.token, session.maxAgeMs);
      res.status(201).json({ user: session.user, setupRequired: false } satisfies AuthStatus);
    }),
  );

  router.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const session = await ctx.auth.login(req.body?.email, req.body?.password, req.ip ?? '');
      setSessionCookie(req, res, session.token, session.maxAgeMs);
      res.json({ user: session.user, setupRequired: false } satisfies AuthStatus);
    }),
  );

  router.post(
    '/auth/logout',
    asyncHandler((req, res) => {
      ctx.auth.logout(readSessionToken(req));
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.status(204).end();
    }),
  );

  return router;
}
