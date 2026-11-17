-- What the customer agreed to change and who confirmed it (docs/sales-procurement/README.md, task 5.2).

-- CreateTable
CREATE TABLE "deal_change_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT NOT NULL,
    "approvedByName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "note" TEXT,
    "fileId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_change_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_change_approvals_organizationId_dealId_approvedAt_idx" ON "deal_change_approvals"("organizationId", "dealId", "approvedAt");

-- AddForeignKey
ALTER TABLE "deal_change_approvals" ADD CONSTRAINT "deal_change_approvals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_change_approvals" ADD CONSTRAINT "deal_change_approvals_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_change_approvals" ADD CONSTRAINT "deal_change_approvals_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "deal_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "deal_change_approvals" ADD CONSTRAINT "deal_change_approvals_kind_check"
  CHECK ("kind" IN ('layout', 'size', 'quantity', 'price', 'deadline', 'other'));
ALTER TABLE "deal_change_approvals" ADD CONSTRAINT "deal_change_approvals_channel_check"
  CHECK ("channel" IN ('email', 'whatsapp', 'phone', 'meeting', 'other'));
ALTER TABLE "deal_change_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_change_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_change_approvals"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
