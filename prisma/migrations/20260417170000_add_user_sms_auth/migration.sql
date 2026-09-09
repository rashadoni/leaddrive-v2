-- AlterTable
ALTER TABLE "users" ADD COLUMN "smsAuthEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "verifiedPhone" TEXT;
