import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Unauthorized } from '../utils/errors';
import {
  caseActionSchema,
  caseAssignSchema,
  caseCreateSchema,
  caseDisposeSchema,
  caseEscalateSchema,
  caseReopenSchema,
  caseStatusSchema,
  caseTransferSchema,
} from '../validators/schemas';
import { paginationSchema } from '../utils/pagination';
import {
  addCaseAction,
  assignCase,
  changeStatus,
  createCase,
  disposeCase,
  escalateCase,
  getCaseDetail,
  listAssignableOfficers,
  listCases,
  reopenCase,
  transferCase,
} from '../services/caseService';
import { parseDate } from '../services/dashboardService';

const getP = (v: unknown) => (Array.isArray(v) ? v[0] : (v as string));

export const create = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseCreateSchema.parse(req.body);
  const c = await createCase(req.user, {
    ...body,
    dateReceived: body.dateReceived,
    nextActionDueDate: body.nextActionDueDate ?? null,
    expectedDisposalDate: body.expectedDisposalDate ?? null,
  });
  res.status(201).json({ case: c });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const get = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? (v[0] as string) : undefined);
  const split = (v: unknown) => (typeof v === 'string' ? v.split(',').filter(Boolean) : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
  const result = await listCases(req.user, {
    q: get(q.q),
    status: split(q.status),
    priority: split(q.priority),
    bureauId: get(q.bureauId),
    regionId: get(q.regionId),
    categoryId: get(q.categoryId),
    assignedOfficerId: get(q.assignedOfficerId),
    institutionId: get(q.institutionId),
    dateFrom: parseDate(get(q.dateFrom)),
    dateTo: parseDate(get(q.dateTo)),
    dueFrom: parseDate(get(q.dueFrom)),
    dueTo: parseDate(get(q.dueTo)),
    overdue: get(q.overdue) === 'true',
    page,
    pageSize,
    sortBy: get(q.sortBy) ?? 'createdAt',
    sortOrder: get(q.sortOrder) === 'asc' ? 'asc' : 'desc',
  });
  res.json(result);
});

export const officers = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const bureauId = getP(req.query.bureauId) || null;
  const result = await listAssignableOfficers(req.user, { bureauId });
  res.json({ officers: result });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const c = await getCaseDetail(req.user, getP(req.params.id));
  res.json({ case: c });
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseStatusSchema.parse(req.body);
  const c = await changeStatus(req.user, getP(req.params.id), body);
  res.json({ case: c });
});

export const addAction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseActionSchema.parse(req.body);
  const c = await addCaseAction(req.user, getP(req.params.id), {
    ...body,
    actionType: body.actionType ?? undefined,
  });
  res.json({ case: c });
});

export const assign = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseAssignSchema.parse(req.body);
  const c = await assignCase(req.user, getP(req.params.id), body);
  res.json({ case: c });
});

export const transfer = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseTransferSchema.parse(req.body);
  const c = await transferCase(req.user, getP(req.params.id), body);
  res.json({ case: c });
});

export const escalate = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseEscalateSchema.parse(req.body);
  const c = await escalateCase(req.user, getP(req.params.id), body);
  res.json({ case: c });
});

export const dispose = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseDisposeSchema.parse(req.body);
  const c = await disposeCase(req.user, getP(req.params.id), body);
  res.json({ case: c });
});

export const reopen = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const body = caseReopenSchema.parse(req.body);
  const c = await reopenCase(req.user, getP(req.params.id), body);
  res.json({ case: c });
});
