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
