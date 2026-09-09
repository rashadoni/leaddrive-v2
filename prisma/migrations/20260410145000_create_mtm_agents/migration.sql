-- Fresh-install compatibility for the MTM agent table. Deployed databases
-- already had this schema from the historical bootstrap/db-push path, while
-- the next migration assumes the table exists and adds passwordHash.
DO $$ BEGIN
    CREATE TYPE "MtmAgentRole" AS ENUM ('ADMIN', 'MANAGER', 'SUPERVISOR', 'AGENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TYPE "MtmAgentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "mtm_agents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "MtmAgentRole" NOT NULL DEFAULT 'AGENT',
    "status" "MtmAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatar" TEXT,
    "teamId" TEXT,
    "managerId" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mtm_agents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mtm_agents_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mtm_agents_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "mtm_agents_managerId_fkey"
        FOREIGN KEY ("managerId") REFERENCES "mtm_agents"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "mtm_agents_organizationId_email_key"
    ON "mtm_agents"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "mtm_agents_organizationId_idx"
    ON "mtm_agents"("organizationId");
CREATE INDEX IF NOT EXISTS "mtm_agents_userId_idx"
    ON "mtm_agents"("userId");
CREATE INDEX IF NOT EXISTS "mtm_agents_managerId_idx"
    ON "mtm_agents"("managerId");
