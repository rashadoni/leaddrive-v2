SET lock_timeout = '3s';
ALTER TYPE "MtmAgentRole" ADD VALUE IF NOT EXISTS 'EMPLOYEE';
ALTER TABLE "mtm_agents" ADD COLUMN "attendanceParticipant" BOOLEAN NOT NULL DEFAULT false;
