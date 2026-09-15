-- The customer pin and check-in zone captured at check-in. Nullable and
-- without a backfill: visits made before this migration keep the old rule
-- (measured against the customer's current pin), because the pin they were
-- made against was never stored.
ALTER TABLE "mtm_visits" ADD COLUMN "checkInCustomerLat" DOUBLE PRECISION;
ALTER TABLE "mtm_visits" ADD COLUMN "checkInCustomerLng" DOUBLE PRECISION;
ALTER TABLE "mtm_visits" ADD COLUMN "checkInGeofenceRadius" INTEGER;
