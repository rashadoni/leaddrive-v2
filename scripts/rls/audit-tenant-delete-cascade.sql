-- Is deleting a tenant actually complete?
--
-- hardDeleteTenant() removes the organizations row and relies ENTIRELY on
-- cascading foreign keys — it never enumerates tables. So "we delete everything
-- 30 days after termination" (ISMS-12) is true only for tables that actually
-- carry an FK to organizations with ON DELETE CASCADE.
--
-- This cannot be answered from the repo: several tables were created with
-- `db push` and have no migration SQL, and schema.prisma disagrees with the
-- migrations for some of them. Run this against PRODUCTION.
--
--   cd /opt/leaddrive-v2/.next/standalone   # the copy this release shipped; /opt/leaddrive-v2
--                                          # itself is a stale git checkout, not the release
--   psql "$DATABASE_URL" -f scripts/rls/audit-tenant-delete-cascade.sql
--
-- Any row in the output needs review: it either survives future purges or has
-- a NOT VALID cascade whose historical rows have not yet been verified.
-- Record the result in docs/isms/ISMS-12-retention.md section 4.

SELECT
  c.relname AS orphan_table,
  CASE
    WHEN fk.conname IS NULL THEN 'no FK to organizations'
    WHEN fk.confdeltype = 'c' AND NOT fk.convalidated
      THEN 'FK ' || fk.conname || ' is NOT VALID; historical rows are not verified'
    ELSE 'FK ' || fk.conname || ' has ON DELETE ' ||
         CASE fk.confdeltype
           WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
           WHEN 'n' THEN 'SET NULL'  WHEN 'd' THEN 'SET DEFAULT'
           ELSE fk.confdeltype::text
         END
  END AS why_it_survives
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organizationId' AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_constraint fk
  ON fk.conrelid = c.oid
 AND fk.contype = 'f'
 AND fk.confrelid = 'public.organizations'::regclass
 AND a.attnum = ANY (fk.conkey)
WHERE c.relkind = 'r'
  AND c.relname <> 'organizations'
  -- CASCADE protects future tenant deletion. Until it is validated, keep it in
  -- the report because historical rows have not been proven to satisfy it.
  AND (
    fk.conname IS NULL
    OR fk.confdeltype <> 'c'
    OR NOT fk.convalidated
  )
ORDER BY 1;
