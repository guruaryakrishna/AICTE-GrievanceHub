import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { BadRequest, Forbidden, NotFound } from '../utils/errors';
import { AuthUser } from '../types';
import {
  ACTIVE_CASE_STATUSES,
  OPEN_CASE_STATUSES,
  assertManualTransition,
  assertWorkflowTransition,
  manualStatusTargets,
  WorkflowPolicyError,
} from '../domain/casePolicy';
import { computeSlaDueDate, overdueCaseWhere } from '../domain/slaPolicy';
import {
  canAccessCase,
  canModifyCase,
  caseScopeWhere,
  isReadOnly,
} from './authorization';
import { writeAudit, writeCaseAction } from './auditService';
import {
  caseRecipientIds,
  createNotification,
  getManagementUserIds,
  notifyUsersSafe,
} from './notificationService';
import { emitDataChanged } from '../realtime';
import { evaluateInstitutionOverlaps } from './matching/overlapDetection';
import { findInstitutionCandidates } from './matching/institutionMatcher';
import { activeSlaRules, decorateWithSla, ruleForCase } from './slaRules';

export { caseScopeWhere, canAccessCase, canModifyCase } from './authorization';

const caseInclude = Prisma.validator<Prisma.CaseInclude>()({
  institution: { include: { region: true } },
  category: true,
  currentBureau: true,
  assignedOfficer: { select: { id: true, firstName: true, lastName: true, email: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  actionHistory: {
    include: { performedBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { timestamp: 'desc' },
  },
  alerts: {
    include: {
      alert: {
        include: {
          cases: {
            include: {
              case: {
                select: {
                  id: true,
                  caseNumber: true,
                  title: true,
                  status: true,
                  currentBureau: { select: { id: true, name: true, code: true } },
                  category: { select: { id: true, name: true, code: true } },
                },
              },
            },
          },
          reviews: {
            include: { reviewedBy: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { timestamp: 'desc' },
          },
        },
      },
    },
  },
  identityResolution: {
    include: {
      resolvedInstitution: { select: { id: true, name: true, aictePermanentId: true } },
      resolvedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  },
});

type CasePayload = Prisma.CaseGetPayload<{ include: typeof caseInclude }>;

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function policyError(err: unknown): never {
  if (err instanceof WorkflowPolicyError) throw BadRequest(err.message);
  throw err;
}

function decorateCase(c: CasePayload, user: AuthUser, rules: Awaited<ReturnType<typeof activeSlaRules>>, now = new Date()) {
  const canModify = canModifyCase(user, c);
  const isClosed = c.status === 'DISPOSED';
  const actions: string[] = [];
  if (canModify) {
    if (isClosed) actions.push('reopen');
    else actions.push('transfer', 'escalate', 'dispose');
  }
  return {
    ...decorateWithSla(c, rules, now),
    permissions: {
      canModify,
      canAssign: canModify,
      canAddAction: canModify,
      canTransfer: canModify && !isClosed,
      canEscalate: canModify && !isClosed,
      canDispose: canModify && !isClosed,
      canReopen: canModify && isClosed,
    },
    allowedStatusTargets: canModify ? manualStatusTargets(c.status) : [],
    availableWorkflowActions: actions,
    actionHistory: c.actionHistory.map((action) => ({
      ...action,
      metadata: parseJson(action.metadata),
    })),
    alerts: c.alerts.map((link) => ({
      ...link,
      alert: {
        ...link.alert,
        evidence: parseJson(link.alert.evidence),
      },
    })),
    identityResolution: c.identityResolution
      ? {
          ...c.identityResolution,
          candidateEvidence: parseJson(c.identityResolution.candidateEvidence),
        }
      : null,
  };
}

async function findCaseForUser(user: AuthUser, id: string): Promise<CasePayload> {
  const c = await prisma.case.findUnique({ where: { id }, include: caseInclude });
  if (!c) throw NotFound('Case not found');
  if (!canAccessCase(user, c)) {
    // Coordination access: a case is visible to a Bureau/Regional officer when
    // it is linked through an alert to a case inside their own scope.
    const and: Prisma.OverlapAlertWhereInput[] = [];
    if (user.role === 'BUREAU_OFFICER') {
      if (!user.bureauId) throw Forbidden('Your Bureau/Cell scope is not configured');
      and.push({ cases: { some: { case: { currentBureauId: user.bureauId } } } });
    } else if (user.role === 'REGIONAL_OFFICER') {
      if (!user.regionId) throw Forbidden('Your Region scope is not configured');
      and.push({ institution: { regionId: user.regionId } });
    }
    const linked = and.length
      ? await prisma.overlapAlert.findFirst({
          where: { AND: [{ cases: { some: { caseId: id } } }, ...and] },
          select: { id: true },
        })
      : null;
    if (!linked) throw Forbidden('You do not have access to this case');
  }
  return c;
}

export async function getCaseDetail(user: AuthUser, id: string) {
  const [c, rules] = await Promise.all([findCaseForUser(user, id), activeSlaRules()]);
  return decorateCase(c, user, rules);
}

/** Raw case access used by internal services. */
export async function getCaseOrThrow(user: AuthUser, id: string) {
  return findCaseForUser(user, id);
}

async function generateCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 8; attempt++) {
    const count = await prisma.case.count();
    const candidate = `AICTE-${year}-${String(count + 1 + attempt).padStart(5, '0')}`;
    const exists = await prisma.case.findUnique({ where: { caseNumber: candidate } });
    if (!exists) return candidate;
  }
  return `AICTE-${year}-${Date.now().toString().slice(-8)}`;
}

async function resolveSlaDate(input: {
  categoryId: string;
  currentBureauId: string | null;
  priority: string;
  dateReceived: Date;
}): Promise<Date | null> {
  const rules = await activeSlaRules();
  const rule = ruleForCase(
    {
      categoryId: input.categoryId,
      currentBureauId: input.currentBureauId,
      priority: input.priority,
      status: 'RECEIVED',
    },
    rules,
  );
  return computeSlaDueDate(input.dateReceived, rule);
}

async function assertActiveBureau(id: string | null | undefined) {
  if (!id) return null;
  const bureau = await prisma.bureau.findUnique({ where: { id } });
  if (!bureau || !bureau.isActive) throw BadRequest('Invalid or inactive Bureau/Cell');
  return bureau;
}

async function validatedOfficer(
  officerId: string,
  bureauId: string | null,
  options: { allowNullBureau?: boolean } = {},
) {
  const officer = await prisma.user.findUnique({ where: { id: officerId } });
  if (!officer || !officer.isActive) throw BadRequest('Invalid or inactive officer');
  if (!['ADMIN', 'BUREAU_OFFICER'].includes(officer.role)) {
    throw BadRequest('The selected user cannot be assigned complaints');
  }
  if (bureauId && officer.role === 'BUREAU_OFFICER' && officer.bureauId !== bureauId) {
    throw BadRequest('Assigned officer does not belong to the selected Bureau/Cell');
  }
  if (!bureauId && !options.allowNullBureau && officer.role === 'BUREAU_OFFICER') {
    throw BadRequest('Select a Bureau/Cell before assigning a Bureau officer');
  }
  return officer;
}

export interface CreateCaseInput {
  institutionId?: string | null;
  institutionAictePermanentId?: string | null;
  originalInstitutionName?: string | null;
  title: string;
  description: string;
  categoryId: string;
  priority?: string;
  currentBureauId?: string | null;
  assignedOfficerId?: string | null;
  dateReceived?: Date;
  nextRequiredAction?: string | null;
  nextActionDueDate?: Date | null;
  expectedDisposalDate?: Date | null;
  identityReviewNote?: string | null;
}

export async function createCase(user: AuthUser, input: CreateCaseInput) {
  if (isReadOnly(user)) throw Forbidden('Your role cannot create complaints');

  let institution = null;
  if (input.institutionId) {
    institution = await prisma.institution.findUnique({
      where: { id: input.institutionId },
      include: { region: true },
    });
    if (!institution) throw NotFound('Institution not found');
    if (!institution.isActive) throw BadRequest('The selected institution is inactive');
    if (user.role === 'REGIONAL_OFFICER' && institution.regionId !== user.regionId) {
      throw Forbidden('You can only create complaints for institutions in your assigned region');
    }
  } else if (input.institutionAictePermanentId?.trim()) {
    institution = await prisma.institution.findUnique({
      where: { aictePermanentId: input.institutionAictePermanentId.trim() },
      include: { region: true },
    });
    if (institution && !institution.isActive) throw BadRequest('The matching institution is inactive');
    if (
      institution &&
      user.role === 'REGIONAL_OFFICER' &&
      institution.regionId !== user.regionId
    ) {
      throw Forbidden('You can only create complaints for institutions in your assigned region');
    }
  }

  const submittedName = (input.originalInstitutionName ?? '').trim();
  if (!institution && !submittedName) {
    throw BadRequest(
      'Provide a verified institution, an exact AICTE Permanent ID, or the institution name supplied during intake',
    );
  }

  const category = await prisma.complaintCategory.findUnique({ where: { id: input.categoryId } });
  if (!category || !category.isActive) throw BadRequest('Invalid or inactive complaint category');

  let bureauId = input.currentBureauId ?? null;
  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) throw Forbidden('Your Bureau/Cell scope is not configured');
    bureauId = user.bureauId;
  }
  if (bureauId) await assertActiveBureau(bureauId);

  const priority = input.priority ?? 'MEDIUM';
  if (input.assignedOfficerId) {
    await validatedOfficer(input.assignedOfficerId, bureauId);
  }

  const dateReceived = input.dateReceived ?? new Date();
  const slaDueDate = await resolveSlaDate({
    categoryId: category.id,
    currentBureauId: bureauId,
    priority,
    dateReceived,
  });
  const caseNumber = await generateCaseNumber();

  // Identity candidates are explainable suggestions only. A name or alias never
  // auto-links a case; an authorized officer must resolve the queue entry.
  const candidates =
    !institution && submittedName
      ? await findInstitutionCandidates({
          name: submittedName,
          aictePermanentId: input.institutionAictePermanentId ?? undefined,
        })
      : [];

  const created = await prisma.$transaction(async (tx) => {
    const newCase = await tx.case.create({
      data: {
        caseNumber,
        institutionId: institution?.id ?? null,
        originalInstitutionName: submittedName || institution?.name || null,
        dateReceived,
        title: input.title,
        description: input.description,
        categoryId: category.id,
        priority,
        status: 'RECEIVED',
        currentBureauId: bureauId,
        assignedOfficerId: input.assignedOfficerId ?? null,
        createdById: user.id,
        lastAction: 'Complaint registered',
        lastActionDate: new Date(),
        nextRequiredAction: input.nextRequiredAction ?? 'Initial review',
        nextActionDueDate: input.nextActionDueDate ?? slaDueDate,
        expectedDisposalDate: input.expectedDisposalDate ?? slaDueDate,
        slaDueDate,
      },
    });

    if (!institution) {
      await tx.institutionResolution.create({
        data: {
          caseId: newCase.id,
          submittedName,
          submittedAictePermanentId: input.institutionAictePermanentId?.trim() || null,
          status: 'PENDING',
          candidateEvidence: JSON.stringify({
            policy:
              'Names and aliases never auto-link. An authorized officer must review the candidates and confirm the stable AICTE Permanent ID.',
            intakeNote: input.identityReviewNote ?? null,
            candidates: candidates.map((candidate) => ({
              institutionId: candidate.institution.id,
              name: candidate.institution.name,
              aictePermanentId: candidate.institution.aictePermanentId,
              regionId: candidate.institution.regionId ?? null,
              city: candidate.institution.city,
              state: candidate.institution.state,
              score: candidate.score,
              requiresReview: candidate.requiresReview,
              autoLink: candidate.autoLink,
              reasoning: candidate.reasoning,
              evidence: candidate.evidence,
            })),
          }),
        },
      });
    }

    await writeCaseAction(tx, {
      caseId: newCase.id,
      actionType: 'CREATED',
      performedById: user.id,
      bureauId,
      newValue: 'RECEIVED',
      remarks: 'Complaint registered in the integrated monitoring system',
      metadata: institution
        ? { institutionId: institution.id, identityVerified: true, identityReviewNote: input.identityReviewNote ?? null }
        : {
            originalInstitutionName: submittedName,
            identityVerified: false,
            identityResolution: 'PENDING',
            candidateCount: candidates.length,
          },
    });

    if (input.assignedOfficerId) {
      await writeCaseAction(tx, {
        caseId: newCase.id,
        actionType: 'ASSIGNED',
        performedById: user.id,
        bureauId,
        newValue: input.assignedOfficerId,
        remarks: 'Assigned at intake',
      });
    }
    return newCase;
  });

  await writeAudit(user, 'CASE_CREATED', 'Case', created.id, {
    caseNumber: created.caseNumber,
    institutionId: institution?.id ?? null,
    identityPending: !institution,
  });
  if (institution) await evaluateInstitutionOverlaps(institution.id, user.id);
  emitDataChanged('cases', 'created', created.id);

  if (created.assignedOfficerId) {
    await createNotification(prisma, {
      userId: created.assignedOfficerId,
      type: 'ASSIGNED',
      title: 'New case assigned',
      message: `${created.caseNumber}: ${created.title}`,
      link: `/cases/${created.id}`,
      caseId: created.id,
      dedupeKey: `assign:${created.id}:${created.assignedOfficerId}:initial`,
    });
  }
  return getCaseDetail(user, created.id);
}

export async function changeStatus(
  user: AuthUser,
  caseId: string,
  input: { status: string; remarks?: string | null },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot modify this case');
  try {
    assertManualTransition(c.status, input.status);
  } catch (err) {
    policyError(err);
  }

  const { updated, actionId } = await prisma.$transaction(async (tx) => {
    const result = await tx.case.update({
      where: { id: caseId },
      data: {
        status: input.status,
        lastAction: `Status changed to ${input.status.replace(/_/g, ' ')}`,
        lastActionDate: new Date(),
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: 'STATUS_CHANGED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: c.status,
      newValue: input.status,
      remarks: input.remarks ?? null,
    });
    return { updated: result, actionId: action.id };
  });

  await writeAudit(user, 'CASE_STATUS_CHANGED', 'Case', caseId, { from: c.status, to: input.status });
  if (c.institutionId) await evaluateInstitutionOverlaps(c.institutionId, user.id);
  emitDataChanged('cases', 'updated', caseId);
  await notifyUsersSafe(prisma, await caseRecipientIds(c), {
    type: 'STATUS_CHANGED',
    title: `Case status updated: ${updated.caseNumber}`,
    message: `${updated.title} is now ${input.status.replace(/_/g, ' ')}.`,
    link: `/cases/${caseId}`,
    caseId,
    dedupeKey: `status:${caseId}:${actionId}`,
  });
  return getCaseDetail(user, caseId);
}

export async function assignCase(
  user: AuthUser,
  caseId: string,
  input: { assignedOfficerId: string | null; remarks?: string | null },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot assign this case');
  if (input.assignedOfficerId) {
    await validatedOfficer(input.assignedOfficerId, c.currentBureauId);
  }
  const previous = c.assignedOfficerId;
  const { updated, actionId } = await prisma.$transaction(async (tx) => {
    const result = await tx.case.update({
      where: { id: caseId },
      data: {
        assignedOfficerId: input.assignedOfficerId,
        lastAction: input.assignedOfficerId ? 'Case reassigned' : 'Case unassigned',
        lastActionDate: new Date(),
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: previous ? 'REASSIGNED' : 'ASSIGNED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: previous,
      newValue: input.assignedOfficerId,
      remarks: input.remarks ?? null,
    });
    return { updated: result, actionId: action.id };
  });
  await writeAudit(user, 'CASE_ASSIGNED', 'Case', caseId, { from: previous, to: input.assignedOfficerId });
  emitDataChanged('cases', 'assigned', caseId);
  if (input.assignedOfficerId) {
    await createNotification(prisma, {
      userId: input.assignedOfficerId,
      type: 'REASSIGNED',
      title: 'Case assigned to you',
      message: `${c.caseNumber}: ${c.title}`,
      link: `/cases/${caseId}`,
      caseId,
      dedupeKey: `assign:${caseId}:${actionId}`,
    });
  }
  return getCaseDetail(user, caseId);
}

export async function addCaseAction(
  user: AuthUser,
  caseId: string,
  input: {
    remarks: string;
    nextRequiredAction?: string | null;
    nextActionDueDate?: Date | null;
    actionType?: string;
  },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot update this case');
  await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        lastAction: input.remarks.slice(0, 200),
        lastActionDate: new Date(),
        ...(input.nextRequiredAction !== undefined ? { nextRequiredAction: input.nextRequiredAction } : {}),
        ...(input.nextActionDueDate !== undefined ? { nextActionDueDate: input.nextActionDueDate } : {}),
      },
    });
    await writeCaseAction(tx, {
      caseId,
      actionType: input.actionType || 'REMARK',
      performedById: user.id,
      bureauId: c.currentBureauId,
      remarks: input.remarks,
      metadata: {
        nextRequiredAction: input.nextRequiredAction ?? null,
        nextActionDueDate: input.nextActionDueDate?.toISOString() ?? null,
      },
    });
  });
  await writeAudit(user, 'CASE_ACTION_ADDED', 'Case', caseId);
  emitDataChanged('cases', 'action_added', caseId);
  return getCaseDetail(user, caseId);
}

export async function transferCase(
  user: AuthUser,
  caseId: string,
  input: { toBureauId: string; toOfficerId?: string | null; reason: string },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot transfer this case');
  try {
    assertWorkflowTransition(c.status, 'TRANSFERRED', 'be transferred');
  } catch (err) {
    policyError(err);
  }
  if (input.toBureauId === c.currentBureauId) {
    throw BadRequest('Destination Bureau/Cell must differ from the current Bureau/Cell');
  }
  const destination = await assertActiveBureau(input.toBureauId);
  if (!destination) throw BadRequest('Destination Bureau/Cell is required');
  if (input.toOfficerId) {
    await validatedOfficer(input.toOfficerId, destination.id);
  }

  const { actionId } = await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        currentBureauId: destination.id,
        transferredFromBureauId: c.currentBureauId,
        assignedOfficerId: input.toOfficerId ?? null,
        status: 'TRANSFERRED',
        lastAction: `Transferred to ${destination.name}`,
        lastActionDate: new Date(),
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: 'TRANSFERRED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: c.currentBureauId,
      newValue: destination.id,
      remarks: input.reason,
      metadata: {
        fromBureauId: c.currentBureauId,
        toBureauId: destination.id,
        toBureauName: destination.name,
        toOfficerId: input.toOfficerId ?? null,
      },
    });
    return { actionId: action.id };
  });

  await writeAudit(user, 'CASE_TRANSFERRED', 'Case', caseId, {
    fromBureauId: c.currentBureauId,
    toBureauId: destination.id,
  });
  if (c.institutionId) await evaluateInstitutionOverlaps(c.institutionId, user.id);
  emitDataChanged('cases', 'transferred', caseId);
  const recipients = await caseRecipientIds({
    assignedOfficerId: input.toOfficerId ?? null,
    createdById: c.createdById,
    currentBureauId: destination.id,
  });
  await notifyUsersSafe(prisma, recipients, {
    type: 'TRANSFERRED',
    title: `Case transferred: ${c.caseNumber}`,
    message: `${c.title} was transferred to ${destination.name}. Reason: ${input.reason}`,
    link: `/cases/${caseId}`,
    caseId,
    dedupeKey: `transfer:${caseId}:${actionId}`,
  });
  return getCaseDetail(user, caseId);
}

export async function escalateCase(
  user: AuthUser,
  caseId: string,
  input: { reason: string; escalateTo?: string | null },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot escalate this case');
  try {
    assertWorkflowTransition(c.status, 'ESCALATED', 'be escalated');
  } catch (err) {
    policyError(err);
  }
  const { updated, actionId } = await prisma.$transaction(async (tx) => {
    const result = await tx.case.update({
      where: { id: caseId },
      data: {
        status: 'ESCALATED',
        escalatedAt: new Date(),
        lastAction: `Escalated${input.escalateTo ? ` to ${input.escalateTo}` : ''}`,
        lastActionDate: new Date(),
        priority: c.priority === 'LOW' || c.priority === 'MEDIUM' ? 'HIGH' : c.priority,
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: 'ESCALATED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: c.status,
      newValue: 'ESCALATED',
      remarks: input.reason,
      metadata: { escalateTo: input.escalateTo ?? null },
    });
    return { updated: result, actionId: action.id };
  });
  await writeAudit(user, 'CASE_ESCALATED', 'Case', caseId, { reason: input.reason });
  const management = await getManagementUserIds();
  const recipients = [...(await caseRecipientIds(c)), ...management];
  await notifyUsersSafe(prisma, recipients, {
    type: 'ESCALATION_REQUIRED',
    title: `Case escalated: ${c.caseNumber}`,
    message: input.reason,
    link: `/cases/${caseId}`,
    caseId,
    dedupeKey: `escalation:${caseId}:${actionId}`,
  });
  emitDataChanged('cases', 'escalated', caseId);
  return getCaseDetail(user, caseId);
}

export async function disposeCase(
  user: AuthUser,
  caseId: string,
  input: { resolutionRemarks: string },
) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot dispose this case');
  if (input.resolutionRemarks.trim().length < 10) {
    throw BadRequest('Resolution remarks must be meaningful (at least 10 characters)');
  }
  try {
    assertWorkflowTransition(c.status, 'DISPOSED', 'be disposed');
  } catch (err) {
    policyError(err);
  }

  const { actionId } = await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        status: 'DISPOSED',
        disposedAt: new Date(),
        resolutionRemarks: input.resolutionRemarks,
        nextRequiredAction: null,
        nextActionDueDate: null,
        lastAction: 'Case disposed',
        lastActionDate: new Date(),
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: 'DISPOSED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: c.status,
      newValue: 'DISPOSED',
      remarks: input.resolutionRemarks,
    });
    return { actionId: action.id };
  });
  await writeAudit(user, 'CASE_DISPOSED', 'Case', caseId);
  if (c.institutionId) await evaluateInstitutionOverlaps(c.institutionId, user.id);
  emitDataChanged('cases', 'disposed', caseId);
  await notifyUsersSafe(prisma, await caseRecipientIds(c), {
    type: 'CASE_DISPOSED',
    title: `Case disposed: ${c.caseNumber}`,
    message: `Resolved: ${input.resolutionRemarks.slice(0, 120)}`,
    link: `/cases/${caseId}`,
    caseId,
    dedupeKey: `dispose:${caseId}:${actionId}`,
  });
  return getCaseDetail(user, caseId);
}

export async function reopenCase(user: AuthUser, caseId: string, input: { reason: string }) {
  const c = await findCaseForUser(user, caseId);
  if (!canModifyCase(user, c)) throw Forbidden('You cannot reopen this case');
  if (input.reason.trim().length < 10) throw BadRequest('A meaningful reopen reason is required');
  try {
    assertWorkflowTransition(c.status, 'REOPENED', 'be reopened');
  } catch (err) {
    policyError(err);
  }

  const now = new Date();
  const slaDueDate = await resolveSlaDate({
    categoryId: c.categoryId,
    currentBureauId: c.currentBureauId,
    priority: c.priority,
    dateReceived: now,
  });

  const { actionId } = await prisma.$transaction(async (tx) => {
    await tx.case.update({
      where: { id: caseId },
      data: {
        status: 'REOPENED',
        reopenedAt: now,
        reopenReason: input.reason,
        disposedAt: null,
        resolutionRemarks: null,
        slaDueDate,
        nextRequiredAction: 'Review reopened complaint',
        nextActionDueDate: slaDueDate,
        lastAction: 'Case reopened',
        lastActionDate: now,
      },
    });
    const action = await writeCaseAction(tx, {
      caseId,
      actionType: 'REOPENED',
      performedById: user.id,
      bureauId: c.currentBureauId,
      previousValue: 'DISPOSED',
      newValue: 'REOPENED',
      remarks: input.reason,
      metadata: {
        previousResolutionRemarks: c.resolutionRemarks,
        previousDisposedAt: c.disposedAt?.toISOString() ?? null,
        newSlaDueDate: slaDueDate?.toISOString() ?? null,
      },
    });
    return { actionId: action.id };
  });
  await writeAudit(user, 'CASE_REOPENED', 'Case', caseId, { reason: input.reason });
  if (c.institutionId) await evaluateInstitutionOverlaps(c.institutionId, user.id);
  emitDataChanged('cases', 'reopened', caseId);
  const management = await getManagementUserIds();
  await notifyUsersSafe(prisma, [...(await caseRecipientIds(c)), ...management], {
    type: 'CASE_REOPENED',
    title: `Case reopened: ${c.caseNumber}`,
    message: input.reason,
    link: `/cases/${caseId}`,
    caseId,
    dedupeKey: `reopen:${caseId}:${actionId}`,
  });
  return getCaseDetail(user, caseId);
}

export interface CaseListFilters {
  q?: string;
  status?: string[];
  priority?: string[];
  bureauId?: string;
  regionId?: string;
  categoryId?: string;
  assignedOfficerId?: string;
  institutionId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  dueFrom?: Date;
  dueTo?: Date;
  overdue?: boolean;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

export async function listCases(user: AuthUser, filters: CaseListFilters) {
  const now = new Date();
  const where: Prisma.CaseWhereInput = {
    AND: [
      caseScopeWhere(user),
      filters.q
        ? {
            OR: [
              { caseNumber: { contains: filters.q } },
              { title: { contains: filters.q } },
              { description: { contains: filters.q } },
              { institution: { name: { contains: filters.q } } },
              { institution: { aictePermanentId: { contains: filters.q } } },
              { originalInstitutionName: { contains: filters.q } },
            ],
          }
        : {},
      filters.status?.length ? { status: { in: filters.status } } : {},
      filters.priority?.length ? { priority: { in: filters.priority } } : {},
      filters.bureauId ? { currentBureauId: filters.bureauId } : {},
      filters.regionId ? { institution: { regionId: filters.regionId } } : {},
      filters.categoryId ? { categoryId: filters.categoryId } : {},
      filters.assignedOfficerId ? { assignedOfficerId: filters.assignedOfficerId } : {},
      filters.institutionId ? { institutionId: filters.institutionId } : {},
      filters.dateFrom || filters.dateTo
        ? {
            dateReceived: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {},
      filters.dueFrom || filters.dueTo
        ? {
            OR: [
              {
                slaDueDate: {
                  ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
                  ...(filters.dueTo ? { lte: filters.dueTo } : {}),
                },
              },
              {
                slaDueDate: null,
                nextActionDueDate: {
                  ...(filters.dueFrom ? { gte: filters.dueFrom } : {}),
                  ...(filters.dueTo ? { lte: filters.dueTo } : {}),
                },
              },
            ],
          }
        : {},
      filters.overdue ? overdueCaseWhere(now) : {},
    ],
  };

  const orderBy: Prisma.CaseOrderByWithRelationInput =
    filters.sortBy === 'priority'
      ? { priority: filters.sortOrder }
      : filters.sortBy === 'nextActionDueDate' || filters.sortBy === 'slaDueDate'
        ? { slaDueDate: filters.sortOrder }
        : filters.sortBy === 'dateReceived'
          ? { dateReceived: filters.sortOrder }
          : filters.sortBy === 'caseNumber'
            ? { caseNumber: filters.sortOrder }
            : { createdAt: filters.sortOrder };

  const [total, items, rules] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({
      where,
      include: caseInclude,
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    activeSlaRules(),
  ]);

  return {
    items: items.map((c) => decorateCase(c, user, rules, now)),
    total,
  };
}

export async function caseStatsForUser(user: AuthUser) {
  const now = new Date();
  const where = caseScopeWhere(user);
  const [total, disposed, openCases, rules] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.count({ where: { AND: [where, { status: 'DISPOSED' }] } }),
    prisma.case.findMany({
      where: { AND: [where, { status: { in: [...OPEN_CASE_STATUSES] } }] },
      select: {
        status: true,
        slaDueDate: true,
        nextActionDueDate: true,
        categoryId: true,
        currentBureauId: true,
        priority: true,
      },
    }),
    activeSlaRules(),
  ]);
  const snapshots = openCases.map((c) => ({ c, sla: decorateWithSla(c, rules, now).sla }));
  const overdue = snapshots.filter((row) => row.sla.isOverdue).length;
  const approaching = snapshots.filter((row) => row.sla.isApproaching).length;
  const active = openCases.filter((c) => (ACTIVE_CASE_STATUSES as readonly string[]).includes(c.status)).length;
  return { total, pending: total - disposed, active, disposed, overdue, approaching };
}

export async function listAssignableOfficers(
  user: AuthUser,
  filters: { bureauId?: string | null; regionId?: string | null } = {},
) {
  const where: Prisma.UserWhereInput = {
    isActive: true,
    role: { in: ['BUREAU_OFFICER', 'ADMIN'] },
  };
  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) throw Forbidden('Your Bureau/Cell scope is not configured');
    where.bureauId = user.bureauId;
  } else if (filters.bureauId) {
    where.bureauId = filters.bureauId;
  }
  if (user.role === 'REGIONAL_OFFICER' && !user.regionId) {
    throw Forbidden('Your Region scope is not configured');
  }
  const officers = await prisma.user.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      bureauId: true,
      bureau: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  return officers;
}
