import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { ACTIVE_CASE_STATUSES } from '../../types';
import { emitDataChanged } from '../../realtime';
import { getManagementUserIds, notifyUsersSafe } from '../notificationService';
import { writeAudit } from '../auditService';
import { activeSimilarityProvider, SIMILARITY_THRESHOLDS } from './complaintSimilarity';
import {
  ACTIVE_ALERT_STATUSES,
  CROSS_BUREAU_ALERT_TYPE,
  DUPLICATE_ALERT_TYPE,
  crossBureauAlertKey,
  duplicateAlertKey,
  isActiveAlertStatus,
} from './overlapKeys';

export const OVERLAP_EVALUATION_VERSION = 'rules-v2';

export interface EvaluationResult {
  created: number;
  updated: number;
  alerts: string[];
}

/**
 * Link cases to an alert without relying on `createMany({ skipDuplicates })`,
 * which SQLite does not support. The composite unique key still protects
 * against races; this pre-filter keeps the common path quiet.
 */
async function linkCasesToAlert(
  tx: Prisma.TransactionClient,
  alertId: string,
  caseIds: string[],
): Promise<number> {
  if (!caseIds.length) return 0;
  const existing = await tx.caseAlert.findMany({
    where: { alertId, caseId: { in: caseIds } },
    select: { caseId: true },
  });
  const existingIds = new Set(existing.map((row) => row.caseId));
  const missing = [...new Set(caseIds.filter((id) => !existingIds.has(id)))];
  if (!missing.length) return 0;
  await tx.caseAlert.createMany({ data: missing.map((caseId) => ({ caseId, alertId })) });
  return missing.length;
}

/**
 * Consolidate duplicate active alerts for one institution without deleting
 * historical rows. The canonical alert keeps every case link and review;
 * superseded alerts are explicitly dismissed with a preservation reason.
 */
export async function reconcileInstitutionAlerts(
  institutionId: string,
  actorId?: string,
): Promise<{ consolidated: number; dismissedOrphans: number }> {
  const alerts = await prisma.overlapAlert.findMany({
    where: { institutionId, alertType: CROSS_BUREAU_ALERT_TYPE },
    include: { cases: true },
    orderBy: { firstDetectedAt: 'asc' },
  });

  const active = alerts.filter((a) => isActiveAlertStatus(a.status));
  let consolidated = 0;
  let dismissedOrphans = 0;

  const canonical = [...active].sort(
    (a, b) => b.cases.length - a.cases.length || a.firstDetectedAt.getTime() - b.firstDetectedAt.getTime(),
  )[0];

  if (canonical) {
    for (const duplicate of active) {
      if (duplicate.id === canonical.id) continue;
      await prisma.$transaction(async (tx) => {
        if (duplicate.cases.length) {
          await linkCasesToAlert(
            tx,
            canonical.id,
            duplicate.cases.map((link) => link.caseId),
          );
        }
        // Preserve review decisions and notification/action references by
        // moving them to the canonical record rather than deleting them.
        await tx.alertReview.updateMany({ where: { alertId: duplicate.id }, data: { alertId: canonical.id } });
        await tx.notification.updateMany({ where: { alertId: duplicate.id }, data: { alertId: canonical.id } });
        await tx.caseActionHistory.updateMany({ where: { alertId: duplicate.id }, data: { alertId: canonical.id } });
        await tx.overlapAlert.update({
          where: { id: duplicate.id },
          data: {
            status: 'DISMISSED',
            resolvedAt: new Date(),
            dismissalReason: `Consolidated into canonical alert ${canonical.id}. Duplicate active record for the same institution-level overlap.`,
            reviewerRemarks: 'Reconciled automatically; historical record preserved.',
          },
        });
        if (actorId) {
          await tx.alertReview.create({
            data: {
              alertId: canonical.id,
              reviewedById: actorId,
              action: 'CONSOLIDATED',
              remarks: `Merged duplicate alert ${duplicate.id} (key: ${duplicate.caseKey ?? 'none'}).`,
            },
          });
        }
      });
      consolidated++;
    }

    const desiredKey = crossBureauAlertKey(institutionId);
    if (canonical.caseKey !== desiredKey) {
      const keyHolder = await prisma.overlapAlert.findUnique({ where: { caseKey: desiredKey } });
      if (keyHolder && keyHolder.id !== canonical.id) {
        // A terminal record may still hold the stable key. Archive its key
        // (preserving the row) so the active canonical alert can use it.
        await prisma.overlapAlert.update({
          where: { id: keyHolder.id },
          data: { caseKey: `${desiredKey}:archived:${keyHolder.id.slice(0, 8)}` },
        });
      }
      await prisma.overlapAlert.update({ where: { id: canonical.id }, data: { caseKey: desiredKey } });
    }

    if (canonical.cases.length === 0) {
      await prisma.overlapAlert.update({
        where: { id: canonical.id },
        data: {
          status: 'DISMISSED',
          resolvedAt: new Date(),
          dismissalReason: 'No supporting linked cases remain for this alert.',
        },
      });
      dismissedOrphans++;
    }
  }

  const orphanActive = await prisma.overlapAlert.findMany({
    where: {
      institutionId,
      status: { in: [...ACTIVE_ALERT_STATUSES] },
      cases: { none: {} },
    },
    select: { id: true },
  });
  for (const orphan of orphanActive) {
    await prisma.overlapAlert.update({
      where: { id: orphan.id },
      data: {
        status: 'DISMISSED',
        resolvedAt: new Date(),
        dismissalReason:
          'No supporting linked cases exist for this alert. It was superseded by a reconciled alert and retained for historical audit only.',
      },
    });
    dismissedOrphans++;
  }

  if (consolidated || dismissedOrphans) {
    await writeAudit(
      actorId ? { id: actorId } : null,
      'OVERLAP_ALERTS_RECONCILED',
      'Institution',
      institutionId,
      { consolidated, dismissedOrphans },
    );
  }

  return { consolidated, dismissedOrphans };
}

/** Dismiss active orphan alerts across institutions without deleting history. */
export async function reconcileOrphanAlerts(actorId?: string): Promise<number> {
  const orphans = await prisma.overlapAlert.findMany({
    where: {
      status: { in: [...ACTIVE_ALERT_STATUSES] },
      cases: { none: {} },
    },
    select: { id: true, institutionId: true },
  });
  for (const orphan of orphans) {
    await prisma.overlapAlert.update({
      where: { id: orphan.id },
      data: {
        status: 'DISMISSED',
        resolvedAt: new Date(),
        dismissalReason:
          'No supporting linked cases exist for this alert. It was retained for historical audit only.',
      },
    });
  }
  if (orphans.length) {
    await writeAudit(
      actorId ? { id: actorId } : null,
      'ORPHAN_ALERTS_DISMISSED',
      'OverlapAlert',
      'multiple',
      { count: orphans.length },
    );
  }
  return orphans.length;
}

/**
 * Re-evaluate institution-level coordination and duplicate-complaint alerts.
 *
 * Cross-bureau rule: two or more active cases for the same verified institution
 * are connected to different Bureaus/Cells. Duplicate suggestions are separate
 * and always require human review.
 */
export async function evaluateInstitutionOverlaps(
  institutionId: string,
  actorId?: string,
): Promise<EvaluationResult> {
  await reconcileInstitutionAlerts(institutionId, actorId);

  const institution = await prisma.institution.findUnique({
    where: { id: institutionId },
    include: {
      cases: {
        where: { status: { in: [...ACTIVE_CASE_STATUSES] } },
        include: { currentBureau: true, category: true, assignedOfficer: true },
      },
    },
  });
  if (!institution) return { created: 0, updated: 0, alerts: [] };

  let created = 0;
  let updated = 0;
  const alertIds: string[] = [];
  const managementIds = await getManagementUserIds();

  // ---- Cross-bureau overlap ----
  const byBureau = new Map<string, typeof institution.cases>();
  for (const c of institution.cases) {
    if (!c.currentBureauId) continue;
    const list = byBureau.get(c.currentBureauId) ?? [];
    list.push(c);
    byBureau.set(c.currentBureauId, list);
  }

  if (byBureau.size >= 2) {
    const bureaus = [...byBureau.values()].flatMap((cases) => cases.map((c) => c.currentBureau));
    const uniqueBureaus = [...new Map(bureaus.filter(Boolean).map((b) => [b!.id, b!])).values()];
    const caseIds = institution.cases.map((c) => c.id).sort();
    const caseKey = crossBureauAlertKey(institution.id);

    const evidence = [
      {
        type: 'INSTITUTION_MATCH',
        detail: `Verified institution record: ${institution.name} (AICTE Permanent ID ${institution.aictePermanentId})`,
      },
      {
        type: 'MULTIPLE_BUREAUS',
        detail: `Active cases span ${uniqueBureaus.length} Bureaus/Cells: ${uniqueBureaus.map((b) => b.name).join(', ')}`,
      },
      {
        type: 'ACTIVE_CASES',
        detail: `${institution.cases.length} active case(s) linked to this institution`,
      },
      {
        type: 'CASE_DETAIL',
        detail: institution.cases
          .map((c) => `${c.caseNumber} — ${c.currentBureau?.code ?? 'Unassigned'} — ${c.status}`)
          .join('; '),
      },
      { type: 'RULE_VERSION', detail: `Evaluated by ${OVERLAP_EVALUATION_VERSION}` },
    ];

    const detectionReason = `Active cases for the same verified institution exist in multiple Bureaus/Cells: ${uniqueBureaus
      .map((b) => `${b.name} (${byBureau.get(b.id)?.length ?? 0} active)`)
      .join('; ')}. Coordination is recommended so that actions are not duplicated and decisions remain consistent.`;

    const existing = await prisma.overlapAlert.findUnique({ where: { caseKey }, include: { cases: true } });
    let alertId: string;

    if (existing) {
      alertId = existing.id;
      await prisma.$transaction(async (tx) => {
        await tx.overlapAlert.update({
          where: { id: existing.id },
          data: {
            lastEvaluatedAt: new Date(),
            evidence: JSON.stringify(evidence),
            confidence: 0.95,
            detectionReason,
            ...(isActiveAlertStatus(existing.status)
              ? {}
              : {
                  status: 'NEW',
                  resolvedAt: null,
                  dismissalReason: null,
                  resolutionOutcome: null,
                  reviewerRemarks: null,
                }),
          },
        });
        await linkCasesToAlert(tx, existing.id, caseIds);
      });
      updated++;
    } else {
      const alert = await prisma.$transaction(async (tx) => {
        const newAlert = await tx.overlapAlert.create({
          data: {
            alertType: CROSS_BUREAU_ALERT_TYPE,
            status: 'NEW',
            institutionId: institution.id,
            caseKey,
            detectionReason,
            confidence: 0.95,
            evidence: JSON.stringify(evidence),
          },
        });
        await linkCasesToAlert(tx, newAlert.id, caseIds);
        return newAlert;
      });
      alertId = alert.id;
      created++;

      const officerIds = institution.cases.map((c) => c.assignedOfficerId).filter((id): id is string => Boolean(id));
      const bureauOfficers = await prisma.user.findMany({
        where: { bureauId: { in: uniqueBureaus.map((b) => b.id) }, isActive: true, role: 'BUREAU_OFFICER' },
        select: { id: true },
      });
      await notifyUsersSafe(
        prisma,
        [...officerIds, ...bureauOfficers.map((u) => u.id), ...managementIds],
        {
          type: 'OVERLAP_DETECTED',
          title: 'Cross-Bureau coordination required',
          message: `${institution.name}: active cases in ${uniqueBureaus.map((b) => b.code).join(' & ')} require coordination review.`,
          link: `/overlaps/${alert.id}`,
          alertId: alert.id,
          dedupeKey: `overlap-detected:${alert.id}`,
        },
      );
    }
    alertIds.push(alertId);
  }

  // ---- Potential duplicate complaints ----
  const cases = institution.cases;
  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const a = cases[i];
      const b = cases[j];
      const sim = await activeSimilarityProvider.compare(
        {
          id: a.id,
          title: a.title,
          description: a.description,
          categoryId: a.categoryId,
          categoryName: a.category.name,
          institutionId: a.institutionId,
          dateReceived: a.dateReceived,
        },
        {
          id: b.id,
          title: b.title,
          description: b.description,
          categoryId: b.categoryId,
          categoryName: b.category.name,
          institutionId: b.institutionId,
          dateReceived: b.dateReceived,
        },
      );

      if (!sim.isPotentialDuplicate || sim.score < SIMILARITY_THRESHOLDS.duplicate) continue;

      const caseKey = duplicateAlertKey(a.id, b.id);
      const evidence = [
        ...sim.evidence,
        { type: 'MATCHING_KEYWORDS', detail: sim.matchingKeywords.join(', ') || 'None' },
        {
          type: 'SCORING_METHOD',
          detail: 'Local rule-based similarity (institution + category + title + description + date); not an AI model.',
        },
        { type: 'RULE_VERSION', detail: OVERLAP_EVALUATION_VERSION },
      ];

      const existing = await prisma.overlapAlert.findUnique({ where: { caseKey }, include: { cases: true } });
      let duplicateAlertId: string;

      if (existing) {
        duplicateAlertId = existing.id;
        await prisma.overlapAlert.update({
          where: { id: existing.id },
          data: {
            lastEvaluatedAt: new Date(),
            evidence: JSON.stringify(evidence),
            similarityScore: sim.score,
            confidence: Math.min(0.9, sim.score),
            ...(isActiveAlertStatus(existing.status)
              ? {}
              : {
                  status: 'NEW',
                  resolvedAt: null,
                  dismissalReason: null,
                  resolutionOutcome: null,
                  reviewerRemarks: null,
                }),
          },
        });
        await prisma.$transaction(async (tx) => {
          await linkCasesToAlert(tx, existing.id, [a.id, b.id]);
        });
        updated++;
      } else {
        const alert = await prisma.$transaction(async (tx) => {
          const newAlert = await tx.overlapAlert.create({
            data: {
              alertType: DUPLICATE_ALERT_TYPE,
              status: 'NEW',
              institutionId: institution.id,
              caseKey,
              detectionReason: `${a.caseNumber} and ${b.caseNumber} share institution, category and text evidence consistent with a possible duplicate or closely related complaint. Similarity score ${(sim.score * 100).toFixed(0)}%. Review is recommended; this is not a definitive duplicate finding.`,
              confidence: Math.min(0.9, sim.score),
              similarityScore: sim.score,
              evidence: JSON.stringify(evidence),
            },
          });
          await linkCasesToAlert(tx, newAlert.id, [a.id, b.id]);
          return newAlert;
        });
        duplicateAlertId = alert.id;
        created++;

        const officerIds = [a.assignedOfficerId, b.assignedOfficerId].filter((id): id is string => Boolean(id));
        await notifyUsersSafe(prisma, [...officerIds, ...managementIds], {
          type: 'DUPLICATE_IDENTIFIED',
          title: 'Potentially related complaints identified',
          message: `${a.caseNumber} and ${b.caseNumber} have a ${(sim.score * 100).toFixed(0)}% similarity score. Review suggested.`,
          link: `/overlaps/${alert.id}`,
          alertId: alert.id,
          dedupeKey: `duplicate-detected:${alert.id}`,
        });
      }
      alertIds.push(duplicateAlertId);
    }
  }

  emitDataChanged('alerts', 'evaluated', institutionId);
  return { created, updated, alerts: alertIds };
}

export async function evaluateAllOverlaps(actorId?: string) {
  const dismissedOrphans = await reconcileOrphanAlerts(actorId);
  const institutions = await prisma.institution.findMany({ select: { id: true } });
  let created = 0;
  let updated = 0;
  for (const inst of institutions) {
    const result = await evaluateInstitutionOverlaps(inst.id, actorId);
    created += result.created;
    updated += result.updated;
  }
  return { created, updated, dismissedOrphans, institutions: institutions.length };
}
