import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { BadRequest, Conflict, Forbidden, NotFound } from '../utils/errors';
import { normalizeInstitutionName } from '../utils/normalize';
import { AuthUser, ACTIVE_CASE_STATUSES, OPEN_CASE_STATUSES } from '../types';
import { writeAudit, writeCaseAction } from './auditService';
import { findInstitutionCandidates } from './matching/institutionMatcher';
import { emitDataChanged } from '../realtime';
import { activeSlaRules, decorateWithSla } from './slaRules';
import {
  alertScopeWhere,
  caseScopeWhere,
  institutionScopeWhere,
  isGlobalReader,
} from './authorization';
import { evaluateInstitutionOverlaps } from './matching/overlapDetection';

export interface InstitutionInput {
  aictePermanentId: string;
  name: string;
  alternateNames?: string[];
  institutionType?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  regionId?: string | null;
  pinCode?: string | null;
  contactDetails?: Record<string, unknown> | null;
  isActive?: boolean;
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function canManageInstitutions(user: AuthUser): boolean {
  return user.role === 'ADMIN' || user.role === 'REGIONAL_OFFICER';
}

async function assertRegionAccess(user: AuthUser, regionId: string | null | undefined) {
  if (!regionId) return null;
  const region = await prisma.region.findUnique({ where: { id: regionId } });
  if (!region || !region.isActive) throw BadRequest('Invalid or inactive Region');
  if (user.role === 'REGIONAL_OFFICER' && region.id !== user.regionId) {
    throw Forbidden('Regional officers can only manage institutions in their assigned region');
  }
  return region;
}

function uniqueNormalizedAliases(values: (string | null | undefined)[]) {
  const seen = new Map<string, string>();
  for (const raw of values) {
    const alias = raw?.trim();
    if (!alias) continue;
    const normalizedAlias = normalizeInstitutionName(alias);
    if (!normalizedAlias || seen.has(normalizedAlias)) continue;
    seen.set(normalizedAlias, alias);
  }
  return [...seen.entries()].map(([normalizedAlias, alias]) => ({ alias, normalizedAlias }));
}

export async function listInstitutions(
  user: AuthUser,
  filters: {
    q?: string;
    regionId?: string;
    state?: string;
    isActive?: boolean;
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  },
) {
  const where: Prisma.InstitutionWhereInput = {
    AND: [
      institutionScopeWhere(user),
      filters.q
        ? {
            OR: [
              { name: { contains: filters.q } },
              { aictePermanentId: { contains: filters.q } },
              { normalizedName: { contains: filters.q.toLowerCase() } },
              { alternateNames: { contains: filters.q } },
              { aliases: { some: { normalizedAlias: { contains: filters.q.toLowerCase() } } } },
              { city: { contains: filters.q } },
              { district: { contains: filters.q } },
              { state: { contains: filters.q } },
              { pinCode: { contains: filters.q } },
            ],
          }
        : {},
      filters.regionId ? { regionId: filters.regionId } : {},
      filters.state ? { state: filters.state } : {},
      filters.isActive !== undefined ? { isActive: filters.isActive } : {},
    ],
  };

  const orderBy: Prisma.InstitutionOrderByWithRelationInput =
    filters.sortBy === 'aictePermanentId'
      ? { aictePermanentId: filters.sortOrder }
      : filters.sortBy === 'createdAt'
        ? { createdAt: filters.sortOrder }
        : { name: filters.sortOrder };

  const [total, items] = await Promise.all([
    prisma.institution.count({ where }),
    prisma.institution.findMany({
      where,
      include: {
        region: true,
        aliases: true,
        _count: { select: { cases: true, alerts: true } },
      },
      orderBy,
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return {
    items: items.map((institution) => ({
      ...institution,
      alternateNamesList: parseJson(institution.alternateNames) as string[] | null,
    })),
    total,
  };
}

export async function getInstitutionDetail(user: AuthUser, id: string) {
  const institution = await prisma.institution.findUnique({
    where: { id },
    include: { region: true, aliases: true },
  });
  if (!institution) throw NotFound('Institution not found');

  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId || institution.regionId !== user.regionId) {
      throw Forbidden('This institution is outside your assigned region');
    }
  } else if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) throw Forbidden('Your Bureau/Cell scope is not configured');
    const visible = await prisma.case.count({
      where: { AND: [{ institutionId: id }, caseScopeWhere(user)] },
    });
    if (!visible) throw Forbidden('No case for this institution is visible to your Bureau/Cell');
  }

  const caseWhere: Prisma.CaseWhereInput = { AND: [{ institutionId: id }, caseScopeWhere(user)] };
  const [cases, alerts, rules] = await Promise.all([
    prisma.case.findMany({
      where: caseWhere,
      include: {
        category: true,
        currentBureau: true,
        assignedOfficer: { select: { id: true, firstName: true, lastName: true } },
        actionHistory: {
          include: { performedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { timestamp: 'desc' },
          take: 5,
        },
      },
      orderBy: { dateReceived: 'desc' },
    }),
    prisma.overlapAlert.findMany({
      where: { AND: [{ institutionId: id }, alertScopeWhere(user)] },
      include: {
        cases: {
          include: {
            case: {
              select: {
                id: true,
                caseNumber: true,
                title: true,
                status: true,
                currentBureau: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
        reviews: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
      orderBy: { firstDetectedAt: 'desc' },
    }),
    activeSlaRules(),
  ]);

  const now = new Date();
  const decoratedCases = cases.map((c) => decorateWithSla(c, rules, now));
  const casesByBureauMap = new Map<string, { bureau: string; code: string; count: number }>();
  for (const c of decoratedCases) {
    const key = c.currentBureauId ?? 'unassigned';
    const existing = casesByBureauMap.get(key);
    if (existing) existing.count++;
    else {
      casesByBureauMap.set(key, {
        bureau: c.currentBureau?.name ?? 'Unassigned',
        code: c.currentBureau?.code ?? '—',
        count: 1,
      });
    }
  }

  return {
    ...institution,
    alternateNamesList: parseJson(institution.alternateNames) as string[] | null,
    cases: decoratedCases,
    alerts,
    metrics: {
      totalCases: decoratedCases.length,
      pendingCases: decoratedCases.filter((c) => (OPEN_CASE_STATUSES as readonly string[]).includes(c.status)).length,
      activeCases: decoratedCases.filter((c) => (ACTIVE_CASE_STATUSES as readonly string[]).includes(c.status)).length,
      disposedCases: decoratedCases.filter((c) => c.status === 'DISPOSED').length,
      overdueCases: decoratedCases.filter((c) => c.sla.isOverdue).length,
      approachingCases: decoratedCases.filter((c) => c.sla.isApproaching).length,
      casesByBureau: [...casesByBureauMap.values()],
    },
  };
}

export async function createInstitution(
  user: AuthUser,
  input: InstitutionInput,
  options?: { confirmPotentialDuplicate?: boolean; duplicateJustification?: string | null },
) {
  if (!canManageInstitutions(user)) {
    throw Forbidden('Only administrators and regional officers can create institution records');
  }
  const regionId = user.role === 'REGIONAL_OFFICER' ? user.regionId : input.regionId ?? null;
  if (user.role === 'REGIONAL_OFFICER' && !regionId) {
    throw Forbidden('Your Region scope is not configured');
  }
  await assertRegionAccess(user, regionId);

  const permanentId = input.aictePermanentId.trim();
  const existing = await prisma.institution.findUnique({ where: { aictePermanentId: permanentId } });
  if (existing) {
    throw Conflict('An institution with this AICTE Permanent ID already exists', {
      institutionId: existing.id,
      name: existing.name,
    });
  }

  const candidates = await findInstitutionCandidates({
    name: input.name,
    aictePermanentId: permanentId,
    pinCode: input.pinCode,
    district: input.district,
    state: input.state,
  });

  if (candidates.length > 0 && !options?.confirmPotentialDuplicate) {
    throw Conflict(
      'Potential duplicate institution records were found. Review the candidates before creating a new record.',
      {
        candidates: candidates.map((c) => ({
          id: c.institution.id,
          name: c.institution.name,
          aictePermanentId: c.institution.aictePermanentId,
          score: c.score,
          evidence: c.evidence,
          reasoning: c.reasoning,
        })),
      },
    );
  }
  if (candidates.length > 0 && options?.confirmPotentialDuplicate && !options.duplicateJustification?.trim()) {
    throw BadRequest('A justification is required when creating a record despite duplicate candidates');
  }

  const aliases = uniqueNormalizedAliases(input.alternateNames ?? []);
  const institution = await prisma.institution.create({
    data: {
      aictePermanentId: permanentId,
      name: input.name.trim(),
      normalizedName: normalizeInstitutionName(input.name),
      alternateNames: input.alternateNames?.length ? JSON.stringify(input.alternateNames) : null,
      institutionType: input.institutionType ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      district: input.district ?? null,
      state: input.state ?? null,
      regionId,
      pinCode: input.pinCode || null,
      contactDetails: input.contactDetails ? JSON.stringify(input.contactDetails) : null,
      isActive: input.isActive ?? true,
      aliases: aliases.length ? { create: aliases } : undefined,
    },
    include: { region: true, aliases: true },
  });

  await writeAudit(user, 'INSTITUTION_CREATED', 'Institution', institution.id, {
    aictePermanentId: institution.aictePermanentId,
    duplicateCandidatesReviewed: candidates.length,
    duplicateJustification: options?.duplicateJustification ?? null,
  });
  emitDataChanged('institutions', 'created', institution.id);
  return institution;
}

export async function updateInstitution(user: AuthUser, id: string, input: Partial<InstitutionInput>) {
  if (!canManageInstitutions(user)) {
    throw Forbidden('Only administrators and regional officers can update institution records');
  }
  const existing = await prisma.institution.findUnique({ where: { id }, include: { aliases: true } });
  if (!existing) throw NotFound('Institution not found');
  if (user.role === 'REGIONAL_OFFICER' && existing.regionId !== user.regionId) {
    throw Forbidden('This institution is outside your assigned region');
  }
  if (input.aictePermanentId && input.aictePermanentId.trim() !== existing.aictePermanentId) {
    const duplicate = await prisma.institution.findUnique({
      where: { aictePermanentId: input.aictePermanentId.trim() },
    });
    if (duplicate) throw Conflict('AICTE Permanent ID is already in use by another institution');
  }
  if (input.regionId !== undefined) {
    if (user.role === 'REGIONAL_OFFICER' && input.regionId !== user.regionId) {
      throw Forbidden('Regional officers cannot move institutions outside their region');
    }
    await assertRegionAccess(user, input.regionId);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.institution.update({
      where: { id },
      data: {
        ...(input.aictePermanentId ? { aictePermanentId: input.aictePermanentId.trim() } : {}),
        ...(input.name ? { name: input.name.trim(), normalizedName: normalizeInstitutionName(input.name) } : {}),
        ...(input.alternateNames !== undefined
          ? {
              alternateNames:
                input.alternateNames && input.alternateNames.length
                  ? JSON.stringify(input.alternateNames)
                  : null,
            }
          : {}),
        ...(input.institutionType !== undefined ? { institutionType: input.institutionType } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.district !== undefined ? { district: input.district } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.regionId !== undefined ? { regionId: input.regionId } : {}),
        ...(input.pinCode !== undefined ? { pinCode: input.pinCode || null } : {}),
        ...(input.contactDetails !== undefined
          ? { contactDetails: input.contactDetails ? JSON.stringify(input.contactDetails) : null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { region: true, aliases: true },
    });

    if (input.alternateNames !== undefined) {
      const existingAliases = new Set(result.aliases.map((a) => a.normalizedAlias));
      const missing = uniqueNormalizedAliases(input.alternateNames).filter(
        (a) => !existingAliases.has(a.normalizedAlias),
      );
      if (missing.length) {
        await tx.institutionAlias.createMany({
          data: missing.map((a) => ({ ...a, institutionId: id })),
        });
      }
    }
    return tx.institution.findUniqueOrThrow({
      where: { id },
      include: { region: true, aliases: true },
    });
  });

  await writeAudit(user, 'INSTITUTION_UPDATED', 'Institution', id, {
    fields: Object.keys(input),
  });
  emitDataChanged('institutions', 'updated', id);
  return updated;
}

export async function addInstitutionAlias(user: AuthUser, institutionId: string, alias: string) {
  if (!canManageInstitutions(user)) throw Forbidden('Not permitted');
  const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
  if (!institution) throw NotFound('Institution not found');
  if (user.role === 'REGIONAL_OFFICER' && institution.regionId !== user.regionId) {
    throw Forbidden('This institution is outside your assigned region');
  }
  const normalizedAlias = normalizeInstitutionName(alias);
  if (!normalizedAlias) throw BadRequest('Alias must contain identifiable text');

  const existing = await prisma.institutionAlias.findFirst({ where: { normalizedAlias } });
  if (existing) {
    if (existing.institutionId === institutionId) return existing;
    throw Conflict('This alias already identifies another institution. Merge or review the records instead.');
  }
  const nameHolder = await prisma.institution.findFirst({ where: { normalizedName: normalizedAlias } });
  if (nameHolder && nameHolder.id !== institutionId) {
    throw Conflict('This alias matches another institution name. Review the records before adding it.');
  }

  const created = await prisma.institutionAlias.create({
    data: { institutionId, alias: alias.trim(), normalizedAlias },
  });
  await writeAudit(user, 'INSTITUTION_ALIAS_ADDED', 'Institution', institutionId, { alias });
  emitDataChanged('institutions', 'alias_added', institutionId);
  return created;
}

/** Merge a duplicate institution into a canonical record, preserving all case history. */
export async function mergeInstitutions(
  user: AuthUser,
  sourceId: string,
  input: { targetInstitutionId: string; reason: string },
) {
  if (user.role !== 'ADMIN') throw Forbidden('Only administrators can merge institution records');
  if (sourceId === input.targetInstitutionId) {
    throw BadRequest('Source and target institutions must differ');
  }
  const [source, target] = await Promise.all([
    prisma.institution.findUnique({
      where: { id: sourceId },
      include: { cases: true, aliases: true },
    }),
    prisma.institution.findUnique({ where: { id: input.targetInstitutionId }, include: { aliases: true } }),
  ]);
  if (!source || !target) throw NotFound('Institution not found');
  if (!target.isActive) throw BadRequest('The target institution is inactive');
  if (!input.reason?.trim()) throw BadRequest('A merge reason is required');

  await prisma.$transaction(async (tx) => {
    await tx.case.updateMany({ where: { institutionId: sourceId }, data: { institutionId: target.id } });
    await tx.overlapAlert.updateMany({ where: { institutionId: sourceId }, data: { institutionId: target.id } });
    await tx.institutionResolution.updateMany({
      where: { resolvedInstitutionId: sourceId },
      data: { resolvedInstitutionId: target.id },
    });

    const targetAliases = new Set(target.aliases.map((a) => a.normalizedAlias));
    const aliasCandidates = uniqueNormalizedAliases([
      source.name,
      ...source.aliases.map((a) => a.alias),
      ...source.cases.map((c) => c.originalInstitutionName),
    ]).filter((a) => !targetAliases.has(a.normalizedAlias));
    if (aliasCandidates.length) {
      await tx.institutionAlias.createMany({
        data: aliasCandidates.map((a) => ({ ...a, institutionId: target.id })),
      });
    }
    await tx.institution.update({
      where: { id: sourceId },
      data: {
        isActive: false,
        alternateNames: JSON.stringify([
          ...new Set([
            ...(parseJson(source.alternateNames) as string[] | null) ?? [],
            source.name,
          ]),
        ]),
      },
    });
  });

  await writeAudit(user, 'INSTITUTIONS_MERGED', 'Institution', sourceId, {
    targetInstitutionId: target.id,
    reason: input.reason,
  });
  await evaluateInstitutionOverlaps(target.id, user.id);
  emitDataChanged('institutions', 'merged', sourceId);
  return { mergedInto: target.id };
}

export interface IdentityResolutionFilters {
  status?: string[];
  q?: string;
  page: number;
  pageSize: number;
}

function identityResolutionScope(user: AuthUser): Prisma.InstitutionResolutionWhereInput {
  if (isGlobalReader(user)) return {};
  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) return { id: '__no_access__' };
    return {
      OR: [
        { case: { currentBureauId: user.bureauId } },
        { case: { createdById: user.id } },
      ],
    };
  }
  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId) return { id: '__no_access__' };
    return {
      OR: [
        { case: { institution: { regionId: user.regionId } } },
        { case: { createdById: user.id } },
        {
          status: 'PENDING',
          candidateEvidence: { contains: user.regionId },
        },
      ],
    };
  }
  return { id: '__no_access__' };
}

function decorateResolution<T extends { candidateEvidence: string | null }>(resolution: T) {
  return {
    ...resolution,
    candidateEvidence: parseJson(resolution.candidateEvidence),
  };
}

export async function listIdentityResolutions(user: AuthUser, filters: IdentityResolutionFilters) {
  const statuses = filters.status?.length ? filters.status : ['PENDING'];
  const where: Prisma.InstitutionResolutionWhereInput = {
    AND: [
      identityResolutionScope(user),
      { status: { in: statuses } },
      filters.q
        ? {
            OR: [
              { submittedName: { contains: filters.q } },
              { submittedAictePermanentId: { contains: filters.q } },
              { case: { caseNumber: { contains: filters.q } } },
              { case: { title: { contains: filters.q } } },
            ],
          }
        : {},
    ],
  };
  const [total, items] = await Promise.all([
    prisma.institutionResolution.count({ where }),
    prisma.institutionResolution.findMany({
      where,
      include: {
        case: {
          select: {
            id: true,
            caseNumber: true,
            title: true,
            status: true,
            priority: true,
            currentBureau: { select: { id: true, name: true, code: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        resolvedInstitution: { select: { id: true, name: true, aictePermanentId: true } },
        resolvedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return { items: items.map(decorateResolution), total };
}

export async function resolveInstitutionIdentity(
  user: AuthUser,
  resolutionId: string,
  input: { institutionId?: string | null; dismiss?: boolean; note?: string | null },
) {
  if (user.role !== 'ADMIN' && user.role !== 'REGIONAL_OFFICER') {
    throw Forbidden('Institution identity can only be resolved by an administrator or regional officer');
  }
  const resolution = await prisma.institutionResolution.findUnique({
    where: { id: resolutionId },
    include: { case: true },
  });
  if (!resolution) throw NotFound('Identity resolution request not found');
  if (resolution.status !== 'PENDING') {
    throw Conflict(`This identity request is already ${resolution.status.toLowerCase()}`);
  }
  if (!input.dismiss && !input.institutionId) {
    throw BadRequest('Select the verified institution or explicitly dismiss the request');
  }
  if (input.dismiss && !input.note?.trim()) {
    throw BadRequest('A note is required when dismissing an identity request');
  }

  if (input.dismiss) {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.institutionResolution.update({
        where: { id: resolutionId },
        data: {
          status: 'DISMISSED',
          resolutionNote: input.note?.trim() ?? null,
          resolvedById: user.id,
          resolvedAt: new Date(),
        },
      });
      await writeCaseAction(tx, {
        caseId: resolution.caseId,
        actionType: 'IDENTITY_DISMISSED',
        performedById: user.id,
        bureauId: resolution.case.currentBureauId,
        remarks: input.note?.trim() ?? null,
        metadata: { resolutionId },
      });
      return result;
    });
    await writeAudit(user, 'IDENTITY_RESOLUTION_DISMISSED', 'InstitutionResolution', resolutionId, {
      caseId: resolution.caseId,
      note: input.note,
    });
    emitDataChanged('identityResolutions', 'dismissed', resolutionId);
    return decorateResolution(updated as typeof updated & { candidateEvidence: string | null });
  }

  const institution = await prisma.institution.findUnique({ where: { id: input.institutionId! } });
  if (!institution) throw NotFound('Institution not found');
  if (!institution.isActive) throw BadRequest('The selected institution is inactive');
  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId || institution.regionId !== user.regionId) {
      throw Forbidden('The selected institution is outside your assigned region');
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.institutionResolution.update({
      where: { id: resolutionId },
      data: {
        status: 'RESOLVED',
        resolvedInstitutionId: institution.id,
        resolvedById: user.id,
        resolvedAt: new Date(),
        resolutionNote: input.note?.trim() ?? null,
      },
    });
    await tx.case.update({
      where: { id: resolution.caseId },
      data: {
        institutionId: institution.id,
        originalInstitutionName:
          resolution.case.originalInstitutionName ?? resolution.submittedName,
      },
    });

    const normalizedAlias = normalizeInstitutionName(resolution.submittedName);
    if (normalizedAlias && normalizedAlias !== institution.normalizedName) {
      const aliasHolder = await tx.institutionAlias.findFirst({ where: { normalizedAlias } });
      if (!aliasHolder) {
        await tx.institutionAlias.create({
          data: {
            institutionId: institution.id,
            alias: resolution.submittedName,
            normalizedAlias,
          },
        });
      }
    }

    await writeCaseAction(tx, {
      caseId: resolution.caseId,
      actionType: 'IDENTITY_RESOLVED',
      performedById: user.id,
      bureauId: resolution.case.currentBureauId,
      previousValue: null,
      newValue: institution.id,
      remarks: input.note?.trim() ?? null,
      metadata: {
        resolutionId,
        submittedName: resolution.submittedName,
        submittedAictePermanentId: resolution.submittedAictePermanentId,
        institutionName: institution.name,
        aictePermanentId: institution.aictePermanentId,
      },
    });
    return result;
  });

  await writeAudit(user, 'IDENTITY_RESOLUTION_RESOLVED', 'InstitutionResolution', resolutionId, {
    caseId: resolution.caseId,
    institutionId: institution.id,
  });
  await evaluateInstitutionOverlaps(institution.id, user.id);
  emitDataChanged('identityResolutions', 'resolved', resolutionId);
  return decorateResolution(updated as typeof updated & { candidateEvidence: string | null });
}

export async function identityResolutionStats(user: AuthUser) {
  const [pending, resolved, dismissed] = await Promise.all([
    prisma.institutionResolution.count({
      where: { AND: [identityResolutionScope(user), { status: 'PENDING' }] },
    }),
    prisma.institutionResolution.count({
      where: { AND: [identityResolutionScope(user), { status: 'RESOLVED' }] },
    }),
    prisma.institutionResolution.count({
      where: { AND: [identityResolutionScope(user), { status: 'DISMISSED' }] },
    }),
  ]);
  return { pending, resolved, dismissed };
}
