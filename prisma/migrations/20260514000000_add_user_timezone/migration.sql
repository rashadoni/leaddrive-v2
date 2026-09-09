-- P5 Time zones per user (Phase 1 roadmap slice 1).
-- Adds optional IANA timezone preference on User.
-- Null = fall back to org default → server UTC.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "timezone" TEXT;
