-- A booking page already is a service; a salon's service also has a price, a
-- category and a cycle it comes back on. All four columns are nullable, so
-- every existing page keeps behaving exactly as it did.
SET lock_timeout = '3s';

ALTER TABLE "booking_pages"
  ADD COLUMN "price" DECIMAL(14, 2),
  ADD COLUMN "priceCurrency" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "repeatCycleDays" INTEGER;
