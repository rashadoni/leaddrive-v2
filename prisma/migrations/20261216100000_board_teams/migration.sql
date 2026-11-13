-- Teams of the boards — Bordio's «Teams & Users» (owner, 2026-11-13: «нужно
-- добавить раздел teams and users с тем же функционалом»); see schema.prisma
-- BoardTeam / BoardTeamMember. A person is in one team, as its leader or a
-- member. Tenant tables under FORCE ROW LEVEL SECURITY.
CREATE TABLE "board_teams" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_teams_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_teams_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "board_teams_organizationId_name_key" ON "board_teams"("organizationId", "name");

CREATE TABLE "board_team_members" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "board_team_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_team_members_role_check" CHECK ("role" IN ('leader', 'member')),
  CONSTRAINT "board_team_members_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "board_team_members_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "board_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "board_team_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- One team per person.
CREATE UNIQUE INDEX "board_team_members_userId_key" ON "board_team_members"("userId");
CREATE INDEX "board_team_members_organizationId_teamId_idx" ON "board_team_members"("organizationId", "teamId");

ALTER TABLE "board_teams" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_teams" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_teams"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

ALTER TABLE "board_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_team_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_team_members"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
