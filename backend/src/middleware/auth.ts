import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/prisma';
import { AUTH_COOKIE, toPublicUser, verifyToken } from '../utils/auth';
import { Forbidden, Unauthorized } from '../utils/errors';
import { Role } from '../types';

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[AUTH_COOKIE];
    if (!token) return next(Unauthorized());
    const payload = verifyToken(token);
    if (!payload) return next(Unauthorized('Session expired or invalid'));
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { bureau: true, region: true },
    });
    if (!user || !user.isActive) return next(Unauthorized('Account is inactive or unavailable'));
    req.user = toPublicUser(user);
    next();
  } catch (err) {
    next(err);
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Unauthorized());
    if (roles.length && !roles.includes(req.user.role)) {
      return next(Forbidden('Your role does not permit this operation'));
    }
    next();
  };
}

export function requireWritable(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(Unauthorized());
  if (req.user.role === 'READ_ONLY') {
    return next(Forbidden('Read-only users cannot modify records'));
  }
  next();
}

export const isAdmin = (req: Request) => req.user?.role === 'ADMIN';
export const canManageAll = (req: Request) =>
  req.user?.role === 'ADMIN' || req.user?.role === 'SENIOR_MANAGEMENT';
