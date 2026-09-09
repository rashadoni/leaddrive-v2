-- Phase 1 T1/T2: Skill-based Routing + SLA Auto-Escalation
-- Add skill routing fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "skills" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "maxTickets" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- Create ticket_queues table
CREATE TABLE IF NOT EXISTS "ticket_queues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "skills" TEXT[] NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "autoAssign" BOOLEAN NOT NULL DEFAULT true,
    "assignMethod" TEXT NOT NULL DEFAULT 'least_loaded',
    "lastAssignedTo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_queues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ticket_queues_organizationId_idx" ON "ticket_queues"("organizationId");

-- Create escalation_rules table
CREATE TABLE IF NOT EXISTS "escalation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerMinutes" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "escalation_rules_organizationId_idx" ON "escalation_rules"("organizationId");

-- Add escalation fields to tickets
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "escalationLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "lastEscalatedAt" TIMESTAMP(3);
