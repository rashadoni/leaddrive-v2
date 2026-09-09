-- E3.1 (respond.io gap-closer): canned/saved replies for the inbox composer.
-- Org-shared snippet library inserted via a "/shortcut" typeahead; {{var}} substitution
-- happens client-side at insert-time. Distinct from ticket_macros (action-based).
CREATE TABLE "message_snippets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channelTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "message_snippets_pkey" PRIMARY KEY ("id")
);

-- One shortcut per org (the "/greeting" typeahead key must be unambiguous).
CREATE UNIQUE INDEX "message_snippets_organizationId_shortcut_key" ON "message_snippets"("organizationId", "shortcut");

CREATE INDEX "message_snippets_organizationId_idx" ON "message_snippets"("organizationId");

ALTER TABLE "message_snippets" ADD CONSTRAINT "message_snippets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
