import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequest, Unauthorized } from '../utils/errors';
import { institutionSchema, institutionUpdateSchema, mergeInstitutionSchema } from '../validators/schemas';
import { paginationSchema } from '../utils/pagination';
import {
  createInstitution,
  getInstitutionDetail,
  listInstitutions,
  updateInstitution,
  addInstitutionAlias,
  identityResolutionStats,
  listIdentityResolutions,
  mergeInstitutions,
  resolveInstitutionIdentity,
} from '../services/institutionService';
import { findInstitutionCandidates } from '../services/matching/institutionMatcher';

const getQ = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? (v[0] as string) : undefined);

export const getInstitutions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const sortBy = getQ(q.sortBy) ?? 'name';
  const sortOrder = getQ(q.sortOrder) === 'desc' ? 'desc' : 'asc';
  const isActive = getQ(q.isActive) === undefined ? undefined : getQ(q.isActive) === 'true';
  const result = await listInstitutions(req.user, {
    q: getQ(q.q),
    regionId: getQ(q.regionId),
    state: getQ(q.state),
    isActive,
    page,
    pageSize,
    sortBy,
    sortOrder,
  });
  res.json(result);
});

const getId = (v: unknown) => (Array.isArray(v) ? v[0] : (v as string));

export const getInstitutionById = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const institution = await getInstitutionDetail(req.user, getId(req.params.id));
  res.json({ institution });
});

export const createInstitutionRecord = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = institutionSchema.parse(req.body);
  const institution = await createInstitution(req.user, body, {
    confirmPotentialDuplicate: body.confirmPotentialDuplicate,
    duplicateJustification: body.duplicateJustification,
  });
  res.status(201).json({ institution });
});

export const updateInstitutionRecord = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = institutionUpdateSchema.parse(req.body);
  const institution = await updateInstitution(req.user, getId(req.params.id), body);
  res.json({ institution });
});

export const matchInstitutions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const name = getQ(q.name) ?? '';
  const aictePermanentId = getQ(q.aictePermanentId);
  if (!name && !aictePermanentId) {
    throw BadRequest('Provide name or aictePermanentId for matching');
  }
  const candidates = await findInstitutionCandidates({
    name,
    aictePermanentId,
    pinCode: getQ(q.pinCode) ?? undefined,
    district: getQ(q.district) ?? undefined,
    state: getQ(q.state) ?? undefined,
    city: getQ(q.city) ?? undefined,
  });
  res.json({ candidates });
});

import { z } from 'zod';

export const addAlias = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = z.object({ alias: z.string().trim().min(2) }).parse(req.body);
  const alias = await addInstitutionAlias(req.user, getId(req.params.id), body.alias);
  res.status(201).json({ alias });
});

export const merge = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = mergeInstitutionSchema.parse(req.body);
  const result = await mergeInstitutions(req.user, getId(req.params.id), body);
  res.json(result);
});

export const getIdentityResolutions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const result = await listIdentityResolutions(req.user, {
    status: getQ(q.status)?.split(',').filter(Boolean),
    q: getQ(q.q),
    page,
    pageSize,
  });
  res.json(result);
});

export const getIdentityResolutionStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  res.json({ stats: await identityResolutionStats(req.user) });
});

export const resolveIdentity = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = z
    .object({
      institutionId: z.string().min(1).optional().nullable(),
      dismiss: z.boolean().optional(),
      note: z.string().trim().max(2000).optional().nullable(),
    })
    .parse(req.body);
  const resolution = await resolveInstitutionIdentity(req.user, getId(req.params.id), body);
  res.json({ resolution });
});

export const listRegions = asyncHandler(async (_req: Request, res: Response) => {
  const regions = await prisma.region.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json({ regions });
});

export const listBureaus = asyncHandler(async (_req: Request, res: Response) => {
  const bureaus = await prisma.bureau.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json({ bureaus });
});

export const listCategories = asyncHandler(async (_req: Request, res: Response) => {
  const categories = await prisma.complaintCategory.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json({ categories });
});
