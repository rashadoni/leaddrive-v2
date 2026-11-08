-- A class is one time and several customers. Existing services keep taking one
-- customer at a time: the column has a default, so a release that does not know
-- it writes rows the new one reads as capacity 1.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;
