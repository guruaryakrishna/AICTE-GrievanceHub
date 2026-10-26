import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Unauthorized } from '../utils/errors';
import { getDashboard, parseDate } from '../services/dashboardService';

export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const data = await getDashboard(req.user, {
    bureauId: typeof q.bureauId === 'string' ? q.bureauId : undefined,
    regionId: typeof q.regionId === 'string' ? q.regionId : undefined,
    categoryId: typeof q.categoryId === 'string' ? q.categoryId : undefined,
    dateFrom: parseDate(typeof q.dateFrom === 'string' ? q.dateFrom : undefined),
    dateTo: parseDate(typeof q.dateTo === 'string' ? q.dateTo : undefined),
  });
  res.json(data);
});
