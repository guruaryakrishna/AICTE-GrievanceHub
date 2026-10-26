import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequest, Unauthorized } from '../utils/errors';
import { loginSchema } from '../validators/schemas';
import { verifyPassword } from '../utils/password';
import { AUTH_COOKIE, cookieOptions, signToken, toPublicUser } from '../utils/auth';
import { writeAudit } from '../services/auditService';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const body = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
    include: { bureau: true, region: true },
  });
  if (!user) throw Unauthorized('Invalid email or password');
  if (!user.isActive) throw Unauthorized('Your account has been deactivated');
  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) throw Unauthorized('Invalid email or password');

  const token = signToken({ id: user.id, role: user.role as any, bureauId: user.bureauId, regionId: user.regionId });
  res.cookie(AUTH_COOKIE, token, cookieOptions());
  await writeAudit(toPublicUser(user), 'LOGIN', 'User', user.id, null, req);
  res.json({ user: toPublicUser(user) });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { bureau: true, region: true },
  });
  if (!user || !user.isActive) throw Unauthorized('Account unavailable');
  res.json({ user: toPublicUser(user) });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  if (req.user) {
    await writeAudit(req.user, 'LOGOUT', 'User', req.user.id, null, req);
  }
  res.clearCookie(AUTH_COOKIE, { ...cookieOptions(), maxAge: 0 });
  res.json({ message: 'Logged out successfully' });
});
