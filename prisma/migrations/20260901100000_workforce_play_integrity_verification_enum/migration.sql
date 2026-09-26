-- Add the append-only ledger method separately from its constraint migration.
-- PostgreSQL does not permit a newly added enum label in an immediately
-- following constraint in the same transaction, so Prisma must apply this
-- transaction before the contract that uses PLAY_INTEGRITY.
SET lock_timeout = '3s';

ALTER TYPE "WorkforceAttendanceVerificationMethod"
  ADD VALUE IF NOT EXISTS 'PLAY_INTEGRITY';
