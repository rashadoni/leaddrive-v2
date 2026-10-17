-- Disposable integration database ONLY. The three actual migrations supply
-- all event/Fund/replay tables, hashes, RLS, guards and deferred constraints.
-- These are the legacy anchors from test-event-platform-migrations.mjs, not a
-- hand-written replacement for the event-platform migration chain.
CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE _prisma_migrations (
  migration_name TEXT PRIMARY KEY, finished_at TIMESTAMPTZ, rolled_back_at TIMESTAMPTZ
);
CREATE TABLE funds (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  name TEXT NOT NULL, description TEXT, currency TEXT NOT NULL DEFAULT 'AZN',
  "targetAmount" DOUBLE PRECISION, "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
  color TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE fund_transactions (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "fundId" TEXT NOT NULL REFERENCES funds(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, description TEXT,
  "relatedType" TEXT, "relatedId" TEXT, "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO _prisma_migrations (migration_name, finished_at) VALUES
  ('20260901090000_event_platform_foundation', CURRENT_TIMESTAMP),
  ('20260901100000_fund_event_source_pilot', CURRENT_TIMESTAMP);
