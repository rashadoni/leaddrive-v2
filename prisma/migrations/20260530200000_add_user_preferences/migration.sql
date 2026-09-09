-- App Launcher — per-user UI preferences.
--
-- 1-1 with users (keyed on userId), org-scoped via organizationId for
-- tenant-bound cleanup. favorites = ordered nav hrefs (pinned apps);
-- recents = { href, at }[] capped client + server side; data = forward-compat
-- per-user UI bucket so future per-user state doesn't spawn new tables.

CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "favorites" JSONB NOT NULL DEFAULT '[]',
    "recents" JSONB NOT NULL DEFAULT '[]',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

CREATE INDEX "user_preferences_organizationId_idx" ON "user_preferences"("organizationId");

ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
