-- Mobile communications, private documents, and HRM requests.
-- All write paths are tenant-scoped and carry durable client identifiers so
-- an offline replay cannot create duplicate messages, files, receipts, or requests.

CREATE TYPE "MtmMessageThreadType" AS ENUM (
  'DIRECT',
  'BROADCAST',
  'SYSTEM'
);

CREATE TYPE "MtmMessageReceiptType" AS ENUM (
  'READ',
  'ACKNOWLEDGED'
);

CREATE TYPE "MtmHrmRequestType" AS ENUM (
  'LEAVE',
  'ABSENCE',
  'TIME_CORRECTION'
);

CREATE TYPE "MtmHrmRequestStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

CREATE TABLE "mtm_message_threads" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "type" "MtmMessageThreadType" NOT NULL DEFAULT 'DIRECT',
  "subject" TEXT,
  "directKey" TEXT,
  "createdByAgentId" TEXT,
  "createdByUserId" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_message_threads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_message_threads_subject_check"
    CHECK ("subject" IS NULL OR char_length(btrim("subject")) BETWEEN 1 AND 200),
  CONSTRAINT "mtm_message_threads_direct_key_check"
    CHECK ("directKey" IS NULL OR char_length("directKey") BETWEEN 3 AND 257),
  CONSTRAINT "mtm_message_threads_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_message_threads_createdByAgentId_fkey"
    FOREIGN KEY ("createdByAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "mtm_message_participants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReadAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_message_participants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_message_participants_role_check"
    CHECK ("role" IN ('OWNER', 'MEMBER')),
  CONSTRAINT "mtm_message_participants_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_message_participants_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "mtm_message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_message_participants_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mtm_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clientDocumentId" TEXT,
  "title" TEXT,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "checksumSha256" TEXT,
  "uploadedByAgentId" TEXT,
  "uploadedByUserId" TEXT,
  "visitId" TEXT,
  "taskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),

  CONSTRAINT "mtm_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_documents_client_id_check"
    CHECK ("clientDocumentId" IS NULL OR char_length("clientDocumentId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_documents_title_check"
    CHECK ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "mtm_documents_file_name_check"
    CHECK (char_length(btrim("fileName")) BETWEEN 1 AND 240),
  CONSTRAINT "mtm_documents_mime_check"
    CHECK (char_length(btrim("mimeType")) BETWEEN 3 AND 120),
  CONSTRAINT "mtm_documents_size_check"
    CHECK ("sizeBytes" BETWEEN 1 AND 26214400),
  CONSTRAINT "mtm_documents_storage_key_check"
    CHECK (char_length("storageKey") BETWEEN 32 AND 96 AND position('/' in "storageKey") = 0 AND position('..' in "storageKey") = 0),
  CONSTRAINT "mtm_documents_checksum_check"
    CHECK ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "mtm_documents_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_documents_uploadedByAgentId_fkey"
    FOREIGN KEY ("uploadedByAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_documents_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "mtm_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_documents_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "mtm_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "mtm_document_assignments" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "assignedByUserId" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_document_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_document_assignments_expiry_check"
    CHECK ("expiresAt" IS NULL OR "expiresAt" >= "assignedAt"),
  CONSTRAINT "mtm_document_assignments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_document_assignments_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "mtm_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_document_assignments_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mtm_messages" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "senderAgentId" TEXT,
  "senderUserId" TEXT,
  "senderName" TEXT NOT NULL,
  "clientMessageId" TEXT,
  "body" TEXT,
  "attachmentDocumentId" TEXT,
  "acknowledgementRequired" BOOLEAN NOT NULL DEFAULT false,
  "sentAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_messages_sender_check"
    CHECK ("senderAgentId" IS NOT NULL OR "senderUserId" IS NOT NULL),
  CONSTRAINT "mtm_messages_sender_name_check"
    CHECK (char_length(btrim("senderName")) BETWEEN 1 AND 160),
  CONSTRAINT "mtm_messages_client_id_check"
    CHECK ("clientMessageId" IS NULL OR char_length("clientMessageId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_messages_content_check"
    CHECK (("body" IS NOT NULL AND char_length(btrim("body")) BETWEEN 1 AND 4000) OR "attachmentDocumentId" IS NOT NULL),
  CONSTRAINT "mtm_messages_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "mtm_message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_messages_senderAgentId_fkey"
    FOREIGN KEY ("senderAgentId") REFERENCES "mtm_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "mtm_messages_attachmentDocumentId_fkey"
    FOREIGN KEY ("attachmentDocumentId") REFERENCES "mtm_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "mtm_message_receipts" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "type" "MtmMessageReceiptType" NOT NULL,
  "clientReceiptId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mtm_message_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_message_receipts_client_id_check"
    CHECK ("clientReceiptId" IS NULL OR char_length("clientReceiptId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_message_receipts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_message_receipts_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "mtm_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_message_receipts_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "mtm_hrm_requests" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "type" "MtmHrmRequestType" NOT NULL,
  "status" "MtmHrmRequestStatus" NOT NULL DEFAULT 'PENDING',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "correctionWorkdayId" TEXT,
  "requestedStartAt" TIMESTAMP(3),
  "requestedEndAt" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "decisionNote" TEXT,
  "decidedByUserId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mtm_hrm_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mtm_hrm_requests_client_id_check"
    CHECK (char_length("clientRequestId") BETWEEN 8 AND 128),
  CONSTRAINT "mtm_hrm_requests_dates_check"
    CHECK ("endDate" >= "startDate" AND "endDate" <= "startDate" + INTERVAL '366 days'),
  CONSTRAINT "mtm_hrm_requests_reason_check"
    CHECK (char_length(btrim("reason")) BETWEEN 3 AND 1000),
  CONSTRAINT "mtm_hrm_requests_correction_check"
    CHECK (
      "type" <> 'TIME_CORRECTION'
      OR (
        "correctionWorkdayId" IS NOT NULL
        AND ("requestedStartAt" IS NOT NULL OR "requestedEndAt" IS NOT NULL)
      )
    ),
  CONSTRAINT "mtm_hrm_requests_decision_note_check"
    CHECK ("decisionNote" IS NULL OR char_length(btrim("decisionNote")) BETWEEN 1 AND 1000),
  CONSTRAINT "mtm_hrm_requests_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_hrm_requests_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "mtm_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "mtm_hrm_requests_correctionWorkdayId_fkey"
    FOREIGN KEY ("correctionWorkdayId") REFERENCES "mtm_agent_workdays"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "mtm_message_participants_threadId_agentId_key"
  ON "mtm_message_participants"("threadId", "agentId");
CREATE UNIQUE INDEX "mtm_message_threads_organizationId_directKey_key"
  ON "mtm_message_threads"("organizationId", "directKey");
CREATE INDEX "mtm_message_threads_organizationId_lastMessageAt_idx"
  ON "mtm_message_threads"("organizationId", "lastMessageAt");
CREATE INDEX "mtm_message_threads_createdByAgentId_idx"
  ON "mtm_message_threads"("createdByAgentId");
CREATE INDEX "mtm_message_participants_organizationId_agentId_archivedAt_idx"
  ON "mtm_message_participants"("organizationId", "agentId", "archivedAt");

CREATE UNIQUE INDEX "mtm_documents_organizationId_clientDocumentId_key"
  ON "mtm_documents"("organizationId", "clientDocumentId");
CREATE UNIQUE INDEX "mtm_documents_organizationId_storageKey_key"
  ON "mtm_documents"("organizationId", "storageKey");
CREATE INDEX "mtm_documents_organizationId_createdAt_idx"
  ON "mtm_documents"("organizationId", "createdAt");
CREATE INDEX "mtm_documents_uploadedByAgentId_idx" ON "mtm_documents"("uploadedByAgentId");
CREATE INDEX "mtm_documents_visitId_idx" ON "mtm_documents"("visitId");
CREATE INDEX "mtm_documents_taskId_idx" ON "mtm_documents"("taskId");

CREATE UNIQUE INDEX "mtm_document_assignments_documentId_agentId_key"
  ON "mtm_document_assignments"("documentId", "agentId");
CREATE INDEX "mtm_document_assignments_organizationId_agentId_assignedAt_idx"
  ON "mtm_document_assignments"("organizationId", "agentId", "assignedAt");

CREATE UNIQUE INDEX "mtm_messages_organizationId_senderAgentId_clientMessageId_key"
  ON "mtm_messages"("organizationId", "senderAgentId", "clientMessageId");
CREATE INDEX "mtm_messages_organizationId_threadId_sentAt_idx"
  ON "mtm_messages"("organizationId", "threadId", "sentAt");
CREATE INDEX "mtm_messages_attachmentDocumentId_idx" ON "mtm_messages"("attachmentDocumentId");

CREATE UNIQUE INDEX "mtm_message_receipts_messageId_agentId_type_key"
  ON "mtm_message_receipts"("messageId", "agentId", "type");
CREATE UNIQUE INDEX "mtm_message_receipts_organizationId_agentId_clientReceiptId_key"
  ON "mtm_message_receipts"("organizationId", "agentId", "clientReceiptId");
CREATE INDEX "mtm_message_receipts_organizationId_agentId_occurredAt_idx"
  ON "mtm_message_receipts"("organizationId", "agentId", "occurredAt");

CREATE UNIQUE INDEX "mtm_hrm_requests_organizationId_agentId_clientRequestId_key"
  ON "mtm_hrm_requests"("organizationId", "agentId", "clientRequestId");
CREATE INDEX "mtm_hrm_requests_organizationId_agentId_startDate_idx"
  ON "mtm_hrm_requests"("organizationId", "agentId", "startDate");
CREATE INDEX "mtm_hrm_requests_organizationId_status_submittedAt_idx"
  ON "mtm_hrm_requests"("organizationId", "status", "submittedAt");
CREATE INDEX "mtm_hrm_requests_correctionWorkdayId_idx"
  ON "mtm_hrm_requests"("correctionWorkdayId");

ALTER TABLE "mtm_message_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_threads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_message_threads_tenant_isolation" ON "mtm_message_threads"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_message_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_participants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_message_participants_tenant_isolation" ON "mtm_message_participants"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_documents_tenant_isolation" ON "mtm_documents"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_document_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_document_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_document_assignments_tenant_isolation" ON "mtm_document_assignments"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_messages_tenant_isolation" ON "mtm_messages"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_message_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_message_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_message_receipts_tenant_isolation" ON "mtm_message_receipts"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));

ALTER TABLE "mtm_hrm_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_hrm_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mtm_hrm_requests_tenant_isolation" ON "mtm_hrm_requests"
  USING ("organizationId" = current_setting('app.org_id', true))
  WITH CHECK ("organizationId" = current_setting('app.org_id', true));
