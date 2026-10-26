/**
 * Idempotent demonstration seed.
 *
 * Running this file repeatedly must not create duplicates. Every record is
 * upserted by a stable business key, and alerts/SLA reminders are produced by
 * the real evaluators so the seeded state can be reproduced through the same
 * code paths as the application.
 *
 * ALL DATA IS SYNTHETIC AND FICTIONAL.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/config/prisma';
import { normalizeInstitutionName } from '../src/utils/normalize';
import { activeSlaRules, ruleForCase } from '../src/services/slaRules';
import { computeSlaDueDate } from '../src/domain/slaPolicy';
import { evaluateAllOverlaps } from '../src/services/matching/overlapDetection';
import { evaluateSla } from '../src/services/slaService';
import { findInstitutionCandidates } from '../src/services/matching/institutionMatcher';

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

async function ensureAlias(institutionId: string, alias: string) {
  const normalizedAlias = normalizeInstitutionName(alias);
  const existing = await prisma.institutionAlias.findFirst({ where: { normalizedAlias } });
  if (existing) {
    if (existing.institutionId !== institutionId) {
      console.warn(`Alias conflict ignored during seed: ${alias}`);
    }
    return existing;
  }
  return prisma.institutionAlias.create({
    data: { institutionId, alias: alias.trim(), normalizedAlias },
  });
}

async function ensureCreatedAction(caseId: string, performedById: string, remarks: string) {
  const existing = await prisma.caseActionHistory.findFirst({
    where: { caseId, actionType: 'CREATED' },
  });
  if (existing) return existing;
  return prisma.caseActionHistory.create({
    data: { caseId, actionType: 'CREATED', performedById, remarks, timestamp: new Date() },
  });
}

async function upsertCase(input: {
  caseNumber: string;
  institutionId: string | null;
  originalInstitutionName: string;
  title: string;
  description: string;
  categoryId: string;
  priority: string;
  status: string;
  currentBureauId: string | null;
  assignedOfficerId: string | null;
  createdById: string;
  dateReceived: Date;
  nextRequiredAction: string | null;
  nextActionDueDate: Date | null;
  slaDueDate: Date | null;
  lastAction?: string | null;
  disposedAt?: Date | null;
  resolutionRemarks?: string | null;
}) {
  const data = {
    institutionId: input.institutionId,
    originalInstitutionName: input.originalInstitutionName,
    title: input.title,
    description: input.description,
    categoryId: input.categoryId,
    priority: input.priority,
    status: input.status,
    currentBureauId: input.currentBureauId,
    assignedOfficerId: input.assignedOfficerId,
    createdById: input.createdById,
    dateReceived: input.dateReceived,
    nextRequiredAction: input.nextRequiredAction,
    nextActionDueDate: input.nextActionDueDate,
    expectedDisposalDate: input.slaDueDate,
    slaDueDate: input.slaDueDate,
    lastAction: input.lastAction ?? null,
    lastActionDate: input.lastAction ? ago(1) : null,
    disposedAt: input.disposedAt ?? null,
    resolutionRemarks: input.resolutionRemarks ?? null,
    reopenedAt: null,
    reopenReason: null,
    escalatedAt: null,
    transferredFromBureauId: null,
  };
  return prisma.case.upsert({
    where: { caseNumber: input.caseNumber },
    update: data,
    create: { caseNumber: input.caseNumber, ...data },
  });
}

async function main() {
  console.log('Seeding AICTE GrievanceHub demonstration data...');
  console.log('ALL DATA IS SYNTHETIC AND FICTIONAL - NOT REAL AICTE RECORDS\n');

  const rbBureau = await prisma.bureau.upsert({
    where: { code: 'RB' },
    update: { name: 'Regulation Bureau', type: 'REGULATION_BUREAU', isActive: true },
    create: {
      name: 'Regulation Bureau',
      code: 'RB',
      type: 'REGULATION_BUREAU',
      description: 'Handles regulation and approval related matters',
    },
  });

  const pgrcBureau = await prisma.bureau.upsert({
    where: { code: 'PGRC' },
    update: { name: 'Public Grievance Redressal Cell', type: 'PUBLIC_GRIEVANCE_REDRESSAL_CELL', isActive: true },
    create: {
      name: 'Public Grievance Redressal Cell',
      code: 'PGRC',
      type: 'PUBLIC_GRIEVANCE_REDRESSAL_CELL',
      description: 'Handles public grievances',
    },
  });

  const northRegion = await prisma.region.upsert({
    where: { code: 'NR' },
    update: { name: 'Northern Region', states: 'Delhi,Haryana,Punjab,Uttar Pradesh,Uttarakhand', isActive: true },
    create: {
      name: 'Northern Region',
      code: 'NR',
      states: 'Delhi,Haryana,Punjab,Uttar Pradesh,Uttarakhand',
    },
  });

  const southRegion = await prisma.region.upsert({
    where: { code: 'SR' },
    update: { name: 'Southern Region', states: 'Andhra Pradesh,Karnataka,Kerala,Tamil Nadu,Telangana', isActive: true },
    create: {
      name: 'Southern Region',
      code: 'SR',
      states: 'Andhra Pradesh,Karnataka,Kerala,Tamil Nadu,Telangana',
    },
  });

  const categories = [
    { name: 'Academic Compliance', code: 'ACAD' },
    { name: 'Approval or Recognition', code: 'APPROVAL' },
    { name: 'Infrastructure', code: 'INFRA' },
    { name: 'Student Grievance', code: 'STUDENT' },
    { name: 'Faculty Matters', code: 'FACULTY' },
    { name: 'Financial or Administrative Matters', code: 'FINANCE' },
    { name: 'Other Complaints', code: 'OTHER' },
  ];
  for (const cat of categories) {
    await prisma.complaintCategory.upsert({
      where: { code: cat.code },
      update: { name: cat.name, isActive: true },
      create: cat,
    });
  }
  const categoryByCode = Object.fromEntries(
    (await prisma.complaintCategory.findMany()).map((c) => [c.code, c]),
  );
  const acadCat = categoryByCode.ACAD;
  const approvalCat = categoryByCode.APPROVAL;
  const studentCat = categoryByCode.STUDENT;
  const infraCat = categoryByCode.INFRA;
  const otherCat = categoryByCode.OTHER;

  const passwordHash = await bcrypt.hash('Demo@123', 10);
  const users = [
    {
      email: 'admin@aicte-demo.gov.in',
      firstName: 'Demo',
      lastName: 'Admin',
      role: 'ADMIN',
      bureauId: null as string | null,
      regionId: null as string | null,
    },
    {
      email: 'rb.officer@aicte-demo.gov.in',
      firstName: 'Rajesh',
      lastName: 'Kumar',
      role: 'BUREAU_OFFICER',
      bureauId: rbBureau.id,
      regionId: null,
    },
    {
      email: 'pgrc.officer@aicte-demo.gov.in',
      firstName: 'Priya',
      lastName: 'Sharma',
      role: 'BUREAU_OFFICER',
      bureauId: pgrcBureau.id,
      regionId: null,
    },
    {
      email: 'regional.officer@aicte-demo.gov.in',
      firstName: 'Amit',
      lastName: 'Singh',
      role: 'REGIONAL_OFFICER',
      bureauId: null,
      regionId: northRegion.id,
    },
    {
      email: 'senior@aicte-demo.gov.in',
      firstName: 'Sunita',
      lastName: 'Verma',
      role: 'SENIOR_MANAGEMENT',
      bureauId: null,
      regionId: null,
    },
    {
      email: 'viewer@aicte-demo.gov.in',
      firstName: 'Demo',
      lastName: 'Viewer',
      role: 'READ_ONLY',
      bureauId: null,
      regionId: null,
    },
  ];
  const userByEmail: Record<string, { id: string }> = {};
  for (const user of users) {
    const row = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        bureauId: user.bureauId,
        regionId: user.regionId,
        isActive: true,
      },
      create: { ...user, passwordHash, isActive: true },
    });
    userByEmail[user.email] = row;
  }
  const admin = userByEmail['admin@aicte-demo.gov.in'];
  const rbOfficer = userByEmail['rb.officer@aicte-demo.gov.in'];
  const pgrcOfficer = userByEmail['pgrc.officer@aicte-demo.gov.in'];

  const abc = await prisma.institution.upsert({
    where: { aictePermanentId: 'DEMO-123456' },
    update: {
      name: 'ABC Engineering College',
      normalizedName: normalizeInstitutionName('ABC Engineering College'),
      alternateNames: JSON.stringify(['ABC Engineering Institute', 'ABC Tech College']),
      city: 'Gurgaon',
      district: 'Gurgaon',
      state: 'Haryana',
      regionId: northRegion.id,
      isActive: true,
    },
    create: {
      aictePermanentId: 'DEMO-123456',
      name: 'ABC Engineering College',
      normalizedName: normalizeInstitutionName('ABC Engineering College'),
      alternateNames: JSON.stringify(['ABC Engineering Institute', 'ABC Tech College']),
      institutionType: 'Engineering',
      address: '123 Tech Park Road',
      city: 'Gurgaon',
      district: 'Gurgaon',
      state: 'Haryana',
      regionId: northRegion.id,
      pinCode: '122001',
      isActive: true,
    },
  });
  await ensureAlias(abc.id, 'ABC Engineering Institute');
  await ensureAlias(abc.id, 'ABC Tech College');

  await prisma.institution.upsert({
    where: { aictePermanentId: 'DEMO-789012' },
    update: {
      name: 'XYZ Institute of Technology',
      normalizedName: normalizeInstitutionName('XYZ Institute of Technology'),
      city: 'Bangalore',
      district: 'Bangalore',
      state: 'Karnataka',
      regionId: southRegion.id,
      isActive: true,
    },
    create: {
      aictePermanentId: 'DEMO-789012',
      name: 'XYZ Institute of Technology',
      normalizedName: normalizeInstitutionName('XYZ Institute of Technology'),
      institutionType: 'Engineering',
      city: 'Bangalore',
      district: 'Bangalore',
      state: 'Karnataka',
      regionId: southRegion.id,
      pinCode: '560001',
      isActive: true,
    },
  });

  // One SLA policy family: a specific academic rule plus an explicit global
  // fallback. All due dates and warning windows come from these records.
  const ruleSeeds = [
    {
      name: 'Demo - Academic Compliance SLA',
      categoryId: acadCat.id,
      bureauId: null as string | null,
      priority: null as string | null,
      slaDurationHours: 72,
      warningThresholdHours: 24,
      escalationThresholdHours: 12,
    },
    {
      name: 'Demo - Standard Complaint SLA (global fallback)',
      categoryId: null,
      bureauId: null,
      priority: null,
      slaDurationHours: 7 * 24,
      warningThresholdHours: 72,
      escalationThresholdHours: 24,
    },
  ];
  for (const seed of ruleSeeds) {
    const existing = await prisma.sLARule.findFirst({ where: { name: seed.name } });
    if (existing) {
      await prisma.sLARule.update({
        where: { id: existing.id },
        data: { ...seed, isActive: true, isDemonstration: true },
      });
    } else {
      await prisma.sLARule.create({ data: { ...seed, isActive: true, isDemonstration: true } });
    }
  }

  const rules = await activeSlaRules();
  const dueFor = (
    dateReceived: Date,
    context: { categoryId: string; currentBureauId: string | null; priority: string },
  ) => {
    const rule = ruleForCase({ ...context, status: 'RECEIVED' }, rules);
    return computeSlaDueDate(dateReceived, rule);
  };

  const case1Received = ago(5);
  const case1 = await upsertCase({
    caseNumber: 'DEMO-COMP-2024-045',
    institutionId: abc.id,
    originalInstitutionName: 'ABC Engineering College',
    title: 'Grievance regarding faculty shortage',
    description:
      'Students have raised concerns about inadequate number of faculty members in certain departments affecting academic quality and course completion.',
    categoryId: studentCat.id,
    priority: 'HIGH',
    status: 'UNDER_PROCESS',
    currentBureauId: pgrcBureau.id,
    assignedOfficerId: pgrcOfficer.id,
    createdById: admin.id,
    dateReceived: case1Received,
    nextRequiredAction: 'Submit inspection report',
    nextActionDueDate: ahead(2),
    slaDueDate: dueFor(case1Received, {
      categoryId: studentCat.id,
      currentBureauId: pgrcBureau.id,
      priority: 'HIGH',
    }),
    lastAction: 'Site inspection scheduled',
  });

  const case2Received = ago(10);
  const case2 = await upsertCase({
    caseNumber: 'DEMO-COMP-2024-052',
    institutionId: abc.id,
    originalInstitutionName: 'ABC Engineering College',
    title: 'Compliance issues related to AICTE approval norms',
    description:
      'Allegations of not adhering to approved intake and faculty-student ratio as per AICTE norms. Requires regulatory review.',
    categoryId: approvalCat.id,
    priority: 'URGENT',
    status: 'UNDER_REVIEW',
    currentBureauId: rbBureau.id,
    assignedOfficerId: rbOfficer.id,
    createdById: admin.id,
    dateReceived: case2Received,
    nextRequiredAction: 'Review submitted documents',
    nextActionDueDate: ahead(3),
    slaDueDate: dueFor(case2Received, {
      categoryId: approvalCat.id,
      currentBureauId: rbBureau.id,
      priority: 'URGENT',
    }),
    lastAction: 'Documents requested from institution',
  });

  const case3Received = ago(3);
  const case3 = await upsertCase({
    caseNumber: 'DEMO-COMP-2024-058',
    institutionId: abc.id,
    originalInstitutionName: 'ABC Engineering College',
    title: 'Concerns regarding teaching staff adequacy',
    description:
      'Students complaint about shortage of qualified faculty members affecting course delivery and practical sessions.',
    categoryId: studentCat.id,
    priority: 'MEDIUM',
    status: 'RECEIVED',
    currentBureauId: pgrcBureau.id,
    assignedOfficerId: pgrcOfficer.id,
    createdById: admin.id,
    dateReceived: case3Received,
    nextRequiredAction: 'Initial review',
    nextActionDueDate: ahead(4),
    slaDueDate: dueFor(case3Received, {
      categoryId: studentCat.id,
      currentBureauId: pgrcBureau.id,
      priority: 'MEDIUM',
    }),
    lastAction: 'Complaint registered',
  });

  const disposedReceived = ago(30);
  const disposedAt = ago(25);
  await upsertCase({
    caseNumber: 'DEMO-COMP-2024-061',
    institutionId: null,
    originalInstitutionName: 'Greenfield Polytechnic (unverified name)',
    title: 'Infrastructure related query',
    description:
      'General query about infrastructure requirements for new course approval, received from an institution name that is not present in the master data.',
    categoryId: infraCat.id,
    priority: 'LOW',
    status: 'DISPOSED',
    currentBureauId: pgrcBureau.id,
    assignedOfficerId: pgrcOfficer.id,
    createdById: admin.id,
    dateReceived: disposedReceived,
    nextRequiredAction: null,
    nextActionDueDate: null,
    slaDueDate: dueFor(disposedReceived, {
      categoryId: infraCat.id,
      currentBureauId: pgrcBureau.id,
      priority: 'LOW',
    }),
    disposedAt,
    resolutionRemarks: 'Query addressed with appropriate guidance. Matter closed.',
    lastAction: 'Case disposed',
  });

  // Unresolved intake identity: a name that resembles a known alias must still
  // be reviewed by a human. The case is deliberately not linked automatically.
  const identityReceived = ago(1);
  const pendingCandidates = await findInstitutionCandidates({
    name: 'ABC Engineering Institute',
  });
  const identityCase = await upsertCase({
    caseNumber: 'DEMO-COMP-2024-066',
    institutionId: null,
    originalInstitutionName: 'ABC Engineering Institute',
    title: 'Fee refund delay reported under an unverified institution name',
    description:
      'A complainant reports a delay in fee refunds. The institution name is an alias-like variant and must be linked to a verified AICTE Permanent ID before institution metrics are trusted.',
    categoryId: otherCat.id,
    priority: 'MEDIUM',
    status: 'RECEIVED',
    currentBureauId: pgrcBureau.id,
    assignedOfficerId: pgrcOfficer.id,
    createdById: admin.id,
    dateReceived: identityReceived,
    nextRequiredAction: 'Verify institution identity',
    nextActionDueDate: ahead(5),
    slaDueDate: dueFor(identityReceived, {
      categoryId: otherCat.id,
      currentBureauId: pgrcBureau.id,
      priority: 'MEDIUM',
    }),
    lastAction: 'Complaint registered with unverified institution name',
  });

  await prisma.institutionResolution.upsert({
    where: { caseId: identityCase.id },
    update: {
      submittedName: 'ABC Engineering Institute',
      submittedAictePermanentId: null,
      status: 'PENDING',
      candidateEvidence: JSON.stringify({
        policy:
          'Names and aliases never auto-link. An authorized officer must review the candidates and confirm the stable AICTE Permanent ID.',
        intakeNote: 'Submitted name resembles a known alias of ABC Engineering College.',
        candidates: pendingCandidates.map((candidate) => ({
          institutionId: candidate.institution.id,
          name: candidate.institution.name,
          aictePermanentId: candidate.institution.aictePermanentId,
          regionId: candidate.institution.regionId ?? null,
          city: candidate.institution.city,
          state: candidate.institution.state,
          score: candidate.score,
          requiresReview: candidate.requiresReview,
          autoLink: candidate.autoLink,
          reasoning: candidate.reasoning,
          evidence: candidate.evidence,
        })),
      }),
      resolvedInstitutionId: null,
      resolvedById: null,
      resolvedAt: null,
      resolutionNote: null,
    },
    create: {
      caseId: identityCase.id,
      submittedName: 'ABC Engineering Institute',
      submittedAictePermanentId: null,
      status: 'PENDING',
      candidateEvidence: JSON.stringify({
        policy:
          'Names and aliases never auto-link. An authorized officer must review the candidates and confirm the stable AICTE Permanent ID.',
        intakeNote: 'Submitted name resembles a known alias of ABC Engineering College.',
        candidates: pendingCandidates.map((candidate) => ({
          institutionId: candidate.institution.id,
          name: candidate.institution.name,
          aictePermanentId: candidate.institution.aictePermanentId,
          regionId: candidate.institution.regionId ?? null,
          city: candidate.institution.city,
          state: candidate.institution.state,
          score: candidate.score,
          requiresReview: candidate.requiresReview,
          autoLink: candidate.autoLink,
          reasoning: candidate.reasoning,
          evidence: candidate.evidence,
        })),
      }),
    },
  });

  await ensureCreatedAction(case1.id, admin.id, 'Complaint registered in the integrated monitoring system');
  await ensureCreatedAction(case2.id, admin.id, 'Complaint registered in the integrated monitoring system');
  await ensureCreatedAction(case3.id, admin.id, 'Complaint registered in the integrated monitoring system');
  await ensureCreatedAction(identityCase.id, admin.id, 'Complaint registered with an unverified institution name');

  // Real evaluators: create/reconcile overlaps and produce reminder
  // notifications through the same code paths used by the application.
  const overlapResult = await evaluateAllOverlaps(admin.id);
  const slaResult = await evaluateSla();

  const crossBureauKey = `cross-bureau:${abc.id}`;
  const crossBureauAlert = await prisma.overlapAlert.findUnique({ where: { caseKey: crossBureauKey } });
  if (crossBureauAlert) {
    await prisma.overlapAlert.update({
      where: { id: crossBureauAlert.id },
      data: {
        status: 'COORDINATION_REQUIRED',
        resolvedAt: null,
        dismissalReason: null,
      },
    });
    const existingReview = await prisma.alertReview.findFirst({
      where: { alertId: crossBureauAlert.id, action: 'COORDINATION_REQUIRED' },
    });
    if (!existingReview) {
      await prisma.alertReview.create({
        data: {
          alertId: crossBureauAlert.id,
          reviewedById: admin.id,
          action: 'COORDINATION_REQUIRED',
          remarks: 'Demo seed: marked for cross-Bureau coordination review.',
          outcome: 'Coordination requested between Regulation Bureau and PGRC.',
        },
      });
    }
  }

  const counts = {
    users: await prisma.user.count(),
    institutions: await prisma.institution.count(),
    cases: await prisma.case.count(),
    alerts: await prisma.overlapAlert.count(),
    identityResolutions: await prisma.institutionResolution.count(),
    notifications: await prisma.notification.count(),
    auditEvents: await prisma.auditEvent.count(),
  };

  console.log('Seeding completed.');
  console.log(
    `Overlap evaluation: ${overlapResult.created} created, ${overlapResult.updated} updated, ${overlapResult.dismissedOrphans} orphan(s) dismissed.`,
  );
  console.log(
    `SLA evaluation: ${slaResult.overdue} overdue, ${slaResult.approaching} approaching, ${slaResult.notificationsCreated} notification(s) created.`,
  );
  console.log('Current demonstration counts:', counts);
  console.log('\nDEMONSTRATION ACCOUNTS (fictional, password Demo@123):');
  for (const user of users) console.log(`   ${user.email} (${user.role})`);
  console.log('\nDEMONSTRATION SCENARIO:');
  console.log('   Institution: ABC Engineering College (DEMO-123456)');
  console.log('   - DEMO-COMP-2024-045 (PGRC, UNDER_PROCESS) - Faculty shortage');
  console.log('   - DEMO-COMP-2024-052 (RB, UNDER_REVIEW) - Compliance issues');
  console.log('   - DEMO-COMP-2024-058 (PGRC, RECEIVED) - Similar to 045');
  console.log('   - DEMO-COMP-2024-061 (disposed) - SLA compliance example');
  console.log('   - DEMO-COMP-2024-066 (identity pending) - ABC Engineering Institute alias');
  console.log('\nAll data is synthetic demonstration data only.');
}

main()
  .catch((error) => {
    console.error('Error seeding:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
