-- CLM Slice 2d-2: add reminder tracking columns to esign_signers
-- Additive only — nullable lastRemindedAt + remindersSent with default 0.

ALTER TABLE "esign_signers"
  ADD COLUMN "lastRemindedAt" TIMESTAMP(3),
  ADD COLUMN "remindersSent"  INTEGER NOT NULL DEFAULT 0;
