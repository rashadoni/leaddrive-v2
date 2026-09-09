-- Slice 3 (native loyalty app push): per-device Expo push tokens for a member.
-- The app registers its ExponentPushToken after sign-in; the loyalty earn hooks
-- send a notification to these. Additive, defaulted to empty — no backfill.
ALTER TABLE "contacts" ADD COLUMN "expoPushTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
