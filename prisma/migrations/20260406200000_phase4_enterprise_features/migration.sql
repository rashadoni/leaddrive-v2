-- Phase 4: Enterprise Features Migration
-- Field Permissions, Sharing Rules, Agent Handoffs, CallLog, SavedReport, Landing Pages
-- Journey branching, AI multi-agent fields

-- Task 1: Field-Level Permissions + Sharing Rules
CREATE TABLE "field_permissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "field_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_permissions_organizationId_roleId_entityType_fieldName_key"
    ON "field_permissions"("organizationId", "roleId", "entityType", "fieldName");
CREATE INDEX "field_permissions_organizationId_roleId_entityType_idx"
    ON "field_permissions"("organizationId", "roleId", "entityType");

ALTER TABLE "field_permissions" ADD CONSTRAINT "field_permissions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sharing_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ruleType" TEXT NOT NULL,
    "sourceRole" TEXT,
    "targetRole" TEXT,
    "accessLevel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sharing_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sharing_rules_organizationId_entityType_idx"
    ON "sharing_rules"("organizationId", "entityType");

ALTER TABLE "sharing_rules" ADD CONSTRAINT "sharing_rules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task 2: Journey Branching + Goals
ALTER TABLE "journey_steps" ADD COLUMN "yesNextStepId" TEXT;
ALTER TABLE "journey_steps" ADD COLUMN "noNextStepId" TEXT;
ALTER TABLE "journey_steps" ADD COLUMN "splitPaths" JSONB;
CREATE INDEX "journey_steps_journeyId_idx" ON "journey_steps"("journeyId");

ALTER TABLE "journeys" ADD COLUMN "goalType" TEXT;
ALTER TABLE "journeys" ADD COLUMN "goalConditions" JSONB;
ALTER TABLE "journeys" ADD COLUMN "goalTarget" INTEGER;
ALTER TABLE "journeys" ADD COLUMN "exitOnGoal" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "journeys" ADD COLUMN "maxEnrollmentDays" INTEGER;

ALTER TABLE "journey_enrollments" ADD COLUMN "goalReachedAt" TIMESTAMP(3);
ALTER TABLE "journey_enrollments" ADD COLUMN "exitReason" TEXT;

-- Task 3: Multi-Agent Orchestration
ALTER TABLE "ai_agent_configs" ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "ai_agent_configs" ADD COLUMN "department" TEXT;
ALTER TABLE "ai_agent_configs" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ai_agent_configs" ADD COLUMN "handoffTargets" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_agent_configs" ADD COLUMN "intents" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "ai_agent_configs" ADD COLUMN "greeting" TEXT;
ALTER TABLE "ai_agent_configs" ADD COLUMN "maxToolRounds" INTEGER NOT NULL DEFAULT 5;

CREATE TABLE "agent_handoffs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "fromAgentId" TEXT NOT NULL,
    "toAgentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "agent_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_handoffs_organizationId_sessionId_idx"
    ON "agent_handoffs"("organizationId", "sessionId");

ALTER TABLE "ai_interaction_logs" ADD COLUMN "agentConfigId" TEXT;
ALTER TABLE "ai_interaction_logs" ADD COLUMN "agentType" TEXT;

-- Task 4: VoIP Integration
CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "callSid" TEXT,
    "direction" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "duration" INTEGER,
    "recordingUrl" TEXT,
    "transcription" TEXT,
    "contactId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "userId" TEXT,
    "activityId" TEXT,
    "notes" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_logs_callSid_key" ON "call_logs"("callSid");
CREATE INDEX "call_logs_organizationId_contactId_idx" ON "call_logs"("organizationId", "contactId");
CREATE INDEX "call_logs_callSid_idx" ON "call_logs"("callSid");

ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Task 5: Custom Report Builder
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '[]',
    "groupBy" TEXT,
    "sortBy" TEXT,
    "sortOrder" TEXT NOT NULL DEFAULT 'desc',
    "chartType" TEXT DEFAULT 'table',
    "chartConfig" JSONB,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "scheduleFreq" TEXT,
    "scheduleEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_reports_organizationId_idx" ON "saved_reports"("organizationId");

ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Task 6: Landing Page Builder
CREATE TABLE "landing_pages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "gjsData" JSONB,
    "htmlContent" TEXT,
    "cssContent" TEXT,
    "formConfig" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalSubmissions" INTEGER NOT NULL DEFAULT 0,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "ogImage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "landing_pages_organizationId_slug_key"
    ON "landing_pages"("organizationId", "slug");
CREATE INDEX "landing_pages_organizationId_idx" ON "landing_pages"("organizationId");

ALTER TABLE "landing_pages" ADD CONSTRAINT "landing_pages_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "visitorIp" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_views_landingPageId_createdAt_idx"
    ON "page_views"("landingPageId", "createdAt");

ALTER TABLE "page_views" ADD CONSTRAINT "page_views_landingPageId_fkey"
    FOREIGN KEY ("landingPageId") REFERENCES "landing_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "landingPageId" TEXT,
    "formData" JSONB NOT NULL,
    "leadId" TEXT,
    "source" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "form_submissions_organizationId_landingPageId_idx"
    ON "form_submissions"("organizationId", "landingPageId");

ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_landingPageId_fkey"
    FOREIGN KEY ("landingPageId") REFERENCES "landing_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
