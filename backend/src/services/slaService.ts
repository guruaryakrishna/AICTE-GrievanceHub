import { prisma } from '../config/prisma';
import { OPEN_CASE_STATUSES } from '../domain/casePolicy';
import { caseDeadline } from '../domain/slaPolicy';
import { activeSlaRules, decorateWithSla } from './slaRules';
import {
  caseRecipientIds,
  createNotification,
  getManagementUserIds,
} from './notificationService';
import { writeAudit } from './auditService';

export interface SlaEvaluationResult {
  evaluated: number;
  onTrack: number;
  approaching: number;
  overdue: number;
  escalationWarnings: number;
  notificationsCreated: number;
}

/**
 * Evaluate SLA/deadline warnings for open cases.
 *
 * - Deadlines and warning windows come from the shared SLA policy, so this job
 *   cannot disagree with the dashboard or case detail.
 * - Disposed cases are excluded and are never reported as overdue.
 * - Each reminder has a stable key scoped to the recipient, so running the job
 *   repeatedly (scheduler or manual) creates at most one reminder per trigger
 *   per user. A new deadline produces a new key and therefore a new reminder.
 */
export async function evaluateSla(now = new Date()): Promise<SlaEvaluationResult> {
  const [cases, rules, managementIds] = await Promise.all([
    prisma.case.findMany({
      where: {
        status: { in: [...OPEN_CASE_STATUSES] },
        OR: [{ slaDueDate: { not: null } }, { nextActionDueDate: { not: null } }],
      },
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priority: true,
        slaDueDate: true,
        nextActionDueDate: true,
        categoryId: true,
        currentBureauId: true,
        assignedOfficerId: true,
        createdById: true,
        nextRequiredAction: true,
      },
    }),
    activeSlaRules(),
    getManagementUserIds(),
  ]);

  let onTrack = 0;
  let approaching = 0;
  let overdue = 0;
  let escalationWarnings = 0;
  let notificationsCreated = 0;

  for (const c of cases) {
    const deadline = caseDeadline(c);
    if (!deadline) continue;

    const { sla } = decorateWithSla(c, rules, now);
    if (sla.state === 'ON_TRACK') {
      onTrack++;
      continue;
    }
    if (sla.state !== 'OVERDUE' && sla.state !== 'APPROACHING') continue;

    if (sla.isOverdue) overdue++;
    else approaching++;

    // One stable key per case + state + deadline. Recipient scoping is handled
    // by the composite unique key (userId, dedupeKey).
    const dueKey = deadline.toISOString().slice(0, 10);
    const state = sla.isOverdue ? 'OVERDUE' : 'DEADLINE_APPROACHING';
    const dedupeKey = `sla:${c.id}:${state}:${dueKey}`;
    const recipients = await caseRecipientIds(c);

    const created = await createNotificationRows(recipients, {
      type: state,
      title:
        state === 'OVERDUE'
          ? `Case overdue: ${c.caseNumber}`
          : `Deadline approaching: ${c.caseNumber}`,
      message: slaMessage(c, deadline, state === 'OVERDUE'),
      link: `/cases/${c.id}`,
      caseId: c.id,
      dedupeKey,
    });
    notificationsCreated += created;

    if (sla.hoursRemaining !== null && sla.hoursRemaining <= sla.escalationThresholdHours) {
      escalationWarnings++;
      const escalationKey = `sla-escalation:${c.id}:${dueKey}`;
      const escalated = await createNotificationRows(managementIds, {
        type: 'ESCALATION_REQUIRED',
        title: `Escalation required: ${c.caseNumber}`,
        message: `${c.title} requires management attention (${
          sla.isOverdue ? 'past its deadline' : 'inside the escalation window'
        }). Deadline: ${formatDate(deadline)}.`,
        link: `/cases/${c.id}`,
        caseId: c.id,
        dedupeKey: escalationKey,
      });
      notificationsCreated += escalated;
    }
  }

  if (notificationsCreated > 0) {
    await writeAudit(null, 'SLA_EVALUATION_RUN', 'Case', 'multiple', {
      evaluated: cases.length,
      approaching,
      overdue,
      escalationWarnings,
      notificationsCreated,
    });
  }

  return {
    evaluated: cases.length,
    onTrack,
    approaching,
    overdue,
    escalationWarnings,
    notificationsCreated,
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function slaMessage(
  c: { caseNumber: string; title: string; nextRequiredAction: string | null },
  deadline: Date,
  isOverdue: boolean,
): string {
  if (isOverdue) {
    return `${c.title} was due on ${formatDate(deadline)}. Immediate action is required.`;
  }
  return `${c.title} is due soon. Complete "${c.nextRequiredAction ?? 'the next action'}" by ${formatDate(deadline)}.`;
}

async function createNotificationRows(
  userIds: string[],
  data: {
    type: string;
    title: string;
    message: string;
    link?: string;
    caseId?: string;
    dedupeKey: string;
  },
): Promise<number> {
  let created = 0;
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    const row = await createNotification(prisma, { ...data, userId });
    if (row) created++;
  }
  return created;
}

let slaTimer: NodeJS.Timeout | null = null;

export function startSlaScheduler(intervalMs = 15 * 60 * 1000) {
  if (slaTimer) return;
  const run = async () => {
    try {
      const result = await evaluateSla();
      if (result.notificationsCreated > 0) {
        console.log(`[SLA] Evaluation complete: ${result.notificationsCreated} notification(s) created.`);
      }
    } catch (err) {
      console.error('[SLA] Evaluation failed:', err instanceof Error ? err.message : err);
    }
  };
  const initial = setTimeout(run, 5_000);
  initial.unref?.();
  slaTimer = setInterval(run, intervalMs);
  slaTimer.unref?.();
}

export function stopSlaScheduler() {
  if (slaTimer) clearInterval(slaTimer);
  slaTimer = null;
}
