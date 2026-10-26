import { NextFunction, Request, Response } from 'express';

/**
 * Dependency-free security headers. Equivalent intent to Helmet for a JSON
 * API: no inline scripts are served, framing is denied and MIME sniffing is
 * disabled.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  if (process.env.COOKIE_SECURE === 'true') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small fixed-window in-memory limiter. Suitable for a single-process
 * demonstration deployment; a multi-instance deployment should use a shared
 * store (Redis) instead.
 */
export function rateLimit(options: { windowMs: number; max: number; keyPrefix?: string }) {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const scope = options.keyPrefix ?? 'default';
    const key = `${scope}:${req.ip ?? 'unknown'}`;
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      res.setHeader('X-RateLimit-Limit', String(options.max));
      res.setHeader('X-RateLimit-Remaining', String(options.max - 1));
      return next();
    }

    current.count++;
    const remaining = Math.max(0, options.max - current.count);
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(current.resetAt / 1000)));
    if (current.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait and try again.',
        },
      });
    }
    next();
  };
}
