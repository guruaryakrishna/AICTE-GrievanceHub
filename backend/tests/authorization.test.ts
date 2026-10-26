import { describe, expect, it } from 'vitest';
import {
  alertScopeWhere,
  assertBureauScope,
  assertRegionScope,
  canAccessCase,
  canAccessInstitution,
  canModifyCase,
  canReviewAlerts,
  caseScopeWhere,
  institutionScopeWhere,
  isGlobalReader,
  isReadOnly,
  NO_ACCESS_ID,
} from '../src/services/authorization';
import { AuthUser, Role } from '../src/types';

function user(role: Role, overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'user@test.local',
    firstName: 'Test',
    lastName: 'User',
    role,
    bureauId: null,
    regionId: null,
    ...overrides,
  };
}

const admin = user('ADMIN');
const bureauA = user('BUREAU_OFFICER', { bureauId: 'bureau-a' });
const bureauNoScope = user('BUREAU_OFFICER');
const regional = user('REGIONAL_OFFICER', { regionId: 'region-north' });
const regionalNoScope = user('REGIONAL_OFFICER');
const readOnly = user('READ_ONLY');
const senior = user('SENIOR_MANAGEMENT');

describe('global and read-only roles', () => {
  it('treats admin, senior management and read-only as global readers', () => {
    for (const u of [admin, senior, readOnly]) {
      expect(isGlobalReader(u)).toBe(true);
      expect(caseScopeWhere(u)).toEqual({});
      expect(alertScopeWhere(u)).toEqual({});
      expect(institutionScopeWhere(u)).toEqual({});
    }
  });

  it('prevents read-only and senior management from modifying or reviewing', () => {
    expect(isReadOnly(readOnly)).toBe(true);
    expect(isReadOnly(senior)).toBe(true);
    expect(isReadOnly(admin)).toBe(false);
    expect(canReviewAlerts(readOnly)).toBe(false);
    expect(canReviewAlerts(senior)).toBe(false);
    expect(canReviewAlerts(bureauA)).toBe(true);
    const c = { currentBureauId: 'bureau-a', createdById: 'user-1', institution: { regionId: 'region-north' } };
    expect(canModifyCase(readOnly, c)).toBe(false);
    expect(canModifyCase(senior, c)).toBe(false);
    expect(canModifyCase(admin, c)).toBe(true);
  });
});

describe('Bureau scope fails closed', () => {
  it('returns no rows when the Bureau scope is missing', () => {
    expect(caseScopeWhere(bureauNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(alertScopeWhere(bureauNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(institutionScopeWhere(bureauNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(() => assertBureauScope(bureauNoScope)).toThrow(/scope is not configured/i);
  });

  it('restricts case visibility and modification to the current Bureau or creator', () => {
    expect(caseScopeWhere(bureauA)).toMatchObject({ OR: expect.any(Array) });
    expect(
      canAccessCase(bureauA, {
        currentBureauId: 'bureau-a',
        createdById: 'another-user',
        institution: null,
      }),
    ).toBe(true);
    expect(
      canAccessCase(bureauA, {
        currentBureauId: 'bureau-b',
        createdById: bureauA.id,
        institution: null,
      }),
    ).toBe(true);
    expect(
      canAccessCase(bureauA, {
        currentBureauId: 'bureau-b',
        createdById: 'another-user',
        institution: null,
      }),
    ).toBe(false);
    expect(
      canModifyCase(bureauA, {
        currentBureauId: 'bureau-b',
        createdById: bureauA.id,
        institution: null,
      }),
    ).toBe(false);
  });

  it('grants bureau officers read access for coordination only via modifications to the scope query', () => {
    const scope = caseScopeWhere(bureauA) as { OR: unknown[] };
    expect(scope.OR).toHaveLength(3);
    expect(scope.OR[2]).toMatchObject({ alerts: { some: { alert: { cases: { some: {} } } } } });
  });
});

describe('Regional scope fails closed', () => {
  it('returns no rows when the Region scope is missing', () => {
    expect(caseScopeWhere(regionalNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(alertScopeWhere(regionalNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(institutionScopeWhere(regionalNoScope)).toEqual({ id: NO_ACCESS_ID });
    expect(() => assertRegionScope(regionalNoScope)).toThrow(/scope is not configured/i);
  });

  it('restricts cases, institutions and modification to the assigned region', () => {
    expect(
      canAccessCase(regional, {
        currentBureauId: null,
        createdById: 'another-user',
        institution: { regionId: 'region-north' },
      }),
    ).toBe(true);
    expect(
      canAccessCase(regional, {
        currentBureauId: null,
        createdById: 'another-user',
        institution: { regionId: 'region-south' },
      }),
    ).toBe(false);
    expect(
      canModifyCase(regional, {
        currentBureauId: null,
        createdById: 'another-user',
        institution: { regionId: 'region-south' },
      }),
    ).toBe(false);
    expect(
      canAccessInstitution(regional, {
        regionId: 'region-north',
        cases: [],
      }),
    ).toBe(true);
    expect(
      canAccessInstitution(regional, {
        regionId: 'region-south',
        cases: [],
      }),
    ).toBe(false);
  });
});

describe('unknown roles', () => {
  it('denies access by default', () => {
    const unknown = user('ADMIN');
    // Simulate a corrupted role value from a stale token.
    (unknown as { role: string }).role = 'SOMETHING_ELSE';
    expect(isGlobalReader(unknown)).toBe(false);
    expect(caseScopeWhere(unknown)).toEqual({ id: NO_ACCESS_ID });
    expect(canAccessCase(unknown, { currentBureauId: null, createdById: unknown.id, institution: null })).toBe(false);
    expect(canModifyCase(unknown, { currentBureauId: null, createdById: unknown.id, institution: null })).toBe(false);
  });
});
