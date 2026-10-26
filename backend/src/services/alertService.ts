import { prisma } from '../config/prisma';
import { BadRequest, Forbidden, NotFound } from '../utils/errors';
import { AuthUser } from '../types';
import { writeAudit, writeCaseAction } from './auditService';
import { notifyUsersSafe } from './notificationService';
import { emitDataChanged } from '../realtime';
import { alertScopeWhere, canReviewAlerts } from './authorization';

export { alertScopeWhere } from './authorization';

export const ALERT_TRANSITIONS: Record<string, string[]> = {
  NEW: ['UNDER_REVIEW', 'COORDINATION_REQUIRED', 'RESOLVED', 'DISMISSED'],
  UNDER_REVIEW: ['COORDINATION_REQUIRED', 'RESOLVED', 'DISMISSED'],
  COORDINATION_REQUIRED: ['UNDER_REVIEW', 'RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
};

const TERMINAL = ['RESOLVED', 'DISMISSED'];

export async function listAlerts(
  user: AuthUser,
  filters: {
    status?: string[];
    alertType?: string;
    institutionId?: string;
    q?: string;
    page: number;
    pageSize: number;
  },
) {
  const where = {
    AND: [
      alertScopeWhere(user),
      filters.status?.length ? { status: { in: filters.status } } : {},
      filters.alertType ? { alertType: filters.alertType } : {},
      filters.institutionId ? { institutionId: filters.institutionId } : {},
      filters.q
        ? {
            OR: [
              { detectionReason: { contains: filters.q } },
              { institution: { name: { contains: filters.q } } },
              { institution: { aictePermanentId: { contains: filters.q } } },
            ],
          }
        : {},
    ],
  };

  const [total, items] = await Promise.all([
    prisma.overlapAlert.count({ where }),
    prisma.overlapAlert.findMany({
      where,
      include: {
        institution: { select: { id: true, name: true, aictePermanentId: true, state: true } },
        cases: {
          include: {
            case: {
              include: {
                currentBureau: true,
                assignedOfficer: { select: { id: true, firstName: true, lastName: true } },
                category: true,
              },
            },
          },
        },
        reviews: {
          include: { reviewedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { timestamp: 'desc' },
        },
      },
      orderBy: [{ status: 'asc' }, { firstDetectedAt: 'desc' }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return { items, total };
}

export async function getAlertOrThrow(user: AuthUser, id: string) {
  const alert = await prisma.overlapAlert.findUnique({
    where: { id },
    include: {
      institution: { include: { region: true } },
      cases: {
        include: {
          case: {
            include: {
              currentBureau: true,
              category: true,
              assignedOfficer: { select: { id: true, firstName: true, lastName: true, email: true } },
              actionHistory: {
                include: { performedBy: { select: { id: true, firstName: true, lastName: true } } },
                orderBy: { timestamp: 'desc' },
                take: 10,
              },
            },
          },
        },
      },
      reviews: {
        include: { reviewedBy: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { timestamp: 'desc' },
      },
    },
  });
  if (!alert) throw NotFound('Alert not found');

  const allowed = await prisma.overlapAlert.findFirst({ where: { AND: [{ id }, alertScopeWhere(user)] } });
  if (!allowed) throw Forbidden('You do not have access to this alert');
  return alert;
}

export async function reviewAlert(
  user: AuthUser,
  alertId: string,
  input: {
    status: string;
    remarks?: string | null;
    outcome?: string | null;
    dismissalReason?: string | null;
    assignedCoordinatorId?: string | null;
  },
) {
  if (!canReviewAlerts(user)) throw Forbidden('Read-only users cannot review alerts');
  const alert = await getAlertOrThrow(user, alertId);
  if (TERMINAL.includes(alert.status)) {
    throw BadRequest(`Alert is already ${alert.status.toLowerCase()} and cannot be changed`);
  }
  if (!ALERT_TRANSITIONS[alert.status]?.includes(input.status)) {
    throw BadRequest(`Invalid alert transition from ${alert.status} to ${input.status}`);
  }
  if (input.status === 'DISMISSED' && !input.dismissalReason?.trim()) {
    throw BadRequest('A dismissal reason is required');
  }
  if (input.status === 'RESOLVED' && !input.outcome?.trim()) {
    throw BadRequest('A resolution outcome is required');
  }
  if (input.assignedCoordinatorId) {
    const coordinator = await prisma.user.findUnique({ where: { id: input.assignedCoordinatorId } });
    if (!coordinator || !coordinator.isActive) throw BadRequest('Invalid coordinator');
  }

  const { reviewId } = await prisma.$transaction(async (tx) => {
    const updated = await tx.overlapAlert.update({
      where: { id: alertId },
      data: {
        status: input.status,
        reviewerRemarks: input.remarks ?? alert.reviewerRemarks,
        resolutionOutcome: input.outcome ?? alert.resolutionOutcome,
        dismissalReason: input.dismissalReason ?? alert.dismissalReason,
        assignedCoordinatorId: input.assignedCoordinatorId ?? alert.assignedCoordinatorId,
        resolvedAt: TERMINAL.includes(input.status) ? new Date() : null,
      },
    });
    const review = await tx.alertReview.create({
      data: {
        alertId,
        reviewedById: user.id,
        action: input.status,
        remarks: input.remarks ?? null,
        outcome: input.outcome ?? input.dismissalReason ?? null,
      },
    });
    for (const link of alert.cases) {
      await writeCaseAction(tx, {
        caseId: link.caseId,
        actionType: `ALERT_${input.status}`,
        performedById: user.id,
        remarks: input.remarks || input.outcome || input.dismissalReason || null,
        alertId,
        metadata: { alertType: alert.alertType, previousStatus: alert.status, newStatus: input.status },
      } as any);
    }
    return { updated, reviewId: review.id };
  });

  await writeAudit(user, 'ALERT_REVIEWED', 'OverlapAlert', alertId, {
    from: alert.status,
    to: input.status,
    outcome: input.outcome,
  });
  emitDataChanged('alerts', 'reviewed', alertId);

  const coordinator = input.assignedCoordinatorId
    ? await prisma.user.findUnique({ where: { id: input.assignedCoordinatorId }, select: { id: true } })
    : null;
  const officerIds = alert.cases
    .map((l) => (l as unknown as { case?: { assignedOfficerId?: string } }).case?.assignedOfficerId)
    .filter((id): id is string => Boolean(id));
  const management = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['ADMIN', 'SENIOR_MANAGEMENT'] } },
    select: { id: true },
  });
  await notifyUsersSafe(
    prisma,
    [...officerIds, ...management.map((m) => m.id), ...(coordinator ? [coordinator.id] : []), alert.assignedCoordinatorId ?? ''].filter(
      Boolean,
    ),
    {
      type: 'COORDINATION_REQUEST',
      title: `Overlap alert ${input.status.replace(/_/g, ' ').toLowerCase()}`,
      message: `${alert.institution?.name ?? 'Institution'}: ${
        input.outcome || input.dismissalReason || input.remarks || 'Alert reviewed.'
      }`,
      link: `/overlaps/${alertId}`,
      alertId,
      // Each review is a discrete event; the review id makes this idempotent
      // per recipient while still allowing later reviews to notify again.
      dedupeKey: `alert-review:${reviewId}`,
    },
  );
  // Return the same decorated shape as the detail endpoint so callers can
  // update the UI from the response instead of issuing a redundant request.
  return getAlertOrThrow(user, alertId);
}
