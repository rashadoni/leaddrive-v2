-- One master charges forty for a haircut and takes an hour, another charges
-- twenty-five and takes forty minutes. The difference lives on the service, in
-- one nullable column: a service where everybody agrees stores nothing, and a
-- release that does not know this column keeps serving every existing page.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "hostVariants" JSONB;
