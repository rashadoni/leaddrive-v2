-- The station resends an order the CRM did not answer, during the call and
-- after it (owner, 2026-10-28: «станция досылает заказ, если CRM не ответила»).
-- stationSeq: the newest save of the call this order holds, so a late or
-- repeated send never brings an older list back. stationRevision: the
-- revision that save left, so a send after the call never overwrites a
-- manager's change.
ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "stationSeq" INTEGER;
ALTER TABLE "pharmacy_phone_orders" ADD COLUMN "stationRevision" INTEGER;
