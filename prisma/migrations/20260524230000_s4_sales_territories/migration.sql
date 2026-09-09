-- Migration: 20260524230000_s4_sales_territories
--
-- S4 Sales Territories slice-1.
--
-- Adds two new tables:
--   territories         — named sales regions with optional auto-assignment rules
--   territory_memberships — pivot: which users belong to which territory
--
-- Safe:
--   • Both tables are new — no existing data affected.
--   • rules column defaults to '{}' (empty JSON = match-all / disabled).
--   • CASCADE deletes propagate correctly: deleting an org removes territories;
--     deleting a territory removes memberships; deleting a user removes memberships.

-- S4: Territory
CREATE TABLE "territories" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "description"    TEXT,
  "isActive"       BOOLEAN      NOT NULL DEFAULT true,
  "rules"          JSONB        NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "territories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "territories_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "territories_organizationId_idx"        ON "territories"("organizationId");
CREATE INDEX "territories_organizationId_isActive_idx" ON "territories"("organizationId", "isActive");

-- S4: TerritoryMembership
CREATE TABLE "territory_memberships" (
  "id"          TEXT         NOT NULL,
  "territoryId" TEXT         NOT NULL,
  "userId"      TEXT         NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "territory_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "territory_memberships_territoryId_fkey"
    FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "territory_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "territory_memberships_territoryId_userId_key"
    UNIQUE ("territoryId", "userId")
);

CREATE INDEX "territory_memberships_territoryId_idx" ON "territory_memberships"("territoryId");
CREATE INDEX "territory_memberships_userId_idx"      ON "territory_memberships"("userId");
