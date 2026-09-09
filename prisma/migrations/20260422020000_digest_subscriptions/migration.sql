-- Per-user digest subscriptions — replaces the hardcoded
-- "send daily briefing to all admin/manager users" logic with explicit
-- opt-in per user + digest type + channel set.

CREATE TABLE "digest_subscriptions" (
  "id"             TEXT        NOT NULL,
  "organizationId" TEXT        NOT NULL,
  "userId"         TEXT        NOT NULL,
  "type"           TEXT        NOT NULL,
  "frequency"      TEXT        NOT NULL DEFAULT 'daily',
  "channels"       TEXT[]      DEFAULT ARRAY['email','in_app']::TEXT[],
  "timeOfDay"      TEXT,
  "dayOfWeek"      INTEGER,
  "dayOfMonth"     INTEGER,
  "lastSentAt"     TIMESTAMP(3),
  "isActive"       BOOLEAN     NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "digest_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "digest_subscriptions_organizationId_userId_type_key"
  ON "digest_subscriptions"("organizationId","userId","type");

CREATE INDEX "digest_subscriptions_organizationId_type_isActive_idx"
  ON "digest_subscriptions"("organizationId","type","isActive");

CREATE INDEX "digest_subscriptions_organizationId_userId_idx"
  ON "digest_subscriptions"("organizationId","userId");

ALTER TABLE "digest_subscriptions"
  ADD CONSTRAINT "digest_subscriptions_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "digest_subscriptions"
  ADD CONSTRAINT "digest_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
