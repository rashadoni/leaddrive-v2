-- AlterTable
ALTER TABLE "otp_codes" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "otp_codes_userId_purpose_idx" ON "otp_codes"("userId", "purpose");
