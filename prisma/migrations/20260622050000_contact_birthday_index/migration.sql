-- [P3] Speeds the daily loyalty-birthday cron's month+day scan.
-- Expression index matching runLoyaltyBirthday's filter:
--   WHERE "organizationId" = $1
--     AND EXTRACT(MONTH FROM "dateOfBirth") = $2
--     AND EXTRACT(DAY   FROM "dateOfBirth") = $3
-- EXTRACT on a `timestamp without time zone` (the dateOfBirth column type) is
-- IMMUTABLE, so the expressions are indexable. Turns the daily org-scoped scan
-- into a seek once a tenant's contacts grow large. Additive, no lock-heavy
-- rewrite (plain CREATE INDEX on a mostly-NULL new column).
CREATE INDEX "contacts_org_birthday_idx"
  ON "contacts" ("organizationId", EXTRACT(MONTH FROM "dateOfBirth"), EXTRACT(DAY FROM "dateOfBirth"));
