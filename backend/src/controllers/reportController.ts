import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { Forbidden, Unauthorized } from '../utils/errors';
import { getReportSummary, exportCasesCsv, exportAlertsCsv, exportInstitutionsCsv } from '../services/reportService';
import { parseDate } from '../services/dashboardService';
import { evaluateSla } from '../services/slaService';

export const summary = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const data = await getReportSummary(req.user, {
    bureauId: typeof q.bureauId === 'string' ? q.bureauId : undefined,
    regionId: typeof q.regionId === 'string' ? q.regionId : undefined,
    categoryId: typeof q.categoryId === 'string' ? q.categoryId : undefined,
    dateFrom: parseDate(typeof q.dateFrom === 'string' ? q.dateFrom : undefined),
    dateTo: parseDate(typeof q.dateTo === 'string' ? q.dateTo : undefined),
  });
  res.json(data);
});

function setCsvHeaders(res: Response, filename: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export const exportCases = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const csv = await exportCasesCsv(req.user, {
    bureauId: typeof q.bureauId === 'string' ? q.bureauId : undefined,
    regionId: typeof q.regionId === 'string' ? q.regionId : undefined,
    categoryId: typeof q.categoryId === 'string' ? q.categoryId : undefined,
    status: typeof q.status === 'string' ? q.status.split(',').filter(Boolean) : undefined,
    dateFrom: parseDate(typeof q.dateFrom === 'string' ? q.dateFrom : undefined),
    dateTo: parseDate(typeof q.dateTo === 'string' ? q.dateTo : undefined),
  });
  setCsvHeaders(res, `aicte-cases-${Date.now()}.csv`);
  res.send(csv);
});

export const exportAlerts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const csv = await exportAlertsCsv(req.user, {
    regionId: typeof q.regionId === 'string' ? q.regionId : undefined,
    dateFrom: parseDate(typeof q.dateFrom === 'string' ? q.dateFrom : undefined),
    dateTo: parseDate(typeof q.dateTo === 'string' ? q.dateTo : undefined),
  });
  setCsvHeaders(res, `aicte-overlap-alerts-${Date.now()}.csv`);
  res.send(csv);
});

export const exportInstitutions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  const q = req.query;
  const csv = await exportInstitutionsCsv(req.user, {
    q: typeof q.q === 'string' ? q.q : undefined,
    regionId: typeof q.regionId === 'string' ? q.regionId : undefined,
  });
  setCsvHeaders(res, `aicte-institutions-${Date.now()}.csv`);
  res.send(csv);
});

export const runSla = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw Unauthorized();
  if (req.user.role !== 'ADMIN') throw Forbidden('Only administrators can run SLA evaluation');
  const result = await evaluateSla();
  res.json({ result });
});
