-- Published non-working days read from the press, one row per country and
-- year (src/lib/mtm/az-calendar-watch.ts). Global like system_job_cursors:
-- public facts only, no tenant or employee data, so no organization column
-- and no RLS. An organization's calendar changes only when its admin adds them.
CREATE TABLE "public_calendar_findings" (
  "id" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "foundAt" TIMESTAMP(3),
  "sourceUrl" TEXT,
  "sourceTitle" TEXT,
  "publishedOn" TEXT,
  "decision" TEXT,
  "fingerprint" TEXT,
  "holidays" JSONB,
  "movedFiveDay" JSONB,
  "movedSixDay" JSONB,
  "notifiedFingerprint" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "public_calendar_findings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "public_calendar_findings_country_year_key" ON "public_calendar_findings"("country", "year");

ALTER TABLE "public_calendar_findings"
  ADD CONSTRAINT "public_calendar_findings_state_check" CHECK ("state" IN ('NONE', 'PARSED', 'UNREADABLE'));
