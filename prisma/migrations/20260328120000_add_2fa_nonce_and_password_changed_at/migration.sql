-- AlterTable: Add server-side 2FA nonce and password change tracking
ALTER TABLE "users" ADD COLUMN "twoFactorNonce" TEXT;
ALTER TABLE "users" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
