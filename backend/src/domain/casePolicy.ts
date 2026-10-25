/**
 * Single source of truth for complaint lifecycle rules.
 *
 * A status field is never enough to represent a special operation. Transfers,
 * escalations, disposals and reopenings must go through their dedicated
 * services so required evidence (destination, reason, outcome) is recorded.
 */

export type CaseStatus =
  | 'RECEIVED'
  | 'UNDER_REVIEW'
  | 'UNDER_PROCESS'
  | 'TRANSFERRED'
  | 'ESCALATED'
  | 'DISPOSED'
  | 'REOPENED';

export const CASE_STATUSES: readonly CaseStatus[] = [
  'RECEIVED',
  'UNDER_REVIEW',
  'UNDER_PROCESS',
  'TRANSFERRED',
  'ESCALATED',
  'DISPOSED',
  'REOPENED',
];

/** Statuses that represent work still in progress inside a Bureau/Cell. */
export const ACTIVE_CASE_STATUSES: readonly CaseStatus[] = [
  'RECEIVED',
  'UNDER_REVIEW',
  'UNDER_PROCESS',
  'ESCALATED',
  'REOPENED',
];

/** Every case that has not been disposed. Transferred cases remain open. */
export const OPEN_CASE_STATUSES: readonly CaseStatus[] = [...ACTIVE_CASE_STATUSES, 'TRANSFERRED'];

export const CLOSED_CASE_STATUSES: readonly CaseStatus[] = ['DISPOSED'];

/** Statuses that may only be reached through a dedicated workflow service. */
export const SPECIAL_OPERATION_STATUSES: readonly CaseStatus[] = [
  'TRANSFERRED',
  'ESCALATED',
  'DISPOSED',
  'REOPENED',
];

/** Generic status updates are limited to ordinary review progression. */
export const MANUAL_STATUS_TARGETS: readonly CaseStatus[] = ['UNDER_REVIEW', 'UNDER_PROCESS'];

const ALLOWED_MANUAL: Record<string, CaseStatus[]> = {
  RECEIVED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['UNDER_PROCESS'],
  UNDER_PROCESS: ['UNDER_REVIEW'],
  TRANSFERRED: ['UNDER_REVIEW', 'UNDER_PROCESS'],
  ESCALATED: ['UNDER_REVIEW', 'UNDER_PROCESS'],
  REOPENED: ['UNDER_REVIEW', 'UNDER_PROCESS'],
  DISPOSED: [],
};

export const CASE_STATUS_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ['UNDER_REVIEW', 'ESCALATED', 'TRANSFERRED', 'DISPOSED'],
  UNDER_REVIEW: ['UNDER_PROCESS', 'ESCALATED', 'TRANSFERRED', 'DISPOSED'],
  UNDER_PROCESS: ['UNDER_REVIEW', 'ESCALATED', 'TRANSFERRED', 'DISPOSED'],
  TRANSFERRED: ['UNDER_REVIEW', 'UNDER_PROCESS', 'ESCALATED', 'DISPOSED'],
  ESCALATED: ['UNDER_REVIEW', 'UNDER_PROCESS', 'TRANSFERRED', 'DISPOSED'],
  REOPENED: ['UNDER_REVIEW', 'UNDER_PROCESS', 'ESCALATED', 'TRANSFERRED', 'DISPOSED'],
  DISPOSED: ['REOPENED'],
};

export function isOpenStatus(status: string): boolean {
  return OPEN_CASE_STATUSES.includes(status as CaseStatus);
}

export function isClosedStatus(status: string): boolean {
  return CLOSED_CASE_STATUSES.includes(status as CaseStatus);
}

export function manualStatusTargets(status: string): CaseStatus[] {
  return ALLOWED_MANUAL[status] ?? [];
}

/**
 * Validate a generic status update. Special operations are deliberately
 * rejected here so their required fields cannot be bypassed.
 */
export function assertManualTransition(from: string, to: string): void {
  if (SPECIAL_OPERATION_STATUSES.includes(to as CaseStatus)) {
    const operation =
      to === 'TRANSFERRED'
        ? 'transfer'
        : to === 'ESCALATED'
          ? 'escalation'
          : to === 'DISPOSED'
            ? 'disposal'
            : 'reopening';
    throw new WorkflowPolicyError(
      `The ${operation} workflow is required to reach ${to}. A generic status update cannot perform this operation.`,
    );
  }
  if (from === to) {
    throw new WorkflowPolicyError(`The case is already ${from.replace(/_/g, ' ').toLowerCase()}.`);
  }
  const allowed = ALLOWED_MANUAL[from] ?? [];
  if (!allowed.includes(to as CaseStatus)) {
    throw new WorkflowPolicyError(`Invalid status transition from ${from} to ${to}`);
  }
}

/** Validate a workflow-specific transition against the full policy table. */
export function assertWorkflowTransition(from: string, to: string, operation: string): void {
  const allowed = CASE_STATUS_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new WorkflowPolicyError(
      `The case cannot ${operation} while it is ${from.replace(/_/g, ' ').toLowerCase()}.`,
    );
  }
}

/** Error type kept local so the domain layer has no HTTP dependency. */
export class WorkflowPolicyError extends Error {
  code = 'WORKFLOW_POLICY';
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowPolicyError';
  }
}
