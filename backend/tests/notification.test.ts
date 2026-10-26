import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  caseRecipientIds,
  createNotification,
  markRead,
  notifyUsers,
  notifyUsersSafe,
  unreadCount,
} from '../src/services/notificationService';
import { createFixture, Fixture } from './helpers';

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

const payload = {
  type: 'STATUS_CHANGED',
  title: 'Case updated',
  message: 'A case you follow changed status.',
  link: '/cases/one',
  dedupeKey: 'status:case-1:action-1',
};

describe('notification deduplication', () => {
  it('delivers an event at most once per recipient', async () => {
    const first = await createNotification(prisma, { ...payload, userId: fx.admin.id });
    const duplicate = await createNotification(prisma, { ...payload, userId: fx.admin.id });

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(await prisma.notification.count({ where: { userId: fx.admin.id } })).toBe(1);
  });

  it('allows the same event to reach a different recipient', async () => {
    const a = await createNotification(prisma, { ...payload, userId: fx.admin.id });
    const b = await createNotification(prisma, { ...payload, userId: fx.officerA.id });

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await prisma.notification.count({ where: { dedupeKey: payload.dedupeKey } })).toBe(2);
  });

  it('allows a recipient to receive distinct events under different keys', async () => {
    await createNotification(prisma, { ...payload, userId: fx.admin.id });
    await createNotification(prisma, { ...payload, userId: fx.admin.id, dedupeKey: 'status:case-1:action-2' });
    expect(await prisma.notification.count({ where: { userId: fx.admin.id } })).toBe(2);
  });

  it('notifies each unique recipient exactly once when the list contains repeats', async () => {
    await notifyUsers(prisma, [fx.admin.id, fx.admin.id, fx.officerA.id, ''], {
      type: 'TEST',
      title: 'Batch',
      message: 'Batch message',
      dedupeKey: 'batch:1',
    });
    expect(await prisma.notification.count({ where: { dedupeKey: 'batch:1' } })).toBe(2);
  });

  it('does not fail the business operation when a notification cannot be delivered', async () => {
    await expect(
      notifyUsersSafe(
        prisma,
        ['missing-recipient-id'],
        { type: 'TEST', title: 'Missing', message: 'Missing recipient' },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('notification read state', () => {
  it('marks only the owning user’s notification as read', async () => {
    const own = await prisma.notification.create({
      data: { userId: fx.admin.id, type: 'TEST', title: 'Own', message: 'Own message' },
    });
    const other = await prisma.notification.create({
      data: { userId: fx.officerA.id, type: 'TEST', title: 'Other', message: 'Other message' },
    });

    const wrongUser = await markRead(fx.officerA.id, own.id);
    expect(wrongUser.count).toBe(0);

    const correct = await markRead(fx.admin.id, own.id);
    expect(correct.count).toBe(1);

    const refreshed = await prisma.notification.findUnique({ where: { id: own.id } });
    expect(refreshed?.isRead).toBe(true);
    expect(refreshed?.readAt).toBeInstanceOf(Date);

    const untouched = await prisma.notification.findUnique({ where: { id: other.id } });
    expect(untouched?.isRead).toBe(false);
  });

  it('counts unread notifications per user', async () => {
    await prisma.notification.createMany({
      data: [
        { userId: fx.admin.id, type: 'TEST', title: 'One', message: 'One' },
        { userId: fx.admin.id, type: 'TEST', title: 'Two', message: 'Two', isRead: true },
        { userId: fx.officerA.id, type: 'TEST', title: 'Three', message: 'Three' },
      ],
    });
    expect(await unreadCount(fx.admin.id)).toBe(1);
    expect(await unreadCount(fx.officerA.id)).toBe(1);
  });
});

describe('case recipients', () => {
  it('includes the assigned officer, creator and active officers in the current Bureau', async () => {
    const ids = await caseRecipientIds({
      assignedOfficerId: fx.officerB.id,
      createdById: fx.admin.id,
      currentBureauId: fx.bureauA.id,
    });
    expect(new Set(ids)).toEqual(new Set([fx.officerB.id, fx.admin.id, fx.officerA.id]));
  });

  it('omits inactive officers and deduplicates recipients', async () => {
    await prisma.user.update({ where: { id: fx.officerA.id }, data: { isActive: false } });
    const ids = await caseRecipientIds({
      assignedOfficerId: fx.officerA.id,
      createdById: fx.admin.id,
      currentBureauId: fx.bureauA.id,
    });
    expect(ids).toEqual([fx.officerA.id, fx.admin.id]);
  });
});
