/**
 * Authoritative SLA policy shared by intake, case lists, case detail,
 * dashboards, reports and the scheduled evaluator.
 *
 * Definitions:
 * - Deadline: `slaDueDate` when present, otherwise the operational
 *   `nextActionDueDate` (legacy/imported records) as a documented fallback.
 * - Tracked cases: every case that is not DISPOSED. Transferred cases are open.
 * - Overdue: deadline < now.
 * - Approaching: not overdue and within the applicable rule's warning window.
 */

export interface SlaRuleLike {
  id: string;
  name: string;
  categoryId: string | null;
  bureauId: string | null;
  priority: string | null;
  slaDurationHours: number;
  warningThresholdHours: number;
  escalationThresholdHours: number;
  isActive?: boolean;
  createdAt?: Date | string;
}

export interface SlaContext {
  categoryId?: string | null;
  bureauId?: string | null;
  priority?: string | null;
}

export interface SlaCaseLike {
  status: string;
  slaDueDate?: Date | string | null;
  nextActionDueDate?: Date | string | null;
  categoryId?: string | null;
  currentBureauId?: string | null;
  priority?: string | null;
}

export type SlaState = 'NONE' | 'ON_TRACK' | 'APPROACHING' | 'OVERDUE';

export interface SlaSnapshot {
  dueAt: string | null;
  state: SlaState;
  isOverdue: boolean;
  isApproaching: boolean;
  hoursRemaining: number | null;
  warningThresholdHours: number;
  escalationThresholdHours: number;
  ruleId: string | null;
  ruleName: string | null;
}

export const SLA_DEFAULTS = {
  warningThresholdHours: 72,
  escalationThresholdHours: 24,
} as const;

export const SLA_TRACKED_STATUSES = [
  'RECEIVED',
  'UNDER_REVIEW',
  'UNDER_PROCESS',
  'TRANSFERRED',
  'ESCALATED',
  'REOPENED',
] as const;

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ruleMatches(rule: SlaRuleLike, context: SlaContext): boolean {
  if (rule.isActive === false) return false;
  if (rule.categoryId && rule.categoryId !== context.categoryId) return false;
  if (rule.bureauId && rule.bureauId !== context.bureauId) return false;
  if (rule.priority && rule.priority !== context.priority) return false;
  return true;
}

export function ruleSpecificity(rule: SlaRuleLike): number {
  return (rule.categoryId ? 4 : 0) + (rule.bureauId ? 2 : 0) + (rule.priority ? 1 : 0);
}

/**
 * Choose the most specific matching active rule. A global rule (all nullable
 * selectors empty) is the only intentional fallback. A rule for an unrelated
 * category is never used for a different category.
 */
export function selectSlaRule(rules: SlaRuleLike[], context: SlaContext): SlaRuleLike | null {
  const matching = rules.filter((rule) => ruleMatches(rule, context));
  if (matching.length === 0) return null;
  return matching.sort((a, b) => {
    const specificity = ruleSpecificity(b) - ruleSpecificity(a);
    if (specificity !== 0) return specificity;
    const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bd - ad;
  })[0];
}

export function computeSlaDueDate(dateReceived: Date, rule: SlaRuleLike | null): Date | null {
  if (!rule || !Number.isFinite(rule.slaDurationHours) || rule.slaDurationHours <= 0) return null;
  return new Date(dateReceived.getTime() + rule.slaDurationHours * 60 * 60 * 1000);
}

export function caseDeadline(c: SlaCaseLike): Date | null {
  return toDate(c.slaDueDate) ?? toDate(c.nextActionDueDate);
}

export function buildSlaSnapshot(
  c: SlaCaseLike,
  rules: SlaRuleLike[],
  now: Date = new Date(),
): SlaSnapshot {
  const rule = selectSlaRule(rules, {
    categoryId: c.categoryId ?? null,
    bureauId: c.currentBureauId ?? null,
    priority: c.priority ?? null,
  });
  const warningThresholdHours = rule?.warningThresholdHours ?? SLA_DEFAULTS.warningThresholdHours;
  const escalationThresholdHours = rule?.escalationThresholdHours ?? SLA_DEFAULTS.escalationThresholdHours;
  const deadline = caseDeadline(c);
  const closed = c.status === 'DISPOSED';

  if (closed || !deadline) {
    return {
      dueAt: deadline ? deadline.toISOString() : null,
      state: 'NONE',
      isOverdue: false,
      isApproaching: false,
      hoursRemaining: null,
      warningThresholdHours,
      escalationThresholdHours,
      ruleId: rule?.id ?? null,
      ruleName: rule?.name ?? null,
    };
  }

  const hoursRemaining = (deadline.getTime() - now.getTime()) / 3_600_000;
  const isOverdue = hoursRemaining < 0;
  const isApproaching = !isOverdue && hoursRemaining <= warningThresholdHours;

  return {
    dueAt: deadline.toISOString(),
    state: isOverdue ? 'OVERDUE' : isApproaching ? 'APPROACHING' : 'ON_TRACK',
    isOverdue,
    isApproaching,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    warningThresholdHours,
    escalationThresholdHours,
    ruleId: rule?.id ?? null,
    ruleName: rule?.name ?? null,
  };
}

/** Prisma-compatible filter for open, overdue cases. */
export function overdueCaseWhere(now: Date = new Date()) {
  return {
    AND: [
      { status: { not: 'DISPOSED' } },
      {
        OR: [
          { slaDueDate: { lt: now } },
          { slaDueDate: null, nextActionDueDate: { lt: now } },
        ],
      },
    ],
  };
}

/** Prisma-compatible filter for open, approaching cases. */
export function approachingCaseWhere(withinHours: number, now: Date = new Date()) {
  const soon = new Date(now.getTime() + withinHours * 3_600_000);
  return {
    AND: [
      { status: { not: 'DISPOSED' } },
      {
        OR: [
          { slaDueDate: { gte: now, lte: soon } },
          { slaDueDate: null, nextActionDueDate: { gte: now, lte: soon } },
        ],
      },
    ],
  };
}
