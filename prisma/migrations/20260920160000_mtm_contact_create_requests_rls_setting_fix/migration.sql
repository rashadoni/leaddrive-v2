-- `mtm_contact_create_requests` was created with a tenant policy that reads
-- `app.current_organization_id`. Nothing in this codebase ever sets that name:
-- every tenant path sets `app.org_id`, and 555 of the 556 tenant policies in
-- production read it. The one outlier made the table fail closed in both
-- directions — a field agent's new-doctor request was rejected by
-- `new row violates row-level security policy` (SQLSTATE 42501), and the
-- manager's queue read back zero rows — while the feature's tests passed,
-- because they asserted that a policy exists, not which setting it reads.
--
-- Recreate the policy on the shared setting. The table's data is unaffected;
-- only the predicate changes.

DROP POLICY IF EXISTS "tenant_isolation" ON "mtm_contact_create_requests";

CREATE POLICY "tenant_isolation" ON "mtm_contact_create_requests"
  USING (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  )
  WITH CHECK (
    "organizationId" = current_setting('app.org_id', true)
    OR current_setting('app.rls_bypass', true) = 'on'
  );
