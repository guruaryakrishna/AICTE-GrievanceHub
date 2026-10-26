-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bureauId" TEXT,
    "regionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_bureauId_fkey" FOREIGN KEY ("bureauId") REFERENCES "Bureau" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bureau" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "states" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "aictePermanentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "alternateNames" TEXT,
    "institutionType" TEXT,
    "address" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "regionId" TEXT,
    "pinCode" TEXT,
    "contactDetails" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Institution_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstitutionAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "institutionId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionAlias_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComplaintCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseNumber" TEXT NOT NULL,
    "institutionId" TEXT,
    "originalInstitutionName" TEXT,
    "dateReceived" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "currentBureauId" TEXT,
    "assignedOfficerId" TEXT,
    "createdById" TEXT NOT NULL,
    "lastAction" TEXT,
    "lastActionDate" DATETIME,
    "nextRequiredAction" TEXT,
    "nextActionDueDate" DATETIME,
    "expectedDisposalDate" DATETIME,
    "slaDueDate" DATETIME,
    "resolutionRemarks" TEXT,
    "disposedAt" DATETIME,
    "reopenedAt" DATETIME,
    "reopenReason" TEXT,
    "transferredFromBureauId" TEXT,
    "escalatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Case_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Case_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ComplaintCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Case_currentBureauId_fkey" FOREIGN KEY ("currentBureauId") REFERENCES "Bureau" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Case_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Case_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseActionHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "bureauId" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "remarks" TEXT,
    "metadata" TEXT,
    "alertId" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseActionHistory_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseActionHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OverlapAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "institutionId" TEXT,
    "caseKey" TEXT,
    "detectionReason" TEXT NOT NULL,
    "confidence" REAL,
    "similarityScore" REAL,
    "evidence" TEXT,
    "assignedCoordinatorId" TEXT,
    "firstDetectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEvaluatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "dismissalReason" TEXT,
    "resolutionOutcome" TEXT,
    "reviewerRemarks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OverlapAlert_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CaseAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaseAlert_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseAlert_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "OverlapAlert" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AlertReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "alertId" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "remarks" TEXT,
    "outcome" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertReview_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "OverlapAlert" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AlertReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SLARule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "bureauId" TEXT,
    "priority" TEXT,
    "slaDurationHours" INTEGER NOT NULL,
    "warningThresholdHours" INTEGER NOT NULL,
    "escalationThresholdHours" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemonstration" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SLARule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ComplaintCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "alertId" TEXT,
    "caseId" TEXT,
    "dedupeKey" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "OverlapAlert" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_bureauId_idx" ON "User"("bureauId");

-- CreateIndex
CREATE INDEX "User_regionId_idx" ON "User"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "Bureau_name_key" ON "Bureau"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Bureau_code_key" ON "Bureau"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_aictePermanentId_key" ON "Institution"("aictePermanentId");

-- CreateIndex
CREATE INDEX "Institution_aictePermanentId_idx" ON "Institution"("aictePermanentId");

-- CreateIndex
CREATE INDEX "Institution_normalizedName_idx" ON "Institution"("normalizedName");

-- CreateIndex
CREATE INDEX "Institution_regionId_idx" ON "Institution"("regionId");

-- CreateIndex
CREATE INDEX "InstitutionAlias_institutionId_idx" ON "InstitutionAlias"("institutionId");

-- CreateIndex
CREATE INDEX "InstitutionAlias_normalizedAlias_idx" ON "InstitutionAlias"("normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintCategory_name_key" ON "ComplaintCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintCategory_code_key" ON "ComplaintCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Case_caseNumber_key" ON "Case"("caseNumber");

-- CreateIndex
CREATE INDEX "Case_caseNumber_idx" ON "Case"("caseNumber");

-- CreateIndex
CREATE INDEX "Case_institutionId_idx" ON "Case"("institutionId");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_currentBureauId_idx" ON "Case"("currentBureauId");

-- CreateIndex
CREATE INDEX "Case_assignedOfficerId_idx" ON "Case"("assignedOfficerId");

-- CreateIndex
CREATE INDEX "Case_categoryId_idx" ON "Case"("categoryId");

-- CreateIndex
CREATE INDEX "Case_dateReceived_idx" ON "Case"("dateReceived");

-- CreateIndex
CREATE INDEX "Case_nextActionDueDate_idx" ON "Case"("nextActionDueDate");

-- CreateIndex
CREATE INDEX "CaseActionHistory_caseId_idx" ON "CaseActionHistory"("caseId");

-- CreateIndex
CREATE INDEX "CaseActionHistory_performedById_idx" ON "CaseActionHistory"("performedById");

-- CreateIndex
CREATE INDEX "CaseActionHistory_actionType_idx" ON "CaseActionHistory"("actionType");

-- CreateIndex
CREATE INDEX "CaseActionHistory_timestamp_idx" ON "CaseActionHistory"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "OverlapAlert_caseKey_key" ON "OverlapAlert"("caseKey");

-- CreateIndex
CREATE INDEX "OverlapAlert_status_idx" ON "OverlapAlert"("status");

-- CreateIndex
CREATE INDEX "OverlapAlert_alertType_idx" ON "OverlapAlert"("alertType");

-- CreateIndex
CREATE INDEX "OverlapAlert_institutionId_idx" ON "OverlapAlert"("institutionId");

-- CreateIndex
CREATE INDEX "OverlapAlert_firstDetectedAt_idx" ON "OverlapAlert"("firstDetectedAt");

-- CreateIndex
CREATE INDEX "CaseAlert_caseId_idx" ON "CaseAlert"("caseId");

-- CreateIndex
CREATE INDEX "CaseAlert_alertId_idx" ON "CaseAlert"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseAlert_caseId_alertId_key" ON "CaseAlert"("caseId", "alertId");

-- CreateIndex
CREATE INDEX "AlertReview_alertId_idx" ON "AlertReview"("alertId");

-- CreateIndex
CREATE INDEX "AlertReview_reviewedById_idx" ON "AlertReview"("reviewedById");

-- CreateIndex
CREATE INDEX "SLARule_categoryId_idx" ON "SLARule"("categoryId");

-- CreateIndex
CREATE INDEX "SLARule_bureauId_idx" ON "SLARule"("bureauId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_idx" ON "AuditEvent"("userId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_idx" ON "AuditEvent"("entityType");

-- CreateIndex
CREATE INDEX "AuditEvent_entityId_idx" ON "AuditEvent"("entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_timestamp_idx" ON "AuditEvent"("timestamp");
