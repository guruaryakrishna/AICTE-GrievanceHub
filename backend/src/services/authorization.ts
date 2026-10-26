import { Prisma } from '@prisma/client';
import { AuthUser } from '../types';
import { Forbidden } from '../utils/errors';

/**
 * Central authorization policy.
 *
 * All scope predicates fail closed: a Bureau officer without a Bureau ID or a
 * Regional officer without a Region ID never receives global access merely
 * because a comparison could evaluate to `null === null`.
 */

export const NO_ACCESS_ID = '__no_access__';

export function isGlobalReader(user: AuthUser): boolean {
  return ['ADMIN', 'SENIOR_MANAGEMENT', 'READ_ONLY'].includes(user.role);
}

export function isReadOnly(user: AuthUser): boolean {
  return user.role === 'READ_ONLY' || user.role === 'SENIOR_MANAGEMENT';
}

export function assertBureauScope(user: AuthUser): string {
  if (user.role !== 'BUREAU_OFFICER') return user.bureauId ?? '';
  if (!user.bureauId) {
    throw Forbidden('Your Bureau/Cell scope is not configured. Contact an administrator.');
  }
  return user.bureauId;
}

export function assertRegionScope(user: AuthUser): string {
  if (user.role !== 'REGIONAL_OFFICER') return user.regionId ?? '';
  if (!user.regionId) {
    throw Forbidden('Your Region scope is not configured. Contact an administrator.');
  }
  return user.regionId;
}

export function caseScopeWhere(user: AuthUser): Prisma.CaseWhereInput {
  if (isGlobalReader(user)) return {};

  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) return { id: NO_ACCESS_ID };
    return {
      OR: [
        { currentBureauId: user.bureauId },
        { createdById: user.id },
        // Coordination access: a case linked through an alert to a case owned
        // by this officer's Bureau is visible for cross-Bureau review.
        {
          alerts: {
            some: {
              alert: {
                cases: {
                  some: { case: { currentBureauId: user.bureauId } },
                },
              },
            },
          },
        },
      ],
    };
  }

  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId) return { id: NO_ACCESS_ID };
    return {
      OR: [
        { institution: { regionId: user.regionId } },
        { createdById: user.id },
      ],
    };
  }

  return { id: NO_ACCESS_ID };
}

export interface AccessibleCase {
  currentBureauId: string | null;
  createdById: string;
  institution?: { regionId: string | null } | null;
}

export function canAccessCase(user: AuthUser, c: AccessibleCase): boolean {
  switch (user.role) {
    case 'ADMIN':
    case 'SENIOR_MANAGEMENT':
    case 'READ_ONLY':
      return true;
    case 'BUREAU_OFFICER':
      if (!user.bureauId) return false;
      return c.currentBureauId === user.bureauId || c.createdById === user.id;
    case 'REGIONAL_OFFICER':
      if (!user.regionId) return false;
      return c.institution?.regionId === user.regionId || c.createdById === user.id;
    default:
      return false;
  }
}

export function canModifyCase(user: AuthUser, c: AccessibleCase): boolean {
  if (isReadOnly(user)) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'BUREAU_OFFICER') {
    return Boolean(user.bureauId && c.currentBureauId === user.bureauId);
  }
  if (user.role === 'REGIONAL_OFFICER') {
    return Boolean(user.regionId && c.institution?.regionId === user.regionId);
  }
  return false;
}

export function alertScopeWhere(user: AuthUser): Prisma.OverlapAlertWhereInput {
  if (isGlobalReader(user)) return {};

  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) return { id: NO_ACCESS_ID };
    return {
      cases: { some: { case: { currentBureauId: user.bureauId } } },
    };
  }

  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId) return { id: NO_ACCESS_ID };
    return { institution: { regionId: user.regionId } };
  }

  return { id: NO_ACCESS_ID };
}

export function institutionScopeWhere(user: AuthUser): Prisma.InstitutionWhereInput {
  if (isGlobalReader(user)) return {};

  if (user.role === 'BUREAU_OFFICER') {
    if (!user.bureauId) return { id: NO_ACCESS_ID };
    return {
      OR: [
        { cases: { some: { currentBureauId: user.bureauId } } },
        {
          cases: {
            some: {
              alerts: {
                some: {
                  alert: {
                    cases: { some: { case: { currentBureauId: user.bureauId } } },
                  },
                },
              },
            },
          },
        },
      ],
    };
  }

  if (user.role === 'REGIONAL_OFFICER') {
    if (!user.regionId) return { id: NO_ACCESS_ID };
    return { regionId: user.regionId };
  }

  return { id: NO_ACCESS_ID };
}

export function canAccessInstitution(
  user: AuthUser,
  institution: { regionId: string | null; cases: { currentBureauId: string | null }[] },
): boolean {
  if (isGlobalReader(user)) return true;
  if (user.role === 'REGIONAL_OFFICER') {
    return Boolean(user.regionId && institution.regionId === user.regionId);
  }
  if (user.role === 'BUREAU_OFFICER') {
    return Boolean(user.bureauId && institution.cases.some((c) => c.currentBureauId === user.bureauId));
  }
  return false;
}

export function canReviewAlerts(user: AuthUser): boolean {
  return !isReadOnly(user);
}
