import { prisma } from '../config/prisma';
import { AuthUser } from '../types';
import { isOpenStatus } from '../domain/casePolicy';
import { buildSlaSnapshot, caseDeadline } from '../domain/slaPolicy';
import { buildCaseWhere, DashboardFilters, getDashboard } from './dashboardService';
import { caseScopeWhere, listCases } from './caseService';
import { alertScopeWhere } from './alertService';
import { institutionScopeWhere } from './authorization';
import { activeSlaRules } from './slaRules';

export interface ReportFilters extends DashboardFilters {
  status?: string[];
  q?: string;
}

export async function getReportSummary(user: AuthUser, filters: ReportFilters) {
  const dashboard = await getDashboard(user, filters);
  const where = buildCaseWhere(user, filters);
  const now = new Date();

  const [slaCases, rules] = await Promise.all([
    prisma.case.findMany({
      where,
      select: {
        status: true,
        disposedAt: true,
        slaDueDate: true,
        nextActionDueDate: true,
        categoryId: true,
        currentBureauId: true,
        priority: true,
      },
    }),
    activeSlaRules(),
  ]);
  const withDeadline = slaCases.filter((c) => caseDeadline(c) !== null);
  const openSla = withDeadline.filter((c) => isOpenStatus(c.status));
  const onTimeDisposed = slaCases.filter((c) => {
    if (c.status !== 'DISPOSED' || !c.disposedAt) return false;
    const deadline = caseDeadline(c);
    return Boolean(deadline && c.disposedAt <= deadline);
  }).length;
  const disposedWithSla = slaCases.filter((c) => c.status === 'DISPOSED' && caseDeadline(c) !== null).length;
  const slaOverdue = openSla.filter((c) => buildSlaSnapshot(c, rules, now).isOverdue).length;
  const slaApproaching = openSla.filter((c) => buildSlaSnapshot(c, rules, now).isApproaching).length;

  const alerts = await prisma.overlapAlert.findMany({
    where: {
      AND: [
        alertScopeWhere(user),
        filters.regionId ? { institution: { regionId: filters.regionId } } : {},
        filters.dateFrom || filters.dateTo
          ? {
              firstDetectedAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {},
      ],
    },
    include: {
      institution: { select: { id: true, name: true, aictePermanentId: true } },
      cases: { include: { case: { select: { caseNumber: true, status: true, currentBureau: { select: { code: true } } } } } },
    },
    orderBy: { firstDetectedAt: 'desc' },
    take: 500,
  });

  return {
    ...dashboard,
    sla: {
      totalWithSla: withDeadline.length,
      openWithSla: openSla.length,
      overdue: slaOverdue,
      approaching: slaApproaching,
      onTimeDisposed,
      disposedWithSla,
      complianceRate: disposedWithSla ? Math.round((onTimeDisposed / disposedWithSla) * 1000) / 10 : 0,
      definition: 'Deadline is slaDueDate, or nextActionDueDate when the SLA date is absent. Disposed cases are never overdue.',
    },
    alerts,
  };
}

export function escapeCsvFormula(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  // Spreadsheet formula injection protection.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCsvFormula).join(',')];
  for (const row of rows) lines.push(row.map(escapeCsvFormula).join(','));
  // UTF-8 BOM for Excel compatibility.
  return `\uFEFF${lines.join('\r\n')}`;
}

export async function exportCasesCsv(user: AuthUser, filters: ReportFilters & { bureauId?: string; status?: string[] }) {
  const { items } = await listCases(user, {
    q: filters.q,
    status: filters.status,
    bureauId: filters.bureauId,
    regionId: filters.regionId,
    categoryId: filters.categoryId,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    overdue: undefined,
    page: 1,
    pageSize: 100000,
    sortBy: 'dateReceived',
    sortOrder: 'desc',
  });

  const headers = [
    'Case Number', 'Institution', 'AICTE Permanent ID', 'Title', 'Category', 'Priority',
    'Status', 'Bureau/Cell', 'Assigned Officer', 'Date Received', 'Next Action',
    'Next Action Due', 'SLA Due', 'Disposed At', 'Resolution Remarks',
  ];
  const rows = items.map((c) => [
    c.caseNumber,
    c.institution?.name ?? c.originalInstitutionName ?? '',
    c.institution?.aictePermanentId ?? '',
    c.title,
    c.category.name,
    c.priority,
    c.status,
    c.currentBureau?.name ?? '',
    c.assignedOfficer ? `${c.assignedOfficer.firstName} ${c.assignedOfficer.lastName}` : '',
    c.dateReceived.toISOString(),
    c.nextRequiredAction ?? '',
    c.nextActionDueDate?.toISOString() ?? '',
    c.slaDueDate?.toISOString() ?? '',
    c.disposedAt?.toISOString() ?? '',
    c.resolutionRemarks ?? '',
  ]);
  return toCsv(headers, rows);
}

export async function exportAlertsCsv(user: AuthUser, filters: ReportFilters) {
  const alerts = await prisma.overlapAlert.findMany({
    where: {
      AND: [
        alertScopeWhere(user),
        filters.regionId ? { institution: { regionId: filters.regionId } } : {},
        filters.dateFrom || filters.dateTo
          ? {
              firstDetectedAt: {
                ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
                ...(filters.dateTo ? { lte: filters.dateTo } : {}),
              },
            }
          : {},
      ],
    },
    include: {
      institution: true,
      cases: { include: { case: { select: { caseNumber: true, currentBureau: { select: { code: true } } } } } },
    },
    orderBy: { firstDetectedAt: 'desc' },
  });

  const headers = [
    'Alert Type', 'Status', 'Institution', 'AICTE Permanent ID', 'Confidence', 'Similarity',
    'Cases', 'Bureaus', 'Detection Reason', 'First Detected', 'Last Evaluated',
    'Resolution Outcome', 'Dismissal Reason',
  ];
  const rows = alerts.map((a) => [
    a.alertType,
    a.status,
    a.institution?.name ?? '',
    a.institution?.aictePermanentId ?? '',
    a.confidence ?? '',
    a.similarityScore ?? '',
    a.cases.map((c) => c.case.caseNumber).join(' | '),
    [...new Set(a.cases.map((c) => c.case.currentBureau?.code).filter(Boolean))].join(' | '),
    a.detectionReason,
    a.firstDetectedAt.toISOString(),
    a.lastEvaluatedAt.toISOString(),
    a.resolutionOutcome ?? '',
    a.dismissalReason ?? '',
  ]);
  return toCsv(headers, rows);
}

export async function exportInstitutionsCsv(user: AuthUser, filters: { q?: string; regionId?: string }) {
  const institutions = await prisma.institution.findMany({
    where: {
      AND: [
        // Institution exports obey the same fail-closed scope as the registry:
        // a Bureau officer only sees institutions with cases in their Bureau,
        // and a Regional officer only sees institutions in their Region.
        institutionScopeWhere(user),
        filters.regionId ? { regionId: filters.regionId } : {},
        filters.q
          ? { OR: [{ name: { contains: filters.q } }, { aictePermanentId: { contains: filters.q } }] }
          : {},
      ],
    },
    include: { region: true, _count: { select: { cases: true } } },
    orderBy: { name: 'asc' },
  });
  const headers = [
    'AICTE Permanent ID', 'Institution Name', 'Type', 'City', 'District', 'State', 'Region',
    'PIN Code', 'Active', 'Total Cases',
  ];
  const rows = institutions.map((i) => [
    i.aictePermanentId, i.name, i.institutionType ?? '', i.city ?? '', i.district ?? '',
    i.state ?? '', i.region?.name ?? '', i.pinCode ?? '', i.isActive ? 'Yes' : 'No', i._count.cases,
  ]);
  return toCsv(headers, rows);
}

/** Counts used by dashboard and reports - kept in one place for consistent definitions. */
export async function caseCountForScope(user: AuthUser) {
  return prisma.case.count({ where: caseScopeWhere(user) });
}
