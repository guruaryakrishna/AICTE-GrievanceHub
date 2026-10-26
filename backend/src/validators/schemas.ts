import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('A valid email address is required'),
  password: z.string().min(1, 'Password is required'),
});

const optionalString = z.string().trim().optional().nullable();

export const institutionSchema = z.object({
  aictePermanentId: z.string().trim().min(2, 'AICTE Permanent ID is required').max(60),
  name: z.string().trim().min(2, 'Institution name is required').max(200),
  alternateNames: z.array(z.string().trim().min(1)).max(20).optional(),
  institutionType: optionalString,
  address: optionalString,
  city: optionalString,
  district: optionalString,
  state: optionalString,
  regionId: optionalString,
  pinCode: z.string().trim().regex(/^[0-9]{6}$/, 'PIN code must be 6 digits').optional().nullable().or(z.literal('')),
  contactDetails: z.record(z.string(), z.unknown()).optional().nullable(),
  isActive: z.boolean().optional(),
  confirmPotentialDuplicate: z.boolean().optional(),
  duplicateJustification: optionalString,
});

export const institutionUpdateSchema = institutionSchema.partial().omit({
  confirmPotentialDuplicate: true,
  duplicateJustification: true,
});

export const caseCreateSchema = z.object({
  institutionId: optionalString,
  institutionAictePermanentId: optionalString,
  originalInstitutionName: optionalString,
  title: z.string().trim().min(5, 'Title must be at least 5 characters').max(240),
  description: z.string().trim().min(20, 'Description must be at least 20 characters').max(20000),
  categoryId: z.string().min(1, 'Complaint category is required'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  currentBureauId: optionalString,
  assignedOfficerId: optionalString,
  dateReceived: z.coerce.date().optional(),
  nextRequiredAction: optionalString,
  nextActionDueDate: z.coerce.date().optional().nullable(),
  expectedDisposalDate: z.coerce.date().optional().nullable(),
  identityReviewNote: optionalString,
});

export const caseActionSchema = z.object({
  remarks: z.string().trim().min(2, 'Remark is required').max(5000),
  nextRequiredAction: optionalString,
  nextActionDueDate: z.coerce.date().optional().nullable(),
  actionType: optionalString,
});

export const caseAssignSchema = z.object({
  assignedOfficerId: z.string().nullable(),
  remarks: optionalString,
});

export const caseStatusSchema = z.object({
  status: z.enum(['RECEIVED', 'UNDER_REVIEW', 'UNDER_PROCESS', 'TRANSFERRED', 'ESCALATED', 'DISPOSED', 'REOPENED']),
  remarks: optionalString,
});

export const caseTransferSchema = z.object({
  toBureauId: z.string().min(1, 'Destination Bureau/Cell is required'),
  toOfficerId: optionalString,
  reason: z.string().trim().min(5, 'Transfer reason is required').max(2000),
});

export const caseEscalateSchema = z.object({
  reason: z.string().trim().min(5, 'Escalation reason is required').max(2000),
  escalateTo: optionalString,
});

export const caseDisposeSchema = z.object({
  resolutionRemarks: z.string().trim().min(10, 'Meaningful resolution remarks are required').max(10000),
});

export const caseReopenSchema = z.object({
  reason: z.string().trim().min(10, 'A meaningful reopen reason is required').max(5000),
});

export const alertReviewSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'COORDINATION_REQUIRED', 'RESOLVED', 'DISMISSED']),
  remarks: optionalString,
  outcome: optionalString,
  dismissalReason: optionalString,
  assignedCoordinatorId: optionalString,
});

export const notificationReadSchema = z.object({
  isRead: z.boolean().optional(),
});

export const userCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(['ADMIN', 'BUREAU_OFFICER', 'REGIONAL_OFFICER', 'SENIOR_MANAGEMENT', 'READ_ONLY']),
  bureauId: optionalString,
  regionId: optionalString,
  isActive: z.boolean().optional(),
});

export const userUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  role: z.enum(['ADMIN', 'BUREAU_OFFICER', 'REGIONAL_OFFICER', 'SENIOR_MANAGEMENT', 'READ_ONLY']).optional(),
  bureauId: optionalString,
  regionId: optionalString,
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export const bureauSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20),
  type: z.enum(['REGULATION_BUREAU', 'PUBLIC_GRIEVANCE_REDRESSAL_CELL', 'OTHER']),
  description: optionalString,
  isActive: z.boolean().optional(),
});

export const regionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20),
  states: z.array(z.string()).default([]),
  isActive: z.boolean().optional(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30),
  description: optionalString,
  isActive: z.boolean().optional(),
});

export const slaRuleSchema = z.object({
  name: z.string().trim().min(2).max(160),
  categoryId: optionalString,
  bureauId: optionalString,
  priority: optionalString,
  slaDurationHours: z.number().int().min(1).max(8760),
  warningThresholdHours: z.number().int().min(0).max(8760),
  escalationThresholdHours: z.number().int().min(0).max(8760),
  isActive: z.boolean().optional(),
});

export const mergeInstitutionSchema = z.object({
  targetInstitutionId: z.string().min(1),
  reason: z.string().trim().min(5),
});
