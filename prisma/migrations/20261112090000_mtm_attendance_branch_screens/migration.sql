-- Branch QR is shown only by a screen paired to the branch (owner, 2026-10-29:
-- a QR opened on any signed-in computer confirmed a branch the phone was not
-- at), and a QR whose phone's own fix is plainly outside the branch confirms
-- nothing (AWAY_FROM_BRANCH).
SET lock_timeout='3s';

CREATE TABLE mtm_attendance_branch_screens (
 id TEXT PRIMARY KEY,
 "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 "branchId" TEXT NOT NULL,
 "codeHash" VARCHAR(64) UNIQUE CHECK ("codeHash" ~ '^[a-f0-9]{64}$'),
 "codeExpiresAt" TIMESTAMP(3),
 "secretHash" VARCHAR(64) UNIQUE CHECK ("secretHash" ~ '^[a-f0-9]{64}$'),
 "pairedAt" TIMESTAMP(3),
 "lastSeenAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 "revokedBy" TEXT,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("organizationId","branchId") REFERENCES mtm_attendance_branches("organizationId",id) ON DELETE RESTRICT,
 UNIQUE ("organizationId",id),
 -- Waiting for its code, or paired: never both, never neither.
 CHECK (("codeHash" IS NOT NULL AND "codeExpiresAt" IS NOT NULL AND "secretHash" IS NULL AND "pairedAt" IS NULL)
   OR ("codeHash" IS NULL AND "secretHash" IS NOT NULL AND "pairedAt" IS NOT NULL)),
 CHECK (("revokedAt" IS NULL) = ("revokedBy" IS NULL))
);
CREATE INDEX mtm_attendance_branch_screens_org_branch_idx ON mtm_attendance_branch_screens("organizationId","branchId","createdAt");
ALTER TABLE "mtm_attendance_branch_screens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mtm_attendance_branch_screens" FORCE ROW LEVEL SECURITY;
-- The screen knows only its secret (or the code typed into it): that one
-- lookup by hash runs under the bypass; everything after it, in the tenant.
CREATE POLICY "tenant_isolation" ON "mtm_attendance_branch_screens"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');

-- QR evidence: a fifth outcome that keeps which branch's QR it was and its
-- nonce (so the code still cannot be reused), with the distance.
DO $$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='mtm_attendance_qr_evidence'::regclass AND contype='c'
   AND pg_get_constraintdef(oid) LIKE '%VERIFIED%' LOOP
  EXECUTE format('ALTER TABLE mtm_attendance_qr_evidence DROP CONSTRAINT %I', c.conname);
 END LOOP;
END $$;
ALTER TABLE mtm_attendance_qr_evidence ADD COLUMN "awayDistanceMeters" INTEGER;
ALTER TABLE mtm_attendance_qr_evidence ADD CONSTRAINT mtm_attendance_qr_evidence_state_check
 CHECK (state IN ('VERIFIED','NOT_PROVIDED','EXPIRED','INVALID','BRANCH_CHANGED','REUSED','AWAY_FROM_BRANCH'));
ALTER TABLE mtm_attendance_qr_evidence ADD CONSTRAINT mtm_attendance_qr_evidence_proof_check
 CHECK ((state IN ('VERIFIED','AWAY_FROM_BRANCH') AND "branchRevisionId" IS NOT NULL AND "nonceFingerprint" IS NOT NULL AND "nonceFingerprint" ~ '^[a-f0-9]{64}$')
   OR (state NOT IN ('VERIFIED','AWAY_FROM_BRANCH') AND "branchRevisionId" IS NULL AND "nonceFingerprint" IS NULL));
ALTER TABLE mtm_attendance_qr_evidence ADD CONSTRAINT mtm_attendance_qr_evidence_away_check
 CHECK ((state='AWAY_FROM_BRANCH') = ("awayDistanceMeters" IS NOT NULL) AND ("awayDistanceMeters" IS NULL OR "awayDistanceMeters" >= 0));
