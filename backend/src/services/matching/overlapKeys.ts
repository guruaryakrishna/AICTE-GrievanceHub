/**
 * Stable identities for overlap alerts. These functions are the only place
 * alert keys are constructed, so seed data, evaluation and reconciliation
 * cannot disagree about what constitutes "the same" alert.
 */

export const CROSS_BUREAU_ALERT_TYPE = 'CROSS_BUREAU_OVERLAP';
export const DUPLICATE_ALERT_TYPE = 'POTENTIAL_DUPLICATE';

export function crossBureauAlertKey(institutionId: string): string {
  return `cross-bureau:${institutionId}`;
}

export function duplicateAlertKey(caseIdA: string, caseIdB: string): string {
  const [first, second] = [caseIdA, caseIdB].sort();
  return `duplicate:${first}:${second}`;
}

export const ACTIVE_ALERT_STATUSES = ['NEW', 'UNDER_REVIEW', 'COORDINATION_REQUIRED'] as const;
export const TERMINAL_ALERT_STATUSES = ['RESOLVED', 'DISMISSED'] as const;

export function isActiveAlertStatus(status: string): boolean {
  return (ACTIVE_ALERT_STATUSES as readonly string[]).includes(status);
}

export function isTerminalAlertStatus(status: string): boolean {
  return (TERMINAL_ALERT_STATUSES as readonly string[]).includes(status);
}
