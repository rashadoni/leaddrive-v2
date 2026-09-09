CREATE TABLE "advisor_signal_snapshots" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "snapshotKey" TEXT NOT NULL,
  "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalSignals" INTEGER NOT NULL DEFAULT 0,
  "criticalCount" INTEGER NOT NULL DEFAULT 0,
  "highCount" INTEGER NOT NULL DEFAULT 0,
  "moneyAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "signalIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "domainCounts" JSONB NOT NULL DEFAULT '{}',
  "ownerCounts" JSONB NOT NULL DEFAULT '{}',
  "overview" JSONB NOT NULL DEFAULT '{}',
  "signals" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "advisor_signal_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advisor_signal_snapshots_organizationId_snapshotKey_key"
  ON "advisor_signal_snapshots"("organizationId", "snapshotKey");

CREATE INDEX "advisor_signal_snapshots_organizationId_snapshotAt_idx"
  ON "advisor_signal_snapshots"("organizationId", "snapshotAt");
