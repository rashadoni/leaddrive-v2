-- A phone order can carry a 1C pharmacy the caller named by its number and
-- district ("92 Yasamal") when the caller's number is not that pharmacy's
-- (named_matched). It is a suggestion the manager checks, never the call's
-- own pharmacy: the line reads no history of it.
ALTER TABLE "pharmacy_phone_orders" DROP CONSTRAINT "pharmacy_phone_orders_identification_check";
ALTER TABLE "pharmacy_phone_orders" ADD CONSTRAINT "pharmacy_phone_orders_identification_check"
  CHECK ("pharmacyIdentification" IN ('test_call', 'phone_unique', 'phone_shared', 'named_matched', 'named_on_call', 'unidentified', 'manager_selected'));
