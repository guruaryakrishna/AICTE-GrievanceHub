import { Request, Response, NextFunction } from 'express';
import { Forbidden } from '../utils/errors';

/**
 * Protect state-changing requests against cross-origin use. Combined with
 * SameSite=lax/secure cookies, this provides CSRF protection without exposing
 * tokens to JavaScript. Requests without an Origin header (same-origin tools,
 * health checks) are allowed; browser cross-origin requests always carry one.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  const allowed = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());
  if (allowed.includes(origin)) return next();

  return next(Forbidden('Cross-origin request rejected'));
}
