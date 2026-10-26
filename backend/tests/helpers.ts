import bcrypt from 'bcryptjs';
import request from 'supertest';
import { prisma } from '../src/config/prisma';
import { app } from '../src/index';
import { signToken, AUTH_COOKIE } from '../src/utils/auth';
import { AuthUser, Role } from '../src/types';

/**
 * Remove every row before each test. The test database is an isolated SQLite
 * file created by tests/globalSetup.ts; the development database is never used.
 */
export async function resetDatabase() {
  await prisma.$transaction([
    prisma.auditEvent.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.institutionResolution.deleteMany(),
    prisma.caseActionHistory.deleteMany(),
    prisma.alertReview.deleteMany(),
    prisma.caseAlert.deleteMany(),
    prisma.overlapAlert.deleteMany(),
    prisma.case.deleteMany(),
    prisma.institutionAlias.deleteMany(),
    prisma.sLARule.deleteMany(),
    prisma.institution.deleteMany(),
    prisma.complaintCategory.deleteMany(),
    prisma.user.deleteMany(),
    prisma.bureau.deleteMany(),
    prisma.region.deleteMany(),
  ]);
}

export const TEST_PASSWORD = 'TestPassword123!';

export interface Fixture {
  north: { id: string; name: string };
  south: { id: string; name: string };
  bureauA: { id: string; name: string; code: string };
  bureauB: { id: string; name: string; code: string };
  category: { id: string; name: string; code: string };
  admin: AuthUser;
  officerA: AuthUser;
  officerB: AuthUser;
  bureauOfficerA: AuthUser;
  bureauOfficerB: AuthUser;
  regionalOfficer: AuthUser;
  senior: AuthUser;
  readOnly: AuthUser;
  institutionA: { id: string; name: string; aictePermanentId: string; regionId: string };
  institutionB: { id: string; name: string; aictePermanentId: string; regionId: string };
  slaRule: { id: string };
}

function authUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  bureauId: string | null;
  regionId: string | null;
  bureau?: { id: string; name: string; code: string } | null;
  region?: { id: string; name: string; code: string } | null;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role as Role,
    bureauId: user.bureauId,
    regionId: user.regionId,
    bureau: user.bureau ?? null,
    region: user.region ?? null,
  };
}

export async function createFixture(): Promise<Fixture> {
  await resetDatabase();
  // A cheap hash is sufficient for tests; production uses bcrypt cost 12.
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);

  const north = await prisma.region.create({
    data: { name: 'Northern Region', code: 'NR', states: 'Delhi' },
  });
  const south = await prisma.region.create({
    data: { name: 'Southern Region', code: 'SR', states: 'Tamil Nadu' },
  });
  const bureauA = await prisma.bureau.create({
    data: { name: 'Regulation Bureau', code: 'RB', type: 'REGULATION_BUREAU' },
  });
  const bureauB = await prisma.bureau.create({
    data: { name: 'Public Grievance Redressal Cell', code: 'PGRC', type: 'PUBLIC_GRIEVANCE_REDRESSAL_CELL' },
  });
  const category = await prisma.complaintCategory.create({
    data: { name: 'Academic Affairs', code: 'ACAD' },
  });

  const common = { passwordHash, isActive: true };
  const adminRow = await prisma.user.create({
    data: {
      ...common,
      email: 'admin@test.local',
      firstName: 'Ada',
      lastName: 'Admin',
      role: 'ADMIN',
    },
  });
  const officerARow = await prisma.user.create({
    data: {
      ...common,
      email: 'officer.a@test.local',
      firstName: 'Omar',
      lastName: 'Officer',
      role: 'BUREAU_OFFICER',
      bureauId: bureauA.id,
    },
    include: { bureau: true },
  });
  const officerBRow = await prisma.user.create({
    data: {
      ...common,
      email: 'officer.b@test.local',
      firstName: 'Bela',
      lastName: 'Officer',
      role: 'BUREAU_OFFICER',
      bureauId: bureauB.id,
    },
    include: { bureau: true },
  });
  const regionalRow = await prisma.user.create({
    data: {
      ...common,
      email: 'regional@test.local',
      firstName: 'Ravi',
      lastName: 'Regional',
      role: 'REGIONAL_OFFICER',
      regionId: north.id,
    },
    include: { region: true },
  });
  const seniorRow = await prisma.user.create({
    data: {
      ...common,
      email: 'senior@test.local',
      firstName: 'Sam',
      lastName: 'Senior',
      role: 'SENIOR_MANAGEMENT',
    },
  });
  const readOnlyRow = await prisma.user.create({
    data: {
      ...common,
      email: 'viewer@test.local',
      firstName: 'Vera',
      lastName: 'Viewer',
      role: 'READ_ONLY',
    },
  });

  const institutionA = await prisma.institution.create({
    data: {
      aictePermanentId: 'AICTE-INST-0001',
      name: 'Northern Institute of Technology',
      normalizedName: 'northern institute of technology',
      city: 'Delhi',
      state: 'Delhi',
      regionId: north.id,
    },
  });
  const institutionB = await prisma.institution.create({
    data: {
      aictePermanentId: 'AICTE-INST-0002',
      name: 'Southern College of Engineering',
      normalizedName: 'southern college of engineering',
      city: 'Chennai',
      state: 'Tamil Nadu',
      regionId: south.id,
    },
  });

  const slaRule = await prisma.sLARule.create({
    data: {
      name: 'Global demonstration SLA',
      slaDurationHours: 168,
      warningThresholdHours: 72,
      escalationThresholdHours: 24,
      isActive: true,
      isDemonstration: true,
    },
  });

  return {
    north,
    south,
    bureauA,
    bureauB,
    category,
    admin: authUser(adminRow),
    officerA: authUser(officerARow),
    officerB: authUser(officerBRow),
    bureauOfficerA: authUser(officerARow),
    bureauOfficerB: authUser(officerBRow),
    regionalOfficer: authUser(regionalRow),
    senior: authUser(seniorRow),
    readOnly: authUser(readOnlyRow),
    institutionA,
    institutionB,
    slaRule,
  };
}

/** Cookie-bound supertest helpers for the authenticated user. */
export function as(user: AuthUser) {
  const token = signToken({
    id: user.id,
    role: user.role,
    bureauId: user.bureauId,
    regionId: user.regionId,
  });
  const cookie = `${AUTH_COOKIE}=${token}`;
  return {
    get: (url: string) => request(app).get(url).set('Cookie', cookie),
    post: (url: string, body?: unknown) =>
      request(app).post(url).set('Cookie', cookie).send(body as object),
    patch: (url: string, body?: unknown) =>
      request(app).patch(url).set('Cookie', cookie).send(body as object),
    delete: (url: string) => request(app).delete(url).set('Cookie', cookie),
  };
}

export function anonymous() {
  return request(app);
}

export const BASE_CASE = {
  title: 'Delay in scholarship disbursement',
  description:
    'The institution has not disbursed the approved scholarship amount to eligible students despite repeated representations.',
  priority: 'HIGH',
};
