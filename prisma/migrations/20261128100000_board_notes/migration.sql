-- «Qeydlər» on a board — Bordio's Notes tool (owner, 2026-11-06); see
-- schema.prisma BoardNote. Tenant table under FORCE ROW LEVEL SECURITY.
CREATE TABLE "board_notes" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "divisionId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "board_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_notes_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "board_notes_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "board_notes_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "board_notes_organizationId_divisionId_updatedAt_idx"
  ON "board_notes"("organizationId", "divisionId", "updatedAt");

ALTER TABLE "board_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "board_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "board_notes"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
