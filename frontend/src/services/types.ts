export type Role =
  | 'ADMIN'
  | 'BUREAU_OFFICER'
  | 'REGIONAL_OFFICER'
  | 'SENIOR_MANAGEMENT'
  | 'READ_ONLY';

export type CaseStatus =
  | 'RECEIVED'
  | 'UNDER_REVIEW'
  | 'UNDER_PROCESS'
  | 'TRANSFERRED'
  | 'ESCALATED'
  | 'DISPOSED'
  | 'REOPENED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Ref {
  id: string;
  name: string;
  code: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  bureauId: string | null;
  regionId: string | null;
  bureau?: Ref | null;
  region?: Ref | null;
}

export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Bureau {
  id: string;
  name: string;
  code: string;
  type: string;
  description?: string | null;
  isActive: boolean;
}

export interface Region {
  id: string;
  name: string;
  code: string;
  states: string;
  isActive: boolean;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
}

export interface InstitutionAlias {
  id: string;
  institutionId: string;
  alias: string;
  normalizedAlias: string;
  createdAt: string;
}

export interface Institution {
  id: string;
  aictePermanentId: string;
  name: string;
  normalizedName: string;
  alternateNames?: string | null;
  alternateNamesList?: string[] | null;
  institutionType?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  regionId?: string | null;
  region?: Region | null;
  pinCode?: string | null;
  contactDetails?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  aliases?: InstitutionAlias[];
  _count?: { cases: number; alerts: number };
}

export interface SlaSnapshot {
  dueAt: string | null;
  state: 'NONE' | 'ON_TRACK' | 'APPROACHING' | 'OVERDUE';
  isOverdue: boolean;
  isApproaching: boolean;
  hoursRemaining: number | null;
  warningThresholdHours: number;
  escalationThresholdHours: number;
  ruleId: string | null;
  ruleName: string | null;
}

export interface OfficerRef {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  role?: Role;
  bureauId?: string | null;
  bureau?: Ref | null;
}

export interface CaseAction {
  id: string;
  caseId: string;
  actionType: string;
  performedById: string;
  performedBy?: OfficerRef | null;
  bureauId?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  remarks?: string | null;
  metadata?: unknown;
  alertId?: string | null;
  timestamp: string;
}

export interface AlertSummary {
  id: string;
  alertType: string;
  status: string;
  institutionId?: string | null;
  institution?: Pick<Institution, 'id' | 'name' | 'aictePermanentId' | 'state'> | null;
  caseKey?: string | null;
  detectionReason: string;
  confidence?: number | null;
  similarityScore?: number | null;
  evidence?: unknown;
  assignedCoordinatorId?: string | null;
  firstDetectedAt: string;
  lastEvaluatedAt: string;
  resolvedAt?: string | null;
  dismissalReason?: string | null;
  resolutionOutcome?: string | null;
  reviewerRemarks?: string | null;
  createdAt: string;
  updatedAt: string;
  cases?: CaseAlertLink[];
  reviews?: AlertReview[];
}

export interface CaseAlertLink {
  id: string;
  caseId: string;
  alertId: string;
  alert?: AlertSummary | null;
  case?: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    currentBureau?: Ref | null;
    category?: Category | null;
    assignedOfficer?: OfficerRef | null;
    actionHistory?: CaseAction[];
  };
}

export interface AlertReview {
  id: string;
  action: string;
  remarks?: string | null;
  outcome?: string | null;
  reviewedBy?: OfficerRef | null;
  timestamp: string;
}

export interface IdentityCandidate {
  institutionId: string;
  name: string;
  aictePermanentId: string;
  regionId?: string | null;
  city?: string | null;
  state?: string | null;
  score: number;
  requiresReview: boolean;
  autoLink: boolean;
  reasoning?: string | null;
  evidence?: unknown;
}

export interface IdentityResolution {
  id: string;
  caseId: string;
  submittedName: string;
  submittedAictePermanentId?: string | null;
  status: 'PENDING' | 'RESOLVED' | 'DISMISSED';
  candidateEvidence?: {
    policy?: string;
    intakeNote?: string | null;
    candidates?: IdentityCandidate[];
  } | null;
  resolvedInstitutionId?: string | null;
  resolvedInstitution?: Pick<Institution, 'id' | 'name' | 'aictePermanentId'> | null;
  resolvedById?: string | null;
  resolvedBy?: OfficerRef | null;
  resolutionNote?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  case?: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    priority: string;
    currentBureau?: Ref | null;
    createdBy?: OfficerRef | null;
  };
}

export interface CasePermissions {
  canModify: boolean;
  canAssign: boolean;
  canAddAction: boolean;
  canTransfer: boolean;
  canEscalate: boolean;
  canDispose: boolean;
  canReopen: boolean;
}

export interface CaseRecord {
  id: string;
  caseNumber: string;
  title: string;
  description: string;
  status: CaseStatus;
  priority: Priority;
  categoryId: string;
  category?: Category | null;
  institutionId?: string | null;
  institution?: (Institution & { region?: Region | null }) | null;
  originalInstitutionName?: string | null;
  currentBureauId?: string | null;
  currentBureau?: Bureau | null;
  assignedOfficerId?: string | null;
  assignedOfficer?: OfficerRef | null;
  createdById: string;
  createdBy?: OfficerRef | null;
  dateReceived: string;
  lastAction?: string | null;
  lastActionDate?: string | null;
  nextRequiredAction?: string | null;
  nextActionDueDate?: string | null;
  expectedDisposalDate?: string | null;
  slaDueDate?: string | null;
  resolutionRemarks?: string | null;
  disposedAt?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  escalatedAt?: string | null;
  transferredFromBureauId?: string | null;
  createdAt: string;
  updatedAt: string;
  sla: SlaSnapshot;
  permissions: CasePermissions;
  allowedStatusTargets: CaseStatus[];
  availableWorkflowActions: string[];
  actionHistory?: CaseAction[];
  alerts?: CaseAlertLink[];
  identityResolution?: IdentityResolution | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface DashboardData {
  generatedAt: string;
  filters: Record<string, string | null>;
  metrics: {
    totalCases: number;
    pendingCases: number;
    activeCases: number;
    underReview: number;
    underProcess: number;
    received: number;
    transferred: number;
    escalated: number;
    disposed: number;
    reopened: number;
    overdue: number;
    approachingDeadline: number;
    activeAlerts: number;
    duplicateAlerts: number;
    alertsRequiringReview: number;
    pendingIdentityResolutions: number;
    disposalRate: number;
    avgDisposalDays: number;
  };
  quickStats: {
    total: number;
    pending: number;
    active: number;
    disposed: number;
    overdue: number;
    approaching: number;
  };
  statusDistribution: { status: string; count: number }[];
  categoryDistribution: { id: string; name: string; count: number }[];
  bureauWorkload: { id: string | null; name: string; code: string; activeCases: number }[];
  regionWorkload: { name: string; code: string; activeCases: number }[];
  topInstitutions: { id: string; name: string; aictePermanentId: string; count: number }[];
  ageing: { bucket: string; count: number }[];
  trends: { month: string; received: number; disposed: number }[];
  urgentCases: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    priority: string;
    slaDueDate: string | null;
    nextActionDueDate: string | null;
    expectedDisposalDate: string | null;
    dateReceived: string;
    institution?: { id: string; name: string; aictePermanentId: string } | null;
    currentBureau?: Ref | null;
    category?: Category | null;
    assignedOfficer?: OfficerRef | null;
    sla: SlaSnapshot;
  }[];
  recentAlerts: AlertSummary[];
}

export interface ReportSummary extends DashboardData {
  sla: {
    totalWithSla: number;
    openWithSla: number;
    overdue: number;
    approaching: number;
    onTimeDisposed: number;
    disposedWithSla: number;
    complianceRate: number;
    definition: string;
  };
  alerts: AlertSummary[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
  caseId?: string | null;
  alertId?: string | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface SlaRule {
  id: string;
  name: string;
  categoryId?: string | null;
  category?: Category | null;
  bureauId?: string | null;
  priority?: string | null;
  slaDurationHours: number;
  warningThresholdHours: number;
  escalationThresholdHours: number;
  isActive: boolean;
  isDemonstration: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  userId?: string | null;
  user?: { id: string; firstName: string; lastName: string; email: string; role: Role } | null;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: unknown;
  timestamp: string;
}

export interface InstitutionCandidate {
  institution: Institution;
  score: number;
  requiresReview: boolean;
  autoLink: boolean;
  reasoning?: string | null;
  evidence?: unknown;
}
