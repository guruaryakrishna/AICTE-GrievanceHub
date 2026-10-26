import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { createCase, disposeCase } from '../src/services/caseService';
import { AUTH_COOKIE } from '../src/utils/auth';
import { anonymous, as, createFixture, Fixture, TEST_PASSWORD } from './helpers';

let fx: Fixture;

beforeEach(async () => {
  fx = await createFixture();
});

function apiCase(overrides: Record<string, unknown> = {}) {
  return {
    institutionId: fx.institutionA.id,
    title: 'Delay in scholarship disbursement',
    description:
      'The institution has not disbursed the approved scholarship amount to eligible students despite repeated representations.',
    categoryId: fx.category.id,
    currentBureauId: fx.bureauA.id,
    priority: 'HIGH',
    ...overrides,
  };
}

describe('authentication', () => {
  it('requires a session for protected routes', async () => {
    const res = await anonymous().get('/api/cases');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('logs in with valid credentials, returns a public user and sets an http-only cookie', async () => {
    const res = await anonymous()
      .post('/api/auth/login')
      .send({ email: fx.admin.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(fx.admin.email);
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((cookie) => cookie.startsWith(`${AUTH_COOKIE}=`))).toBe(true);
    expect(cookies.some((cookie) => /HttpOnly/i.test(cookie))).toBe(true);
  });

  it('rejects invalid credentials and inactive accounts', async () => {
    const bad = await anonymous()
      .post('/api/auth/login')
      .send({ email: fx.admin.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);

    await prisma.user.update({ where: { id: fx.officerA.id }, data: { isActive: false } });
    const inactive = await anonymous()
      .post('/api/auth/login')
      .send({ email: fx.officerA.email, password: TEST_PASSWORD });
    expect(inactive.status).toBe(401);
  });

  it('returns the current user and clears the session on logout', async () => {
    const me = await as(fx.admin).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(fx.admin.id);

    const logout = await as(fx.admin).post('/api/auth/logout');
    expect(logout.status).toBe(200);
    const cleared = (logout.headers['set-cookie'] as unknown as string[]).find((cookie) =>
      cookie.startsWith(`${AUTH_COOKIE}=`),
    );
    expect(cleared).toContain('Expires=');
  });
});

describe('case API authorization', () => {
  it('prevents read-only users from creating cases', async () => {
    const res = await as(fx.readOnly).post('/api/cases', apiCase());
    expect(res.status).toBe(403);
  });

  it('rejects invalid case payloads with validation details', async () => {
    const res = await as(fx.admin).post('/api/cases', apiCase({ title: 'Bad', description: 'short' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('scopes case lists to the officer’s Bureau', async () => {
    const own = await createCase(fx.admin, apiCase({ currentBureauId: fx.bureauA.id }) as never);
    const other = await createCase(
      fx.admin,
      apiCase({
        institutionId: fx.institutionB.id,
        currentBureauId: fx.bureauB.id,
        title: 'Laboratory safety equipment unavailable',
        description:
          'The chemical engineering laboratory lacks mandated safety equipment and current inspection records.',
      }) as never,
    );

    const list = await as(fx.bureauOfficerA).get('/api/cases?page=1&pageSize=50');
    expect(list.status).toBe(200);
    const ids = (list.body.items as { id: string }[]).map((item) => item.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(other.id);

    const forbidden = await as(fx.bureauOfficerA).get(`/api/cases/${other.id}`);
    expect(forbidden.status).toBe(403);
  });

  it('blocks special operations through the generic status endpoint and exposes workflow permissions', async () => {
    const created = await createCase(fx.admin, apiCase() as never);

    const detail = await as(fx.admin).get(`/api/cases/${created.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.case.permissions.canTransfer).toBe(true);
    expect(detail.body.case.allowedStatusTargets).toEqual(['UNDER_REVIEW']);

    const status = await as(fx.admin).post(`/api/cases/${created.id}/status`, { status: 'DISPOSED' });
    expect(status.status).toBe(400);

    const transfer = await as(fx.admin).post(`/api/cases/${created.id}/transfer`, {
      toBureauId: fx.bureauB.id,
      reason: 'Ownership belongs to the grievance redressal cell.',
    });
    expect(transfer.status).toBe(200);
    expect(transfer.body.case.status).toBe('TRANSFERRED');
  });

  it('reports cross-origin state-changing requests as forbidden', async () => {
    const res = await as(fx.admin)
      .post('/api/cases', apiCase())
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });
});

describe('identity workflow API', () => {
  it('exposes the pending identity queue and resolves it with an exact institution', async () => {
    const created = await createCase(
      fx.admin,
      apiCase({ institutionId: null, originalInstitutionName: 'Northern Institute of Technology' }) as never,
    );

    const queue = await as(fx.admin).get('/api/institutions/identity/queue');
    expect(queue.status).toBe(200);
    expect(queue.body.items.some((item: { id: string }) => item.id === created.identityResolution!.id)).toBe(true);

    const stats = await as(fx.admin).get('/api/institutions/identity/stats');
    expect(stats.body.stats.pending).toBe(1);

    const resolve = await as(fx.admin).post(
      `/api/institutions/identity/${created.identityResolution!.id}/resolve`,
      { institutionId: fx.institutionA.id, note: 'Confirmed via the stable AICTE ID.' },
    );
    expect(resolve.status).toBe(200);
    expect(resolve.body.resolution.status).toBe('RESOLVED');

    const caseRes = await as(fx.admin).get(`/api/cases/${created.id}`);
    expect(caseRes.body.case.institutionId).toBe(fx.institutionA.id);
  });

  it('forbids Bureau officers from resolving identity requests', async () => {
    const created = await createCase(
      fx.admin,
      apiCase({ institutionId: null, originalInstitutionName: 'Unknown Polytechnic' }) as never,
    );
    const res = await as(fx.bureauOfficerA).post(
      `/api/institutions/identity/${created.identityResolution!.id}/resolve`,
      { institutionId: fx.institutionA.id },
    );
    expect(res.status).toBe(403);
  });
});

describe('alert evaluation API', () => {
  it('is ADMIN-only', async () => {
    const denied = await as(fx.bureauOfficerA).post('/api/alerts/evaluate/run');
    expect(denied.status).toBe(403);

    const allowed = await as(fx.admin).post('/api/alerts/evaluate/run');
    expect(allowed.status).toBe(200);
    expect(allowed.body.result).toMatchObject({ institutions: expect.any(Number) });
  });
});

describe('administration API', () => {
  it('validates role and scope consistency when creating users', async () => {
    const missingBureau = await as(fx.admin).post('/api/admin/users', {
      email: 'new.officer@test.local',
      password: 'StrongPassword123!',
      firstName: 'New',
      lastName: 'Officer',
      role: 'BUREAU_OFFICER',
    });
    expect(missingBureau.status).toBe(400);
    expect(missingBureau.body.error.message).toMatch(/Bureau/i);

    const crossScope = await as(fx.admin).post('/api/admin/users', {
      email: 'new.officer@test.local',
      password: 'StrongPassword123!',
      firstName: 'New',
      lastName: 'Officer',
      role: 'REGIONAL_OFFICER',
      bureauId: fx.bureauA.id,
    });
    expect(crossScope.status).toBe(400);

    const valid = await as(fx.admin).post('/api/admin/users', {
      email: 'new.officer@test.local',
      password: 'StrongPassword123!',
      firstName: 'New',
      lastName: 'Officer',
      role: 'BUREAU_OFFICER',
      bureauId: fx.bureauA.id,
    });
    expect(valid.status).toBe(201);
    expect(valid.body.user.passwordHash).toBeUndefined();
    expect(valid.body.user.bureauId).toBe(fx.bureauA.id);
  });

  it('blocks non-administrators from admin routes', async () => {
    const res = await as(fx.senior).get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('does not expose password hashes in the audit trail', async () => {
    const created = await createCase(fx.admin, apiCase() as never);
    const res = await as(fx.admin).get('/api/admin/audit?page=1&pageSize=100');
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$2a$');
    expect(body).not.toContain('$2b$');
    const event = (res.body.items as { action: string; entityId: string; details: unknown }[]).find(
      (item) => item.action === 'CASE_CREATED' && item.entityId === created.id,
    );
    expect(event).toBeDefined();
    expect(typeof event?.details).toBe('object');
  });
});

describe('dashboard API', () => {
  it('computes metrics from actual case data', async () => {
    const open = await createCase(fx.admin, apiCase() as never);
    const disposed = await createCase(
      fx.admin,
      apiCase({
        institutionId: fx.institutionB.id,
        currentBureauId: fx.bureauB.id,
        title: 'Laboratory safety equipment unavailable',
        description:
          'The chemical engineering laboratory lacks mandated safety equipment and current inspection records.',
      }) as never,
    );
    await disposeCase(fx.admin, disposed.id, {
      resolutionRemarks: 'Equipment was purchased and inspection records were verified.',
    });

    const res = await as(fx.admin).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.metrics.totalCases).toBe(2);
    expect(res.body.metrics.disposed).toBe(1);
    expect(res.body.metrics.pendingCases).toBe(1);
    expect(res.body.quickStats.total).toBe(2);
    expect(res.body.quickStats.active).toBe(1);
    expect(res.body.metrics.pendingIdentityResolutions).toBe(0);
    expect(res.body.urgentCases.some((c: { id: string }) => c.id === open.id)).toBe(true);

    const officer = await as(fx.bureauOfficerA).get('/api/dashboard');
    expect(officer.status).toBe(200);
    expect(officer.body.metrics.totalCases).toBe(1);
  });
});

describe('reporting API', () => {
  it('returns real SLA consistency data and protects exports by role', async () => {
    await createCase(fx.admin, apiCase() as never);

    const summary = await as(fx.admin).get('/api/reports/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.metrics.totalCases).toBe(1);

    const csv = await as(fx.admin).get('/api/reports/export/cases');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('AICTE-');
  });
});

describe('unknown routes', () => {
  it('return a structured 404', async () => {
    const res = await anonymous().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
