import { prisma } from '../config/prisma';
import {
  buildSlaSnapshot,
  selectSlaRule,
  type SlaCaseLike,
  type SlaRuleLike,
  type SlaSnapshot,
} from '../domain/slaPolicy';

/**
 * One place to load SLA rules and decorate a case. Every API surface that shows
 * a deadline uses this helper so the dashboard, list, detail and reports cannot
 * disagree about whether a case is overdue.
 */
export async function activeSlaRules(): Promise<SlaRuleLike[]> {
  return prisma.sLARule.findMany({ where: { isActive: true } });
}

export function slaSnapshotFor(
  c: SlaCaseLike,
  rules: SlaRuleLike[],
  now: Date = new Date(),
): SlaSnapshot {
  return buildSlaSnapshot(c, rules, now);
}

export function decorateWithSla<T extends SlaCaseLike>(
  c: T,
  rules: SlaRuleLike[],
  now: Date = new Date(),
): T & { sla: SlaSnapshot } {
  return { ...c, sla: slaSnapshotFor(c, rules, now) };
}

export function ruleForCase(c: SlaCaseLike, rules: SlaRuleLike[]): SlaRuleLike | null {
  return selectSlaRule(rules, {
    categoryId: c.categoryId ?? null,
    bureauId: c.currentBureauId ?? null,
    priority: c.priority ?? null,
  });
}
