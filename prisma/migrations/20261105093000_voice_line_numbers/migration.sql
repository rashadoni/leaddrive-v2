-- The phone numbers clients' calls arrive on: number -> organization. A
-- superadmin assigns them; the PBX callbacks find the organization of a call
-- by the number dialled (under the RLS bypass, by number only).
CREATE TABLE "voice_line_numbers" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "channelConfigId" TEXT,
  "e164" TEXT NOT NULL,
  "label" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "voice_line_numbers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_line_numbers_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "voice_line_numbers_e164_check" CHECK ("e164" ~ '^\+[1-9][0-9]{7,14}$')
);
CREATE UNIQUE INDEX "voice_line_numbers_e164_key" ON "voice_line_numbers"("e164");
CREATE INDEX "voice_line_numbers_organizationId_idx" ON "voice_line_numbers"("organizationId");

ALTER TABLE "voice_line_numbers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voice_line_numbers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "voice_line_numbers"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
