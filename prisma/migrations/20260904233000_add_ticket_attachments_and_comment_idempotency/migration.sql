-- AlterTable
ALTER TABLE "ticket_comments" ADD COLUMN "clientRequestId" TEXT;

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "commentId" TEXT,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_comments_ticketId_clientRequestId_key" ON "ticket_comments"("ticketId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_attachments_organizationId_fileName_key" ON "ticket_attachments"("organizationId", "fileName");

-- CreateIndex
CREATE INDEX "ticket_attachments_ticketId_idx" ON "ticket_attachments"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_attachments_commentId_idx" ON "ticket_attachments"("commentId");

-- CreateIndex
CREATE INDEX "ticket_attachments_organizationId_ticketId_commentId_idx" ON "ticket_attachments"("organizationId", "ticketId", "commentId");

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "ticket_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
