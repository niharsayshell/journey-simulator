-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('DNS_TXT', 'HTTP_FILE');

-- CreateEnum
CREATE TYPE "DomainStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "BrowserEngine" AS ENUM ('chromium', 'firefox', 'webkit');

-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('HTTP', 'HTTPS', 'SOCKS5');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('FRESH_SESSION', 'RETURNING_SESSION', 'AUTHENTICATED_TEST_ACCOUNT', 'MULTI_ACCOUNT_TEST');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PASSED', 'FAILED', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('INFRASTRUCTURE', 'NETWORK', 'SITE_ERROR', 'ASSERTION', 'TIMEOUT', 'SECURITY', 'CANCELLED', 'VALIDATION');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('SCREENSHOT', 'TRACE', 'LOG');

-- CreateEnum
CREATE TYPE "SecretKind" AS ENUM ('PROXY_CREDENTIALS', 'STORAGE_STATE', 'TEST_ACCOUNT_CREDENTIALS');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "testHeaderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "testHeaderName" TEXT NOT NULL DEFAULT 'X-Journey-Simulator',
    "testHeaderValue" TEXT NOT NULL DEFAULT 'synthetic',
    "artifactRetentionDays" INTEGER NOT NULL DEFAULT 14,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMembership" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerifiedDomain" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER,
    "allowSubdomains" BOOLEAN NOT NULL DEFAULT false,
    "method" "VerificationMethod" NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'https',
    "verificationToken" TEXT NOT NULL,
    "status" "DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastCheckError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "latestVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "startUrl" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioStep" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "config" JSONB NOT NULL,

    CONSTRAINT "ScenarioStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrowserProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "engine" "BrowserEngine" NOT NULL DEFAULT 'chromium',
    "devicePreset" TEXT,
    "viewportWidth" INTEGER NOT NULL DEFAULT 1366,
    "viewportHeight" INTEGER NOT NULL DEFAULT 768,
    "isMobile" BOOLEAN NOT NULL DEFAULT false,
    "userAgent" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "colorScheme" TEXT NOT NULL DEFAULT 'light',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrowserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'FRESH_SESSION',
    "browserProfileId" TEXT,
    "geolocationLatitude" DOUBLE PRECISION,
    "geolocationLongitude" DOUBLE PRECISION,
    "storageStateSecretId" TEXT,
    "testAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAccount" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "usernameHint" TEXT,
    "credentialSecretId" TEXT,
    "leasedByRunId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyProfile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProxyType" NOT NULL DEFAULT 'HTTP',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "hasCredentials" BOOLEAN NOT NULL DEFAULT false,
    "credentialSecretId" TEXT,
    "regionLabel" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastEgressIp" TEXT,
    "lastLatencyMs" INTEGER,
    "lastTestError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedSecret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "SecretKind" NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncryptedSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "browserProfileId" TEXT,
    "proxyProfileId" TEXT,
    "sessionProfileId" TEXT,
    "sessionMode" "SessionMode" NOT NULL DEFAULT 'FRESH_SESSION',
    "createdById" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'QUEUED',
    "iterations" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "launchDelayMs" INTEGER NOT NULL DEFAULT 0,
    "maxFailures" INTEGER NOT NULL DEFAULT 0,
    "captureTrace" BOOLEAN NOT NULL DEFAULT false,
    "configSnapshot" JSONB NOT NULL,
    "cancelReason" TEXT,
    "scheduledTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TestBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "targetHost" TEXT NOT NULL,
    "workerId" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCategory" "ErrorCategory",
    "errorMessage" TEXT,
    "finalUrl" TEXT,
    "navigationUrls" JSONB,
    "observed" JSONB,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "status" "StepStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "url" TEXT,
    "errorCategory" "ErrorCategory",
    "errorMessage" TEXT,
    "detail" JSONB,

    CONSTRAINT "StepResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepResultId" TEXT,
    "kind" "ArtifactKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT,
    "runAt" TIMESTAMP(3),
    "batchConfig" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "ProjectMembership_userId_idx" ON "ProjectMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");

-- CreateIndex
CREATE INDEX "VerifiedDomain_projectId_status_idx" ON "VerifiedDomain"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VerifiedDomain_projectId_hostname_port_key" ON "VerifiedDomain"("projectId", "hostname", "port");

-- CreateIndex
CREATE INDEX "Scenario_projectId_updatedAt_idx" ON "Scenario"("projectId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioVersion_scenarioId_version_key" ON "ScenarioVersion"("scenarioId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioStep_scenarioVersionId_index_key" ON "ScenarioStep"("scenarioVersionId", "index");

-- CreateIndex
CREATE INDEX "BrowserProfile_projectId_idx" ON "BrowserProfile"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionProfile_storageStateSecretId_key" ON "SessionProfile"("storageStateSecretId");

-- CreateIndex
CREATE INDEX "SessionProfile_projectId_idx" ON "SessionProfile"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAccount_credentialSecretId_key" ON "TestAccount"("credentialSecretId");

-- CreateIndex
CREATE INDEX "TestAccount_projectId_idx" ON "TestAccount"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyProfile_credentialSecretId_key" ON "ProxyProfile"("credentialSecretId");

-- CreateIndex
CREATE INDEX "ProxyProfile_projectId_idx" ON "ProxyProfile"("projectId");

-- CreateIndex
CREATE INDEX "EncryptedSecret_projectId_idx" ON "EncryptedSecret"("projectId");

-- CreateIndex
CREATE INDEX "TestBatch_projectId_createdAt_idx" ON "TestBatch"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "TestBatch_status_idx" ON "TestBatch"("status");

-- CreateIndex
CREATE INDEX "TestRun_batchId_status_idx" ON "TestRun"("batchId", "status");

-- CreateIndex
CREATE INDEX "TestRun_status_heartbeatAt_idx" ON "TestRun"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "TestRun_targetHost_status_idx" ON "TestRun"("targetHost", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_batchId_iteration_key" ON "TestRun"("batchId", "iteration");

-- CreateIndex
CREATE UNIQUE INDEX "StepResult_runId_stepIndex_key" ON "StepResult"("runId", "stepIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_storageKey_key" ON "Artifact"("storageKey");

-- CreateIndex
CREATE INDEX "Artifact_runId_idx" ON "Artifact"("runId");

-- CreateIndex
CREATE INDEX "Artifact_expiresAt_idx" ON "Artifact"("expiresAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_nextRunAt_idx" ON "ScheduledTask"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerifiedDomain" ADD CONSTRAINT "VerifiedDomain_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioVersion" ADD CONSTRAINT "ScenarioVersion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioStep" ADD CONSTRAINT "ScenarioStep_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserProfile" ADD CONSTRAINT "BrowserProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProfile" ADD CONSTRAINT "SessionProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProfile" ADD CONSTRAINT "SessionProfile_browserProfileId_fkey" FOREIGN KEY ("browserProfileId") REFERENCES "BrowserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProfile" ADD CONSTRAINT "SessionProfile_storageStateSecretId_fkey" FOREIGN KEY ("storageStateSecretId") REFERENCES "EncryptedSecret"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionProfile" ADD CONSTRAINT "SessionProfile_testAccountId_fkey" FOREIGN KEY ("testAccountId") REFERENCES "TestAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAccount" ADD CONSTRAINT "TestAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAccount" ADD CONSTRAINT "TestAccount_credentialSecretId_fkey" FOREIGN KEY ("credentialSecretId") REFERENCES "EncryptedSecret"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyProfile" ADD CONSTRAINT "ProxyProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyProfile" ADD CONSTRAINT "ProxyProfile_credentialSecretId_fkey" FOREIGN KEY ("credentialSecretId") REFERENCES "EncryptedSecret"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncryptedSecret" ADD CONSTRAINT "EncryptedSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_browserProfileId_fkey" FOREIGN KEY ("browserProfileId") REFERENCES "BrowserProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_proxyProfileId_fkey" FOREIGN KEY ("proxyProfileId") REFERENCES "ProxyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_sessionProfileId_fkey" FOREIGN KEY ("sessionProfileId") REFERENCES "SessionProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestBatch" ADD CONSTRAINT "TestBatch_scheduledTaskId_fkey" FOREIGN KEY ("scheduledTaskId") REFERENCES "ScheduledTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TestBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepResult" ADD CONSTRAINT "StepResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_stepResultId_fkey" FOREIGN KEY ("stepResultId") REFERENCES "StepResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
