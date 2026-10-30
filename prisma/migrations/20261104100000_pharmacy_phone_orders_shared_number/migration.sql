-- A phone order can name its pharmacy from a number 1C lists for several
-- pharmacies, once the caller said which one (phone_shared).
ALTER TABLE "pharmacy_phone_orders" DROP CONSTRAINT "pharmacy_phone_orders_identification_check";
ALTER TABLE "pharmacy_phone_orders" ADD CONSTRAINT "pharmacy_phone_orders_identification_check"
  CHECK ("pharmacyIdentification" IN ('test_call', 'phone_unique', 'phone_shared', 'named_on_call', 'unidentified'));
