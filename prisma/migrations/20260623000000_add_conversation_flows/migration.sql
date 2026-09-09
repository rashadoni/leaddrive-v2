-- E1 (Conversation Automation Engine) data layer. Additive + DARK: no runner or event
-- wiring reads these yet (E1.1c), so creating the tables triggers nothing live.
CREATE TABLE "conversation_flows" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "trigger" TEXT NOT NULL DEFAULT 'conversation_opened',
    "channelTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "graph" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversation_flows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_flow_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentNodeId" TEXT,
    "state" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversation_flow_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_flows_organizationId_idx" ON "conversation_flows"("organizationId");
CREATE INDEX "conversation_flows_organizationId_status_trigger_idx" ON "conversation_flows"("organizationId", "status", "trigger");
CREATE INDEX "conversation_flow_runs_organizationId_idx" ON "conversation_flow_runs"("organizationId");
CREATE INDEX "conversation_flow_runs_flowId_idx" ON "conversation_flow_runs"("flowId");
CREATE INDEX "conversation_flow_runs_organizationId_conversationId_idx" ON "conversation_flow_runs"("organizationId", "conversationId");

ALTER TABLE "conversation_flows" ADD CONSTRAINT "conversation_flows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_flow_runs" ADD CONSTRAINT "conversation_flow_runs_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "conversation_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
