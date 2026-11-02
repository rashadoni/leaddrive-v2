-- A branch screen shows a code only while it stands at its branch (owner,
-- 2026-10-30: a laptop paired at home showed the branch's code at home). The
-- screen's last verdict is kept for the settings page; its coordinates never.
SET lock_timeout='3s';

ALTER TABLE mtm_attendance_branch_screens
  ADD COLUMN "placeState" VARCHAR(16),
  ADD COLUMN "placeDistanceMeters" INTEGER,
  ADD COLUMN "placeCheckedAt" TIMESTAMP(3),
  ADD CONSTRAINT mtm_attendance_branch_screens_place_check CHECK (
    ("placeState" IS NULL AND "placeDistanceMeters" IS NULL AND "placeCheckedAt" IS NULL)
    OR ("placeState" = 'NO_FIX' AND "placeDistanceMeters" IS NULL AND "placeCheckedAt" IS NOT NULL)
    OR ("placeState" IN ('AT_BRANCH','AWAY') AND "placeDistanceMeters" >= 0 AND "placeCheckedAt" IS NOT NULL)
  );

-- A code shown over a video call reaches a phone anywhere (owner, 2026-10-30):
-- while the organization collects the place of a mark, a good code without a
-- fresh, precise fix of the phone at that branch confirms nothing. Like
-- AWAY_FROM_BRANCH it keeps the code's branch and nonce, so it cannot be reused.
ALTER TABLE mtm_attendance_qr_evidence DROP CONSTRAINT mtm_attendance_qr_evidence_state_check;
ALTER TABLE mtm_attendance_qr_evidence DROP CONSTRAINT mtm_attendance_qr_evidence_proof_check;
ALTER TABLE mtm_attendance_qr_evidence ADD CONSTRAINT mtm_attendance_qr_evidence_state_check
 CHECK (state IN ('VERIFIED','NOT_PROVIDED','EXPIRED','INVALID','BRANCH_CHANGED','REUSED','AWAY_FROM_BRANCH','NO_PHONE_FIX'));
ALTER TABLE mtm_attendance_qr_evidence ADD CONSTRAINT mtm_attendance_qr_evidence_proof_check
 CHECK ((state IN ('VERIFIED','AWAY_FROM_BRANCH','NO_PHONE_FIX') AND "branchRevisionId" IS NOT NULL AND "nonceFingerprint" IS NOT NULL AND "nonceFingerprint" ~ '^[a-f0-9]{64}$')
   OR (state NOT IN ('VERIFIED','AWAY_FROM_BRANCH','NO_PHONE_FIX') AND "branchRevisionId" IS NULL AND "nonceFingerprint" IS NULL));
