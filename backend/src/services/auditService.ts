import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { Request } from 'express';

type Tx = Prisma.TransactionClient;

export async function writeAudit(
  user: { id: string } | null,
  action: string,
  entityType: string,
  entityId: string,
  details?: unknown,
  req?: Request,
  tx: Tx | typeof prisma = prisma,
) {
  await tx.auditEvent.create({
    data: {
      userId: user?.id ?? null,
      action,
      entityType,
      entityId,
      ipAddress: req?.ip,
      userAgent: req?.headers['user-agent']?.slice(0, 300),
      details: details ? JSON.stringify(details) : null,
    },
  });
}

export async function writeCaseAction(
  tx: Tx,
  data: {
    caseId: string;
    actionType: string;
    performedById: string;
    bureauId?: string | null;
    previousValue?: string | null;
    newValue?: string | null;
    remarks?: string | null;
    metadata?: unknown;
    alertId?: string | null;
  },
) {
  const payload: any = {
    caseId: data.caseId,
    actionType: data.actionType,
    performedById: data.performedById,
    bureauId: data.bureauId ?? null,
    previousValue: data.previousValue ?? null,
    newValue: data.newValue ?? null,
    remarks: data.remarks ?? null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
  };
  if (data.alertId) payload.alertId = data.alertId;
  return tx.caseActionHistory.create({ data: payload });
}
