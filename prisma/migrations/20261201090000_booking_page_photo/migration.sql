-- A salon sells with pictures. One nullable column holding a path under
-- /uploads/booking-photos; a service without a picture stores nothing, and a
-- release that does not know this column serves every existing page.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "photoUrl" TEXT;
