-- Files of a customer order: layout, PDF, photo (docs/sales-procurement/README.md, task 4.1).

-- CreateTable
CREATE TABLE "deal_files" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "note" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_files_organizationId_dealId_idx" ON "deal_files"("organizationId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_files_organizationId_fileName_key" ON "deal_files"("organizationId", "fileName");

-- AddForeignKey
ALTER TABLE "deal_files" ADD CONSTRAINT "deal_files_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_files" ADD CONSTRAINT "deal_files_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "deal_files" ADD CONSTRAINT "deal_files_size_check" CHECK ("fileSize" >= 0);
ALTER TABLE "deal_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_files"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');
