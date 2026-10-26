import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequest, Forbidden, Unauthorized } from '../utils/errors';
import { bureauSchema, categorySchema, regionSchema, slaRuleSchema, userCreateSchema, userUpdateSchema } from '../validators/schemas';
import { paginationSchema } from '../utils/pagination';
import { hashPassword } from '../utils/password';
import { writeAudit } from '../services/auditService';
import { toPublicUser } from '../utils/auth';

/**
 * Administrative responses need account state that the session payload does
 * not carry. Password hashes are never included.
 */
function toAdminUser(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  bureauId: string | null;
  regionId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  bureau?: { id: string; name: string; code: string } | null;
  region?: { id: string; name: string; code: string } | null;
}) {
  return {
    ...toPublicUser(user),
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function requireAdmin(req: Request) {
  if (!req.user) throw Unauthorized();
  if (req.user.role !== 'ADMIN') throw Forbidden('Administrator access required');
}

/**
 * Role and scope must be consistent. A Bureau officer without a Bureau or a
 * Regional officer without a Region would otherwise be able to authenticate
 * and then fail unpredictably (or, worse, be treated as globally scoped).
 */
async function assertUserScope(input: {
  role: string;
  bureauId?: string | null;
  regionId?: string | null;
}) {
  if (input.role === 'BUREAU_OFFICER') {
    if (!input.bureauId) throw BadRequest('Bureau officers require a Bureau/Cell assignment');
    const bureau = await prisma.bureau.findUnique({ where: { id: input.bureauId } });
    if (!bureau || !bureau.isActive) throw BadRequest('Select an active Bureau/Cell');
  }
  if (input.role === 'REGIONAL_OFFICER') {
    if (!input.regionId) throw BadRequest('Regional officers require a Region assignment');
    const region = await prisma.region.findUnique({ where: { id: input.regionId } });
    if (!region || !region.isActive) throw BadRequest('Select an active Region');
  }
  if (input.bureauId && input.role !== 'BUREAU_OFFICER') {
    throw BadRequest('Only Bureau officers can be assigned to a Bureau/Cell');
  }
  if (input.regionId && input.role !== 'REGIONAL_OFFICER') {
    throw BadRequest('Only Regional officers can be assigned to a Region');
  }
}

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const where = {
    ...(typeof q.role === 'string' ? { role: q.role } : {}),
    ...(q.isActive === 'true' ? { isActive: true } : q.isActive === 'false' ? { isActive: false } : {}),
    ...(typeof q.q === 'string' ? { OR: [{ email: { contains: q.q } }, { firstName: { contains: q.q } }, { lastName: { contains: q.q } }] } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { bureau: true, region: true },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  res.json({ items: items.map(toAdminUser), total });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = userCreateSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (existing) throw BadRequest('A user with this email already exists');
  await assertUserScope({
    role: body.role,
    bureauId: body.bureauId ?? null,
    regionId: body.regionId ?? null,
  });
  const passwordHash = await hashPassword(body.password);
  const user = await prisma.user.create({
    data: {
      email: body.email.toLowerCase(),
      passwordHash,
      firstName: body.firstName,
      lastName: body.lastName,
      role: body.role,
      bureauId: body.bureauId || null,
      regionId: body.regionId || null,
      isActive: body.isActive ?? true,
    },
    include: { bureau: true, region: true },
  });
  await writeAudit(req.user!, 'USER_CREATED', 'User', user.id, { role: user.role }, req);
  res.status(201).json({ user: toAdminUser(user) });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = userUpdateSchema.parse(req.body);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (id === req.user!.id && body.role && body.role !== req.user!.role) {
    throw BadRequest('You cannot change your own role');
  }
  if (id === req.user!.id && body.isActive === false) {
    throw BadRequest('You cannot deactivate your own account');
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw BadRequest('User not found');
  const nextRole = body.role ?? existing.role;
  const nextBureauId = body.bureauId !== undefined ? body.bureauId || null : existing.bureauId;
  const nextRegionId = body.regionId !== undefined ? body.regionId || null : existing.regionId;
  await assertUserScope({ role: nextRole, bureauId: nextBureauId, regionId: nextRegionId });

  const data: any = {};
  if (body.firstName) data.firstName = body.firstName;
  if (body.lastName) data.lastName = body.lastName;
  if (body.role) data.role = body.role;
  if (body.bureauId !== undefined) data.bureauId = nextBureauId;
  if (body.regionId !== undefined) data.regionId = nextRegionId;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.password) data.passwordHash = await hashPassword(body.password);
  const user = await prisma.user.update({ where: { id }, data, include: { bureau: true, region: true } });
  // Never write password hashes or other sensitive values to the audit trail.
  await writeAudit(req.user!, 'USER_UPDATED', 'User', user.id, {
    fields: Object.keys(body),
    role: user.role,
    bureauId: user.bureauId,
    regionId: user.regionId,
    isActive: user.isActive,
  }, req);
  res.json({ user: toAdminUser(user) });
});

export const listBureaus = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const bureaus = await prisma.bureau.findMany({ orderBy: { name: 'asc' } });
  res.json({ bureaus });
});

export const createBureau = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = bureauSchema.parse(req.body);
  const bureau = await prisma.bureau.create({ data: body });
  await writeAudit(req.user!, 'BUREAU_CREATED', 'Bureau', bureau.id, body, req);
  res.status(201).json({ bureau });
});

export const updateBureau = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = bureauSchema.partial().parse(req.body);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const bureau = await prisma.bureau.update({ where: { id }, data: body });
  await writeAudit(req.user!, 'BUREAU_UPDATED', 'Bureau', bureau.id, body, req);
  res.json({ bureau });
});

export const listRegions = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const regions = await prisma.region.findMany({ orderBy: { name: 'asc' } });
  res.json({ regions });
});

export const createRegion = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = regionSchema.parse(req.body);
  const region = await prisma.region.create({ data: { ...body, states: body.states.join(',') } });
  await writeAudit(req.user!, 'REGION_CREATED', 'Region', region.id, body, req);
  res.status(201).json({ region });
});

export const updateRegion = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = regionSchema.partial().parse(req.body);
  const data: any = { ...body };
  if (body.states) data.states = (body.states as string[]).join(',');
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const region = await prisma.region.update({ where: { id }, data });
  await writeAudit(req.user!, 'REGION_UPDATED', 'Region', region.id, body, req);
  res.json({ region });
});

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const categories = await prisma.complaintCategory.findMany({ orderBy: { name: 'asc' } });
  res.json({ categories });
});

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = categorySchema.parse(req.body);
  const category = await prisma.complaintCategory.create({ data: body });
  await writeAudit(req.user!, 'CATEGORY_CREATED', 'ComplaintCategory', category.id, body, req);
  res.status(201).json({ category });
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = categorySchema.partial().parse(req.body);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const category = await prisma.complaintCategory.update({ where: { id }, data: body });
  await writeAudit(req.user!, 'CATEGORY_UPDATED', 'ComplaintCategory', category.id, body, req);
  res.json({ category });
});

export const listSlaRules = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const rules = await prisma.sLARule.findMany({ include: { category: true }, orderBy: { createdAt: 'desc' } });
  res.json({ rules });
});

export const createSlaRule = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = slaRuleSchema.parse(req.body);
  const rule = await prisma.sLARule.create({ data: body as any });
  await writeAudit(req.user!, 'SLA_RULE_CREATED', 'SLARule', rule.id, body, req);
  res.status(201).json({ rule });
});

export const updateSlaRule = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const body = slaRuleSchema.partial().parse(req.body);
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rule = await prisma.sLARule.update({ where: { id }, data: body as any });
  await writeAudit(req.user!, 'SLA_RULE_UPDATED', 'SLARule', rule.id, body, req);
  res.json({ rule });
});

/**
 * Read-only audit trail for administrators. Payloads are parsed defensively;
 * the response contains only audit metadata, never credentials.
 */
export const listAuditEvents = asyncHandler(async (req: Request, res: Response) => {
  requireAdmin(req);
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const where: any = {
    ...(typeof q.action === 'string' ? { action: { contains: q.action } } : {}),
    ...(typeof q.entityType === 'string' ? { entityType: q.entityType } : {}),
    ...(typeof q.entityId === 'string' ? { entityId: q.entityId } : {}),
    ...(typeof q.userId === 'string' ? { userId: q.userId } : {}),
  };
  const [total, items] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  res.json({
    items: items.map((event) => {
      let details: unknown = null;
      if (event.details) {
        try {
          details = JSON.parse(event.details);
        } catch {
          details = event.details;
        }
      }
      return { ...event, details };
    }),
    total,
  });
});
