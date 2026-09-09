-- Fresh-install compatibility for CRM events. Attribution adds campaignId in
-- the following migration.
CREATE TABLE IF NOT EXISTS "events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'conference',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "location" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "meetingUrl" TEXT,
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxParticipants" INTEGER,
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "attendedCount" INTEGER NOT NULL DEFAULT 0,
    "responsibleId" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "events_organizationId_idx" ON "events"("organizationId");

CREATE TABLE IF NOT EXISTS "event_participants" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'attendee',
    "status" TEXT NOT NULL DEFAULT 'registered',
    "source" TEXT NOT NULL DEFAULT 'invited',
    "invitedAt" TIMESTAMP(3),
    "inviteStatus" TEXT NOT NULL DEFAULT 'not_sent',
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    CONSTRAINT "event_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_participants_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "event_participants_eventId_email_key" ON "event_participants"("eventId", "email");
CREATE INDEX IF NOT EXISTS "event_participants_eventId_idx" ON "event_participants"("eventId");
