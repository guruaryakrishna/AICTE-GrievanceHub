import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { Unauthorized } from '../utils/errors';
import { paginationSchema } from '../utils/pagination';
import { markRead, unreadCount } from '../services/notificationService';

export const list = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const unreadOnly = (typeof q.unreadOnly === 'string' ? q.unreadOnly : Array.isArray(q.unreadOnly) ? q.unreadOnly[0] : 'false') === 'true';
  const where = { userId: req.user.id, ...(unreadOnly ? { isRead: false } : {}) };
  const [total, items, count] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
  ]);
  res.json({ items, total, unreadCount: count });
});

export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await markRead(req.user.id, id);
  res.json({ success: true });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  res.json({ success: true });
});

export const count = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  res.json({ unreadCount: await unreadCount(req.user.id) });
});
