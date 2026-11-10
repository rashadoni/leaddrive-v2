-- Meetings and online booking become a tenant module of their own (owner,
-- 2026-11-10: «давай тогда выделим его как модуль»): a tick in the tenant
-- editor and an entry in the plans, instead of riding on sales. A beauty salon
-- buys the bookings and wants nothing of deals, forecasts or contracts.
--
-- Nobody loses or gains anything here: every tenant gets booking exactly where
-- sales is on today, which is where the section lived until now.
--
-- organizations.features is jsonb: an array on most tenants, a JSON-encoded
-- string on a few (those are read through the `modules` column). The array gets
-- "booking" next to "sales" — that is what the tenant editor shows and saves.
-- The `modules` column, where it records sales, records booking with the same
-- value. Neither table carries a tenant id, so neither is under row-level
-- security.
UPDATE "organizations"
SET "features" = "features" || '["booking"]'::jsonb
WHERE jsonb_typeof("features") = 'array'
  AND "features" ? 'sales'
  AND NOT ("features" ? 'booking');

UPDATE "organizations"
SET "modules" = jsonb_set("modules", '{booking}', "modules"->'sales', true)
WHERE jsonb_typeof("modules") = 'object'
  AND jsonb_typeof("modules"->'sales') = 'boolean'
  AND NOT ("modules" ? 'booking');

UPDATE "plan_templates"
SET "features" = array_append("features", 'booking')
WHERE 'sales' = ANY("features")
  AND NOT ('booking' = ANY("features"));
