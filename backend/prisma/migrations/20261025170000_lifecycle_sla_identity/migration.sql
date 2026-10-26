-- DropIndex
DROP INDEX "Notification_dedupeKey_key";

-- CreateTable
CREATE TABLE "InstitutionResolution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "submittedName" TEXT NOT NULL,
    "submittedAictePermanentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "candidateEvidence" TEXT,
    "resolvedInstitutionId" TEXT,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InstitutionResolution_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstitutionResolution_resolvedInstitutionId_fkey" FOREIGN KEY ("resolvedInstitutionId") REFERENCES "Institution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InstitutionResolution_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionResolution_caseId_key" ON "InstitutionResolution"("caseId");

-- CreateIndex
CREATE INDEX "InstitutionResolution_status_idx" ON "InstitutionResolution"("status");

-- CreateIndex
CREATE INDEX "InstitutionResolution_resolvedInstitutionId_idx" ON "InstitutionResolution"("resolvedInstitutionId");

-- CreateIndex
CREATE INDEX "InstitutionResolution_resolvedById_idx" ON "InstitutionResolution"("resolvedById");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
