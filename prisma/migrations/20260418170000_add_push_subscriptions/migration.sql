CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "userId"          TEXT NOT NULL,
  "endpoint"        TEXT NOT NULL UNIQUE,
  "p256dh"          TEXT NOT NULL,
  "auth"            TEXT NOT NULL,
  "userAgent"       TEXT,
  "lastUsedAt"      TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "push_subs_org_user_idx" ON "push_subscriptions"("organizationId","userId");
