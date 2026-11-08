-- Boards become a tenant module of their own (owner, 2026-11-08: «он должен
-- быть полностью раздельным»): a tick in the tenant editor and an entry in the
-- plans, instead of following CRM. Nobody loses or gains anything here — every
-- tenant gets boards exactly where CRM is on today.
--
-- organizations.features is jsonb: an array on most tenants, a JSON-encoded
-- string on a few (those are read through the `modules` column). The array gets
-- "boards" next to "crm" — that is what the tenant editor shows and saves. The
-- `modules` column, where it records CRM, records boards with the same value.
-- Neither table carries a tenant id, so neither is under row-level security.
UPDATE "organizations"
SET "features" = "features" || '["boards"]'::jsonb
WHERE jsonb_typeof("features") = 'array'
  AND "features" ? 'crm'
  AND NOT ("features" ? 'boards');

UPDATE "organizations"
SET "modules" = jsonb_set("modules", '{boards}', "modules"->'crm', true)
WHERE jsonb_typeof("modules") = 'object'
  AND jsonb_typeof("modules"->'crm') = 'boolean'
  AND NOT ("modules" ? 'boards');

UPDATE "plan_templates"
SET "features" = array_append("features", 'boards')
WHERE 'crm' = ANY("features")
  AND NOT ('boards' = ANY("features"));
