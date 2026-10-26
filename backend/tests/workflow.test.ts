import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  addCaseAction,
  assignCase,
  changeStatus,
  createCase,
  disposeCase,
  escalateCase,
  getCaseDetail,
  listCases,
  reopenCase,
  transferCase,
} from '../src/services/caseService';
import {
  listIdentityResolutions,
  resolveInstitutionIdentity,
} from '../src/services/institutionService';
import { createFixture, Fixture, BASE_CASE } from './helpers';

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    ...BASE_CASE,
    categoryId: fx.category.id,
    currentBureauId: fx.bureauA.id,
    ...overrides,
  } as Parameters<typeof createCase>[1];
}

async function createVerifiedCase(overrides: Record<string, unknown> = {}) {
  return createCase(fx.admin, createInput({ institutionId: fx.institutionA.id, ...overrides }));
}

describe('case intake', () => {
  it('creates a verified case with a computed SLA deadline and audit trail', async () => {
    const dateReceived = new Date('2026-03-01T00:00:00.000Z');
    const created = await createVerifiedCase({ dateReceived, priority: 'HIGH' });

    expect(created.institutionId).toBe(fx.institutionA.id);
    expect(created.status).toBe('RECEIVED');
    expect(created.slaDueDate?.toISOString()).toBe('2026-03-08T00:00:00.000Z');
    expect(created.identityResolution).toBeNull();
    expect(created.actionHistory[0].actionType).toBe('CREATED');

    const audits = await prisma.auditEvent.findMany({ where: { entityId: created.id } });
    expect(audits.some((event) => event.action === 'CASE_CREATED')).toBe(true);
  });

  it('links a case automatically only from an exact stable AICTE Permanent ID', async () => {
    const created = await createCase(
      fx.admin,
      createInput({ institutionAictePermanentId: fx.institutionA.aictePermanentId }),
    );
    expect(created.institutionId).toBe(fx.institutionA.id);
    expect(created.identityResolution).toBeNull();
  });

  it('never auto-links a submitted name and creates a reviewable identity request', async () => {
    const created = await createCase(
      fx.admin,
      createInput({ originalInstitutionName: 'Northern Institute of Technology' }),
    );

    expect(created.institutionId).toBeNull();
    expect(created.identityResolution?.status).toBe('PENDING');
    expect(created.identityResolution?.submittedName).toBe('Northern Institute of Technology');

    const evidence = created.identityResolution?.candidateEvidence as {
      candidates: { institutionId: string }[];
      policy: string;
    };
    expect(evidence.policy).toMatch(/never auto-link/i);
    expect(evidence.candidates.some((candidate) => candidate.institutionId === fx.institutionA.id)).toBe(true);
  });

  it('requires a verified institution, exact ID or submitted name', async () => {
    await expect(
      createCase(fx.admin, createInput({ institutionId: null, originalInstitutionName: null })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('prevents read-only users from creating complaints', async () => {
    await expect(
      createCase(fx.readOnly, createInput({ institutionId: fx.institutionA.id })),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('forces a Bureau officer’s case into their own Bureau', async () => {
    const created = await createCase(
      fx.bureauOfficerA,
      createInput({ institutionId: fx.institutionA.id, currentBureauId: fx.bureauB.id }),
    );
    expect(created.currentBureauId).toBe(fx.bureauA.id);
  });

  it('rejects assigning an officer from another Bureau', async () => {
    await expect(
      createCase(
        fx.admin,
        createInput({
          institutionId: fx.institutionA.id,
          assignedOfficerId: fx.officerB.id,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('identity resolution workflow', () => {
  it('links the case only after an authorised reviewer resolves the queue entry', async () => {
    const created = await createCase(
      fx.admin,
      createInput({ originalInstitutionName: 'North Tech Institute' }),
    );
    const resolutionId = created.identityResolution!.id;

    const queue = await listIdentityResolutions(fx.admin, { status: ['PENDING'], page: 1, pageSize: 20 });
    expect(queue.items.some((item) => item.id === resolutionId)).toBe(true);

    const resolved = await resolveInstitutionIdentity(fx.admin, resolutionId, {
      institutionId: fx.institutionA.id,
      note: 'Verified against the AICTE Permanent ID register.',
    });
    expect(resolved.status).toBe('RESOLVED');

    const linkedCase = await prisma.case.findUnique({ where: { id: created.id } });
    expect(linkedCase?.institutionId).toBe(fx.institutionA.id);

    const alias = await prisma.institutionAlias.findFirst({
      where: { institutionId: fx.institutionA.id, alias: 'North Tech Institute' },
    });
    expect(alias).not.toBeNull();

    const action = await prisma.caseActionHistory.findFirst({
      where: { caseId: created.id, actionType: 'IDENTITY_RESOLVED' },
    });
    expect(action).not.toBeNull();

    await expect(
      resolveInstitutionIdentity(fx.admin, resolutionId, { institutionId: fx.institutionA.id }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('requires a note to dismiss an identity request', async () => {
    const created = await createCase(
      fx.admin,
      createInput({ originalInstitutionName: 'Unknown Polytechnic' }),
    );
    await expect(
      resolveInstitutionIdentity(fx.admin, created.identityResolution!.id, { dismiss: true }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const dismissed = await resolveInstitutionIdentity(fx.admin, created.identityResolution!.id, {
      dismiss: true,
      note: 'Intake name could not be matched to any institution.',
    });
    expect(dismissed.status).toBe('DISMISSED');
  });

  it('forbids Bureau officers from resolving identities', async () => {
    const created = await createCase(
      fx.admin,
      createInput({ originalInstitutionName: 'Unknown Polytechnic' }),
    );
    await expect(
      resolveInstitutionIdentity(fx.bureauOfficerA, created.identityResolution!.id, {
        institutionId: fx.institutionA.id,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('case lifecycle workflows', () => {
  it('allows ordinary review progression but rejects special operations', async () => {
    const created = await createVerifiedCase();
    const reviewed = await changeStatus(fx.admin, created.id, { status: 'UNDER_REVIEW' });
    expect(reviewed.status).toBe('UNDER_REVIEW');

    await expect(
      changeStatus(fx.admin, created.id, { status: 'DISPOSED' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      changeStatus(fx.admin, created.id, { status: 'TRANSFERRED' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('requires a destination and reason to transfer, then records the move', async () => {
    const created = await createVerifiedCase();

    await expect(
      transferCase(fx.admin, created.id, { toBureauId: fx.bureauA.id, reason: 'Not a real transfer' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const transferred = await transferCase(fx.admin, created.id, {
      toBureauId: fx.bureauB.id,
      reason: 'The complaint concerns a matter owned by the grievance cell.',
    });
    expect(transferred.status).toBe('TRANSFERRED');
    expect(transferred.currentBureauId).toBe(fx.bureauB.id);
    expect(transferred.transferredFromBureauId).toBe(fx.bureauA.id);

    const action = await prisma.caseActionHistory.findFirst({
      where: { caseId: created.id, actionType: 'TRANSFERRED' },
    });
    expect(action?.newValue).toBe(fx.bureauB.id);
  });

  it('escalates with a reason and raises low/medium priority', async () => {
    const created = await createVerifiedCase({ priority: 'MEDIUM' });
    const escalated = await escalateCase(fx.admin, created.id, {
      reason: 'No response from the institution after repeated follow-up.',
    });
    expect(escalated.status).toBe('ESCALATED');
    expect(escalated.priority).toBe('HIGH');
    expect(escalated.escalatedAt).toBeInstanceOf(Date);
  });

  it('requires meaningful disposal remarks, closes the case and reopen restores an SLA deadline', async () => {
    const created = await createVerifiedCase();

    await expect(
      disposeCase(fx.admin, created.id, { resolutionRemarks: 'Done' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const disposed = await disposeCase(fx.admin, created.id, {
      resolutionRemarks: 'Fees were refunded and the institution confirmed compliance.',
    });
    expect(disposed.status).toBe('DISPOSED');
    expect(disposed.disposedAt).toBeInstanceOf(Date);
    expect(disposed.sla.state).toBe('NONE');
    expect(disposed.sla.isOverdue).toBe(false);

    await expect(
      reopenCase(fx.admin, created.id, { reason: 'Short' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const reopened = await reopenCase(fx.admin, created.id, {
      reason: 'The complainant supplied new evidence that was not considered.',
    });
    expect(reopened.status).toBe('REOPENED');
    expect(reopened.disposedAt).toBeNull();
    expect(reopened.reopenedAt).toBeInstanceOf(Date);
    expect(reopened.slaDueDate).toBeInstanceOf(Date);
  });

  it('audits assignments and actions with captured history', async () => {
    const created = await createVerifiedCase();
    const assigned = await assignCase(fx.admin, created.id, { assignedOfficerId: fx.officerA.id });
    expect(assigned.assignedOfficerId).toBe(fx.officerA.id);

    const actioned = await addCaseAction(fx.admin, created.id, {
      remarks: 'Institution asked to submit scholarship disbursement evidence.',
      nextRequiredAction: 'Verify evidence',
    });
    expect(actioned.lastAction).toContain('scholarship');

    const types = actioned.actionHistory.map((entry) => entry.actionType);
    expect(types).toContain('CREATED');
    expect(types).toContain('ASSIGNED');
    expect(types).toContain('REMARK');

    const notification = await prisma.notification.findFirst({
      where: { userId: fx.officerA.id, caseId: created.id, type: 'REASSIGNED' },
    });
    expect(notification).not.toBeNull();
  });
});

describe('case authorization', () => {
  it('hides cases from officers outside their Bureau', async () => {
    const created = await createVerifiedCase({ currentBureauId: fx.bureauB.id });
    await expect(getCaseDetail(fx.bureauOfficerA, created.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(changeStatus(fx.bureauOfficerA, created.id, { status: 'UNDER_REVIEW' })).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('scopes list results to the viewer', async () => {
    await createVerifiedCase({ currentBureauId: fx.bureauA.id });
    const other = await createVerifiedCase({
      institutionId: fx.institutionB.id,
      currentBureauId: fx.bureauB.id,
      title: 'Laboratory safety equipment unavailable',
      description:
        'The chemical engineering laboratory lacks mandated safety equipment and current inspection records.',
    });

    const officerList = await listCases(fx.bureauOfficerA, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(officerList.items.map((item) => item.id)).not.toContain(other.id);
    expect(officerList.items.length).toBe(1);

    const adminList = await listCases(fx.admin, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    expect(adminList.total).toBe(2);
  });
});
