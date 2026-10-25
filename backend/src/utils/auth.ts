import jwt from 'jsonwebtoken';
import { AuthUser, Role } from '../types';

export const AUTH_COOKIE = 'aicte_session';

export function signToken(user: { id: string; role: Role; bureauId: string | null; regionId: string | null }): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return jwt.sign(
    { sub: user.id, role: user.role, bureauId: user.bureauId, regionId: user.regionId },
    secret,
    { expiresIn: (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyToken(token: string): { sub: string } | null {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) return null;
    return jwt.verify(token, secret) as { sub: string };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

export function toPublicUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  bureauId: string | null;
  regionId: string | null;
  bureau?: { id: string; name: string; code: string } | null;
  region?: { id: string; name: string; code: string } | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role as Role,
    bureauId: user.bureauId,
    regionId: user.regionId,
    bureau: user.bureau ?? null,
    region: user.region ?? null,
  };
}
