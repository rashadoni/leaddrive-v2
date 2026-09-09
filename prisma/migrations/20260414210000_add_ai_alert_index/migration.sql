-- CreateIndex
CREATE INDEX "ai_alerts_organizationId_type_createdAt_idx" ON "ai_alerts"("organizationId", "type", "createdAt");
