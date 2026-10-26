import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AuthUser } from '../types';
import { ACTIVE_CASE_STATUSES, OPEN_CASE_STATUSES } from '../domain/casePolicy';
import { caseScopeWhere } from './authorization';
import { alertScopeWhere } from './alertService';
import { activeSlaRules, decorateWithSla } from './slaRules';
import { identityResolutionStats } from './institutionService';

export interface DashboardFilters {
  bureauId?: string;
  regionId?: string;
  categoryId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export function buildCaseWhere(user: AuthUser, filters: DashboardFilters): Prisma.CaseWhereInput {
  return {
    AND: [
      caseScopeWhere(user),
      filters.bureauId ? { currentBureauId: filters.bureauId } : {},
      filters.regionId ? { institution: { regionId: filters.regionId } } : {},
      filters.categoryId ? { categoryId: filters.categoryId } : {},
      filters.dateFrom || filters.dateTo
        ? {
            dateReceived: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {},
    ],
  };
}

/**
 * Dashboard statistics are computed from the database and the same SLA policy
 * used by the case list, detail page and reports. There are no fabricated or
 * hard-coded figures.
 */
export async function getDashboard(user: AuthUser, filters: DashboardFilters) {
  const now = new Date();
  const baseWhere = buildCaseWhere(user, filters);
  const openWhere: Prisma.CaseWhereInput = {
    AND: [baseWhere, { status: { in: [...OPEN_CASE_STATUSES] } }],
  };
  const alertBase: Prisma.OverlapAlertWhereInput = {
    AND: [
      alertScopeWhere(user),
      { status: { in: ['NEW', 'UNDER_REVIEW', 'COORDINATION_REQUIRED'] } },
      filters.regionId || filters.bureauId
        ? {
            institution: {
              ...(filters.regionId ? { regionId: filters.regionId } : {}),
              ...(filters.bureauId
                ? {
                    cases: {
                      some: {
                        currentBureauId: filters.bureauId,
                        status: { in: [...OPEN_CASE_STATUSES] },
                      },
                    },
                  }
                : {}),
            },
          }
        : {},
      filters.dateFrom || filters.dateTo
        ? {
            firstDetectedAt: {
              ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
              ...(filters.dateTo ? { lte: filters.dateTo } : {}),
            },
          }
        : {},
    ],
  };

  const [
    statusGroups,
    openCasesForSla,
    activeAlerts,
    duplicateAlerts,
    reviewAlerts,
    recentAlerts,
    categoryGroups,
    bureauGroups,
    rules,
    identityStats,
  ] = await Promise.all([
    prisma.case.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
    prisma.case.findMany({
      where: openWhere,
      select: {
        id: true,
        caseNumber: true,
        title: true,
        status: true,
        priority: true,
        slaDueDate: true,
        nextActionDueDate: true,
        expectedDisposalDate: true,
        categoryId: true,
        currentBureauId: true,
        dateReceived: true,
        institution: { select: { id: true, name: true, aictePermanentId: true } },
        currentBureau: { select: { id: true, name: true, code: true } },
        category: { select: { id: true, name: true, code: true } },
        assignedOfficer: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.overlapAlert.count({ where: alertBase }),
    prisma.overlapAlert.count({
      where: { AND: [alertBase, { alertType: 'POTENTIAL_DUPLICATE' }] },
    }),
    prisma.overlapAlert.count({ where: { AND: [alertBase, { status: { in: ['NEW', 'UNDER_REVIEW'] } }] } }),
    prisma.overlapAlert.findMany({
      where: alertBase,
      include: {
        institution: { select: { id: true, name: true, aictePermanentId: true } },
        cases: {
          include: {
            case: {
              select: {
                id: true,
                caseNumber: true,
                status: true,
                currentBureau: { select: { code: true } },
              },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { firstDetectedAt: 'desc' }],
      take: 5,
    }),
    prisma.case.groupBy({ by: ['categoryId'], where: baseWhere, _count: { _all: true } }),
    prisma.case.groupBy({
      by: ['currentBureauId'],
      where: { AND: [baseWhere, { status: { in: [...OPEN_CASE_STATUSES] } }] },
      _count: { _all: true },
    }),
    activeSlaRules(),
    identityResolutionStats(user),
  ]);

  const counts = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const totalCases = statusGroups.reduce((sum, g) => sum + g._count._all, 0);
  const disposedCases = counts.DISPOSED ?? 0;
  const activeCases = ACTIVE_CASE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const pendingCases = OPEN_CASE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  const decoratedOpen = openCasesForSla.map((c) => decorateWithSla(c, rules, now));
  const overdue = decoratedOpen.filter((c) => c.sla.isOverdue).length;
  const approaching = decoratedOpen.filter((c) => c.sla.isApproaching).length;
  const urgentCases = [...decoratedOpen]
    .sort((a, b) => {
      const aDue = a.sla.dueAt ? new Date(a.sla.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.sla.dueAt ? new Date(b.sla.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    })
    .slice(0, 8);

  const [categories, bureaus] = await Promise.all([
    prisma.complaintCategory.findMany({ where: { id: { in: categoryGroups.map((g) => g.categoryId) } } }),
    prisma.bureau.findMany({
      where: {
        id: {
          in: bureauGroups.map((g) => g.currentBureauId).filter((x): x is string => Boolean(x)),
        },
      },
    }),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const bureauById = new Map(bureaus.map((b) => [b.id, b]));

  // Region workload is derived in one query to avoid per-row lookups.
  const regionMap = new Map<string, { name: string; code: string; activeCases: number }>();
  const regionRows = await prisma.case.findMany({
    where: openWhere,
    select: {
      institution: { select: { regionId: true, region: { select: { name: true, code: true } } } },
    },
  });
  for (const row of regionRows) {
    const regionId = row.institution?.regionId ?? 'unassigned';
    const name = row.institution?.region?.name ?? 'Unassigned';
    const code = row.institution?.region?.code ?? '—';
    const entry = regionMap.get(regionId);
    if (entry) entry.activeCases++;
    else regionMap.set(regionId, { name, code, activeCases: 1 });
  }

  const institutionGroups = await prisma.case.groupBy({
    by: ['institutionId'],
    where: { AND: [baseWhere, { institutionId: { not: null } }] },
    _count: { _all: true },
    orderBy: { _count: { institutionId: 'desc' } },
    take: 10,
  });
  const topInstitutions = await prisma.institution.findMany({
    where: { id: { in: institutionGroups.map((g) => g.institutionId!) } },
    select: { id: true, name: true, aictePermanentId: true },
  });
  const instById = new Map(topInstitutions.map((i) => [i.id, i]));

  const ageing = { '0-7 days': 0, '8-15 days': 0, '16-30 days': 0, '31-60 days': 0, '60+ days': 0 };
  for (const c of openCasesForSla) {
    const days = Math.floor((now.getTime() - c.dateReceived.getTime()) / 86_400_000);
    if (days <= 7) ageing['0-7 days']++;
    else if (days <= 15) ageing['8-15 days']++;
    else if (days <= 30) ageing['16-30 days']++;
    else if (days <= 60) ageing['31-60 days']++;
    else ageing['60+ days']++;
  }

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendCases = await prisma.case.findMany({
    where: {
      AND: [
        baseWhere,
        { OR: [{ dateReceived: { gte: sixMonthsAgo } }, { disposedAt: { gte: sixMonthsAgo } }] },
      ],
    },
    select: { dateReceived: true, disposedAt: true },
  });
  const months: { month: string; received: number; disposed: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
      received: 0,
      disposed: 0,
    });
  }
  const monthKey = (d: Date) => d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
  const monthIndex = new Map(months.map((m, i) => [m.month, i]));
  for (const c of trendCases) {
    if (c.dateReceived >= sixMonthsAgo) {
      const idx = monthIndex.get(monthKey(c.dateReceived));
      if (idx !== undefined) months[idx].received++;
    }
    if (c.disposedAt && c.disposedAt >= sixMonthsAgo) {
      const idx = monthIndex.get(monthKey(c.disposedAt));
      if (idx !== undefined) months[idx].disposed++;
    }
  }

  const disposedWithDates = await prisma.case.findMany({
    where: { AND: [baseWhere, { disposedAt: { not: null } }] },
    select: { dateReceived: true, disposedAt: true },
  });
  const avgDisposalDays = disposedWithDates.length
    ? Math.round(
        (disposedWithDates.reduce(
          (sum, c) => sum + ((c.disposedAt as Date).getTime() - c.dateReceived.getTime()) / 86_400_000,
          0,
        ) /
          disposedWithDates.length) *
          10,
      ) / 10
    : 0;

  return {
    generatedAt: now.toISOString(),
    filters: {
      bureauId: filters.bureauId ?? null,
      regionId: filters.regionId ?? null,
      categoryId: filters.categoryId ?? null,
      dateFrom: filters.dateFrom?.toISOString() ?? null,
      dateTo: filters.dateTo?.toISOString() ?? null,
    },
    metrics: {
      totalCases,
      pendingCases,
      activeCases,
      underReview: counts.UNDER_REVIEW ?? 0,
      underProcess: counts.UNDER_PROCESS ?? 0,
      received: counts.RECEIVED ?? 0,
      transferred: counts.TRANSFERRED ?? 0,
      escalated: counts.ESCALATED ?? 0,
      disposed: disposedCases,
      reopened: counts.REOPENED ?? 0,
      overdue,
      approachingDeadline: approaching,
      activeAlerts,
      duplicateAlerts,
      alertsRequiringReview: reviewAlerts,
      pendingIdentityResolutions: identityStats.pending,
      disposalRate: totalCases ? Math.round((disposedCases / totalCases) * 1000) / 10 : 0,
      avgDisposalDays,
    },
    quickStats: {
      total: totalCases,
      pending: pendingCases,
      active: activeCases,
      disposed: disposedCases,
      overdue,
      approaching,
    },
    statusDistribution: Object.entries(counts).map(([status, count]) => ({ status, count })),
    categoryDistribution: categoryGroups.map((g) => ({
      id: g.categoryId,
      name: categoryById.get(g.categoryId)?.name ?? 'Unknown',
      count: g._count._all,
    })),
    bureauWorkload: bureauGroups
      .map((g) => ({
        id: g.currentBureauId,
        name: g.currentBureauId ? bureauById.get(g.currentBureauId)?.name ?? 'Unassigned' : 'Unassigned',
        code: g.currentBureauId ? bureauById.get(g.currentBureauId)?.code ?? '—' : '—',
        activeCases: g._count._all,
      }))
      .sort((a, b) => b.activeCases - a.activeCases),
    regionWorkload: [...regionMap.values()].sort((a, b) => b.activeCases - a.activeCases),
    topInstitutions: institutionGroups.map((g) => ({
      id: g.institutionId,
      name: instById.get(g.institutionId!)?.name ?? 'Unknown',
      aictePermanentId: instById.get(g.institutionId!)?.aictePermanentId ?? '—',
      count: g._count._all,
    })),
    ageing: Object.entries(ageing).map(([bucket, count]) => ({ bucket, count })),
    trends: months,
    urgentCases,
    recentAlerts,
  };
}

export function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
