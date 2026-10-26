import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { emitNotification, emitDataChanged } from '../realtime';

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export async function createNotification(
  db: Db,
  data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    link?: string;
    alertId?: string;
    caseId?: string;
    dedupeKey?: string;
  },
) {
  try {
    if (data.dedupeKey) {
      const existing = await db.notification.findUnique({
        where: { userId_dedupeKey: { userId: data.userId, dedupeKey: data.dedupeKey } },
        select: { id: true },
      });
      if (existing) return null;
    }
    const notification = await db.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link,
        alertId: data.alertId,
        caseId: data.caseId,
        dedupeKey: data.dedupeKey,
      },
    });
    emitNotification([data.userId], {
      title: data.title,
      message: data.message,
      link: data.link,
    });
    return notification;
  } catch (err) {
    // The unique key is (userId, dedupeKey): the same event may notify
    // multiple recipients, but each recipient receives it at most once.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    throw err;
  }
}

/** Notify administrators and senior management (unique users). */
export async function getManagementUserIds(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['ADMIN', 'SENIOR_MANAGEMENT'] } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function notifyUsers(
  db: Db,
  userIds: string[],
  data: Omit<Parameters<typeof createNotification>[1], 'userId'>,
) {
  const unique = [...new Set(userIds.filter(Boolean))];
  for (const userId of unique) {
    await createNotification(db, { ...data, userId });
  }
  if (unique.length) emitDataChanged('notifications', 'updated');
}

/**
 * Post-commit notification delivery. Business changes must not be rolled back
 * only because a secondary notification write failed, so failures are logged
 * and surfaced by the notification centre on the next successful delivery.
 */
export async function notifyUsersSafe(
  db: Db,
  userIds: string[],
  data: Omit<Parameters<typeof createNotification>[1], 'userId'>,
) {
  try {
    await notifyUsers(db, userIds, data);
  } catch (err) {
    console.error('[notifications] delivery failed:', err instanceof Error ? err.message : err);
  }
}

export async function markRead(userId: string, notificationId: string) {
  return prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

export async function caseRecipientIds(caseData: {
  assignedOfficerId?: string | null;
  createdById?: string | null;
  currentBureauId?: string | null;
}) {
  const ids: string[] = [];
  if (caseData.assignedOfficerId) ids.push(caseData.assignedOfficerId);
  if (caseData.createdById) ids.push(caseData.createdById);
  if (caseData.currentBureauId) {
    const officers = await prisma.user.findMany({
      where: {
        bureauId: caseData.currentBureauId,
        isActive: true,
        role: { in: ['BUREAU_OFFICER', 'ADMIN'] },
      },
      select: { id: true },
    });
    ids.push(...officers.map((o) => o.id));
  }
  return [...new Set(ids)];
}
