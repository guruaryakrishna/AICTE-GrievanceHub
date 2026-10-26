import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Forbidden, Unauthorized } from '../utils/errors';
import { alertReviewSchema } from '../validators/schemas';
import { paginationSchema } from '../utils/pagination';
import { getAlertOrThrow, listAlerts, reviewAlert } from '../services/alertService';
import { evaluateAllOverlaps, evaluateInstitutionOverlaps } from '../services/matching/overlapDetection';

export const list = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const { page, pageSize } = paginationSchema.parse(q);
  const result = await listAlerts(req.user, {
    status: typeof q.status === 'string' ? q.status.split(',').filter(Boolean) : undefined,
    alertType: typeof q.alertType === 'string' ? q.alertType : undefined,
    institutionId: typeof q.institutionId === 'string' ? q.institutionId : undefined,
    q: typeof q.q === 'string' ? q.q : undefined,
    page,
    pageSize,
  });
  res.json(result);
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const alert = await getAlertOrThrow(req.user, id);
  res.json({ alert });
});

export const review = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const body = alertReviewSchema.parse(req.body);
  const alert = await reviewAlert(req.user, id, body);
  res.json({ alert });
});

export const evaluate = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  if (req.user.role !== 'ADMIN') {
    throw Forbidden('Only administrators can run overlap evaluation');
  }
  const qv = req.query.institutionId;
  const institutionId = typeof qv === 'string' ? qv : Array.isArray(qv) ? (qv[0] as string) : undefined;
  const result = institutionId ? await evaluateInstitutionOverlaps(institutionId, req.user.id) : await evaluateAllOverlaps(req.user.id);
  res.json({ result });
});
