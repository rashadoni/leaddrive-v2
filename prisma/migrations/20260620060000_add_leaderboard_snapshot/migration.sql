-- KPI Arena (Phase D): point-in-time standings snapshots for the agent trend
-- (1h/1d/1m/1y). Append-mostly; one row per org × group × hour-bucket (the id is
-- deterministic `${orgId}:${group}:${YYYY-MM-DDTHH}`, so a double-run upserts).
CREATE TABLE "leaderboard_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "standings" JSONB NOT NULL DEFAULT '[]',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leaderboard_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leaderboard_snapshots_organizationId_group_capturedAt_idx" ON "leaderboard_snapshots"("organizationId", "group", "capturedAt");

ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
