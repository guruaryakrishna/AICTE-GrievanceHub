export type Role =
  | 'ADMIN'
  | 'BUREAU_OFFICER'
  | 'REGIONAL_OFFICER'
  | 'SENIOR_MANAGEMENT'
  | 'READ_ONLY';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  bureauId: string | null;
  regionId: string | null;
  bureau?: { id: string; name: string; code: string } | null;
  region?: { id: string; name: string; code: string } | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {
  ACTIVE_CASE_STATUSES,
  OPEN_CASE_STATUSES,
  CLOSED_CASE_STATUSES,
  CASE_STATUSES,
  CASE_STATUS_TRANSITIONS,
  SPECIAL_OPERATION_STATUSES,
  MANUAL_STATUS_TARGETS,
  assertManualTransition,
  assertWorkflowTransition,
  manualStatusTargets,
  isOpenStatus,
  isClosedStatus,
  WorkflowPolicyError,
  type CaseStatus,
} from '../domain/casePolicy';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  BUREAU_OFFICER: 'Bureau/Cell Officer',
  REGIONAL_OFFICER: 'Regional Officer',
  SENIOR_MANAGEMENT: 'Senior Management',
  READ_ONLY: 'Read-Only Viewer',
};
