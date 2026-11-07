-- A salon sells the cut and the treatment that goes with it. The extras live
-- on the service, in one nullable column: a service without them stores
-- nothing, and a release that does not know this column keeps serving every
-- existing page.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "addOns" JSONB;
