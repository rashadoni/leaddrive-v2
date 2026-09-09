-- AddForeignKey (OtpCode.userId → users.id, cascade on user delete)
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "applied_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "applied_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "applied_templates_organizationId_templateId_idx" ON "applied_templates"("organizationId", "templateId");
