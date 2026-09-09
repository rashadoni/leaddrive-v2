-- S3: Sales Sequences / Cadences
-- CreateTable: SalesSequence
CREATE TABLE "sales_sequences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SequenceStep
CREATE TABLE "sequence_steps" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "subject" TEXT,
    "body" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SequenceEnrollment
CREATE TABLE "sequence_enrollments" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "enrolledBy" TEXT,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "nextStepAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sequence_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_sequences_organizationId_idx" ON "sales_sequences"("organizationId");
CREATE INDEX "sales_sequences_organizationId_isActive_idx" ON "sales_sequences"("organizationId", "isActive");

CREATE INDEX "sequence_steps_sequenceId_idx" ON "sequence_steps"("sequenceId");
CREATE INDEX "sequence_steps_organizationId_idx" ON "sequence_steps"("organizationId");

CREATE UNIQUE INDEX "sequence_enrollments_sequenceId_entityType_entityId_key" ON "sequence_enrollments"("sequenceId", "entityType", "entityId");
CREATE INDEX "sequence_enrollments_organizationId_idx" ON "sequence_enrollments"("organizationId");
CREATE INDEX "sequence_enrollments_sequenceId_idx" ON "sequence_enrollments"("sequenceId");
CREATE INDEX "sequence_enrollments_organizationId_entityType_entityId_idx" ON "sequence_enrollments"("organizationId", "entityType", "entityId");
CREATE INDEX "sequence_enrollments_status_nextStepAt_idx" ON "sequence_enrollments"("status", "nextStepAt");

-- AddForeignKey
ALTER TABLE "sales_sequences" ADD CONSTRAINT "sales_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_sequences" ADD CONSTRAINT "sales_sequences_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sales_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "sales_sequences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_enrolledBy_fkey" FOREIGN KEY ("enrolledBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
