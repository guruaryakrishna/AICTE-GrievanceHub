import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { createCase } from '../src/services/caseService';
import { reviewAlert } from '../src/services/alertService';
import {
  evaluateAllOverlaps,
  evaluateInstitutionOverlaps,
} from '../src/services/matching/overlapDetection';
import {
  CROSS_BUREAU_ALERT_TYPE,
  DUPLICATE_ALERT_TYPE,
  crossBureauAlertKey,
  duplicateAlertKey,
} from '../src/services/matching/overlapKeys';
import { createFixture, Fixture } from './helpers';

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    institutionId: fx.institutionA.id,
    title: 'Delay in scholarship disbursement',
    description:
      'The institution has not disbursed the approved scholarship amount to eligible students despite repeated representations.',
    categoryId: fx.category.id,
    currentBureauId: fx.bureauA.id,
    ...overrides,
  } as Parameters<typeof createCase>[1];
}

async function twoBureauCases() {
  const a = await createCase(fx.admin, baseInput({ currentBureauId: fx.bureauA.id }));
  const b = await createCase(
    fx.admin,
    baseInput({
      currentBureauId: fx.bureauB.id,
      title: 'Laboratory safety equipment unavailable',
      description:
        'The chemical engineering laboratory has been operating without the mandated safety equipment and inspection records.',
    }),
  );
  return { a, b };
}

describe('cross-Bureau overlap alerts', () => {
  it('creates one alert per institution with a stable key and does not duplicate on re-evaluation', async () => {
    await twoBureauCases();

    const alerts = await prisma.overlapAlert.findMany({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].caseKey).toBe(crossBureauAlertKey(fx.institutionA.id));
    expect(await prisma.caseAlert.count({ where: { alertId: alerts[0].id } })).toBe(2);

    await evaluateInstitutionOverlaps(fx.institutionA.id, fx.admin.id);
    await evaluateInstitutionOverlaps(fx.institutionA.id, fx.admin.id);

    const after = await prisma.overlapAlert.findMany({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(alerts[0].id);
    expect(after[0].caseKey).toBe(crossBureauAlertKey(fx.institutionA.id));

    const notifications = await prisma.notification.findMany({
      where: { alertId: alerts[0].id, dedupeKey: `overlap-detected:${alerts[0].id}` },
    });
    // One notification per recipient (two bureau officers plus two managers),
    // never one per evaluation run.
    expect(notifications).toHaveLength(4);
    expect(new Set(notifications.map((n) => n.userId))).toEqual(
      new Set([fx.officerA.id, fx.officerB.id, fx.admin.id, fx.senior.id]),
    );
  });

  it('consolidates duplicate active institution alerts without deleting history', async () => {
    const { a } = await twoBureauCases();
    const canonical = await prisma.overlapAlert.findFirstOrThrow({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });

    const legacy = await prisma.overlapAlert.create({
      data: {
        alertType: CROSS_BUREAU_ALERT_TYPE,
        status: 'UNDER_REVIEW',
        institutionId: fx.institutionA.id,
        caseKey: 'legacy-alert-key',
        detectionReason: 'Legacy duplicate alert from an earlier evaluator version.',
        cases: { create: [{ caseId: a.id }] },
      },
    });

    await evaluateInstitutionOverlaps(fx.institutionA.id, fx.admin.id);

    const merged = await prisma.overlapAlert.findUnique({ where: { id: legacy.id } });
    expect(merged?.status).toBe('DISMISSED');
    expect(merged?.dismissalReason).toContain('Consolidated');
    expect(
      await prisma.caseAlert.count({ where: { alertId: canonical.id } }),
    ).toBe(2);
    expect(await prisma.overlapAlert.count({ where: { id: canonical.id } })).toBe(1);
  });

  it('dismisses active alerts with no supporting cases during global reconciliation', async () => {
    await prisma.overlapAlert.create({
      data: {
        alertType: CROSS_BUREAU_ALERT_TYPE,
        status: 'NEW',
        institutionId: fx.institutionA.id,
        caseKey: 'orphan-alert-key',
        detectionReason: 'An alert that lost its case links.',
      },
    });

    const result = await evaluateAllOverlaps(fx.admin.id);
    expect(result.dismissedOrphans).toBeGreaterThanOrEqual(1);

    const orphan = await prisma.overlapAlert.findUniqueOrThrow({ where: { caseKey: 'orphan-alert-key' } });
    expect(orphan.status).toBe('DISMISSED');
    expect(orphan.dismissalReason).toMatch(/historical audit/i);
  });

  it('requires an outcome to resolve an alert and records the review', async () => {
    await twoBureauCases();
    const alert = await prisma.overlapAlert.findFirstOrThrow({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });

    await expect(
      reviewAlert(fx.admin, alert.id, { status: 'RESOLVED' }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const resolved = await reviewAlert(fx.admin, alert.id, {
      status: 'RESOLVED',
      outcome: 'The two Bureaus agreed a joint inspection plan and single point of contact.',
      remarks: 'Coordination completed.',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).toBeInstanceOf(Date);

    const reviews = await prisma.alertReview.findMany({ where: { alertId: alert.id } });
    expect(reviews.some((review) => review.action === 'RESOLVED')).toBe(true);

    const actions = await prisma.caseActionHistory.findMany({
      where: { alertId: alert.id, actionType: 'ALERT_RESOLVED' },
    });
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  it('forbids read-only reviewers', async () => {
    await twoBureauCases();
    const alert = await prisma.overlapAlert.findFirstOrThrow({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });
    await expect(
      reviewAlert(fx.readOnly, alert.id, { status: 'RESOLVED', outcome: 'Done' }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('reopens a terminal alert when the overlap recurs', async () => {
    await twoBureauCases();
    const alert = await prisma.overlapAlert.findFirstOrThrow({
      where: { alertType: CROSS_BUREAU_ALERT_TYPE, institutionId: fx.institutionA.id },
    });
    await reviewAlert(fx.admin, alert.id, {
      status: 'RESOLVED',
      outcome: 'Coordination completed for the initial pair of cases.',
    });

    await evaluateInstitutionOverlaps(fx.institutionA.id, fx.admin.id);

    const reopened = await prisma.overlapAlert.findUniqueOrThrow({ where: { id: alert.id } });
    expect(reopened.status).toBe('NEW');
    expect(reopened.resolvedAt).toBeNull();
  });
});

describe('potential duplicate alerts', () => {
  it('uses an order-independent stable key and does not duplicate on re-evaluation', async () => {
    const a = await createCase(fx.admin, baseInput({ currentBureauId: fx.bureauA.id }));
    const b = await createCase(
      fx.admin,
      baseInput({
        currentBureauId: fx.bureauA.id,
        title: 'Delay in scholarship disbursement ',
        description:
          'The institution has not disbursed the approved scholarship amount to eligible students despite repeated representations. ',
      }),
    );

    const expectedKey = duplicateAlertKey(a.id, b.id);
    expect(expectedKey).toBe(duplicateAlertKey(b.id, a.id));

    const alert = await prisma.overlapAlert.findFirst({
      where: { alertType: DUPLICATE_ALERT_TYPE, caseKey: expectedKey },
    });
    expect(alert).not.toBeNull();
    expect(alert?.caseKey).toBe(expectedKey);

    await evaluateInstitutionOverlaps(fx.institutionA.id, fx.admin.id);

    const count = await prisma.overlapAlert.count({
      where: { alertType: DUPLICATE_ALERT_TYPE, institutionId: fx.institutionA.id },
    });
    expect(count).toBe(1);

    const links = await prisma.caseAlert.findMany({ where: { alertId: alert!.id } });
    expect(new Set(links.map((link) => link.caseId))).toEqual(new Set([a.id, b.id]));
  });

  it('does not create a duplicate alert for genuinely different complaints', async () => {
    await createCase(
      fx.admin,
      baseInput({
        currentBureauId: fx.bureauA.id,
        title: 'Scholarship disbursement delay',
        description:
          'Approved scholarship amounts have not reached eligible students despite repeated written representations to the institution.',
      }),
    );
    await createCase(
      fx.admin,
      baseInput({
        currentBureauId: fx.bureauA.id,
        title: 'Laboratory safety equipment unavailable',
        description:
          'The chemical engineering laboratory lacks mandated safety equipment and has no current inspection records on file.',
      }),
    );
    const count = await prisma.overlapAlert.count({ where: { alertType: DUPLICATE_ALERT_TYPE } });
    expect(count).toBe(0);
  });
});
