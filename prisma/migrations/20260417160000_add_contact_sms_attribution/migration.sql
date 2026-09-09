-- AlterTable
ALTER TABLE "contacts" ADD COLUMN "lastSmsCampaignId" TEXT;
ALTER TABLE "contacts" ADD COLUMN "lastSmsAt" TIMESTAMP(3);

-- CreateIndex — enables efficient segmentation by "received SMS campaign X"
CREATE INDEX "contacts_lastSmsCampaignId_idx" ON "contacts"("lastSmsCampaignId");
CREATE INDEX "contacts_lastSmsAt_idx" ON "contacts"("lastSmsAt");
