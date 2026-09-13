-- Durable, payload-free progress for bounded scheduled readers. This table is
-- global like system_job_leases: only guarded operational jobs may use it.
CREATE TABLE "system_job_cursors" (
  "name" TEXT NOT NULL,
  "cursor" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_job_cursors_pkey" PRIMARY KEY ("name")
);

ALTER TABLE "system_job_cursors"
  ADD CONSTRAINT "system_job_cursors_name_nonempty_check"
  CHECK (char_length("name") BETWEEN 1 AND 191);

ALTER TABLE "system_job_cursors"
  ADD CONSTRAINT "system_job_cursors_cursor_bounded_check"
  CHECK ("cursor" IS NULL OR char_length("cursor") BETWEEN 1 AND 512);
