-- Phase 5: team folders for the inbox + a folder reference on conversations.

-- CreateTable
CREATE TABLE "inbox_folders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbox_folders_organizationId_sortOrder_idx" ON "inbox_folders"("organizationId", "sortOrder");

-- AlterTable: conversation folder reference (no FK — orphaned ref = "no folder")
ALTER TABLE "social_conversations" ADD COLUMN "folderId" TEXT;
