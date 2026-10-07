import { Prisma } from "@prisma/client"

type ReaderTransaction = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw"> & { $transaction?: never }

// Every fact and schedule dependency read by the dense reconciliation adapter.
const tables = [
  "mtm_agent_workdays", "mtm_agent_workday_events", "workforce_site_transitions",
  "workforce_attendance_evidence", "workforce_evidence_assessments", "workforce_exception_cases",
  "workforce_timesheet_approvals", "mtm_audit_logs", "mtm_agents", "workforce_employee_team_memberships",
  "workforce_shift_templates", "workforce_shift_segments", "workforce_shift_assignments",
  "workforce_shift_default_assignments", "workforce_shift_team_default_assignments",
  "workforce_workday_schedule_snapshots", "workforce_shift_snapshots", "workforce_policy_snapshots",
] as const

// Exact pg_get_expr forms of the two supported repository/isolated-fixture
// SELECT policies. Unknown or additional applicable policies require review.
const tenantOnly = '("organizationId" = current_setting(\'app.org_id\'::text, true))'
const tenantWithBypass = '(("organizationId" = current_setting(\'app.org_id\'::text, true)) OR (current_setting(\'app.rls_bypass\'::text, true) = \'on\'::text))'
const refused = () => new Error("WORKFORCE_RECONCILIATION_READER_PROFILE_UNVERIFIED")

/**
 * Verify the supported complete-tenant SELECT profile in the same read-only
 * snapshot as the scan. This never broadens access or installs a policy. It is
 * not historical-schema, control-client, collector or production acceptance.
 * Administrative role attributes/membership must remain stable during the run.
 */
export async function assertWorkforceReconciliationReaderProfile(tx: ReaderTransaction, organizationId: string) {
  if ("$transaction" in tx || !organizationId.trim() || organizationId.length > 191) throw refused()
  try {
    // Resolve both the verifier and subsequent adapter SQL through trusted
    // namespaces. Temporary relation shadows are still detected below.
    await tx.$executeRaw(Prisma.sql`SET LOCAL search_path = pg_catalog, public`)
    // Keep relation/policy DDL from changing the checked profile before scan end.
    // NOWAIT refuses a contended schema instead of consuming the worker budget.
    await tx.$executeRaw(Prisma.sql`LOCK TABLE ${Prisma.join(tables.map(table => Prisma.raw(`public."${table}"`)))} IN ACCESS SHARE MODE NOWAIT`)
    const rows = await tx.$queryRaw<Array<{ name: string; valid: boolean }>>(Prisma.sql`
      WITH required(name) AS (SELECT unnest(ARRAY[${Prisma.join([...tables])}]::text[])),
      actor AS (SELECT oid, rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user)
      SELECT required.name, COALESCE(
        pg_catalog.current_setting('transaction_read_only') = 'on'
        AND pg_catalog.current_setting('transaction_isolation') IN ('repeatable read', 'serializable')
        AND pg_catalog.current_setting('app.org_id', true) = ${organizationId}
        AND pg_catalog.current_setting('app.rls_bypass', true) = 'off'
        AND NOT actor.rolsuper AND NOT actor.rolbypassrls
        AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND pg_catalog.row_security_active(c.oid)
        AND pg_catalog.to_regclass(required.name)::oid = c.oid
        AND NOT pg_catalog.pg_has_role(actor.oid, c.relowner, 'USAGE')
        AND pg_catalog.has_table_privilege(actor.oid, c.oid, 'SELECT')
        AND NOT pg_catalog.has_table_privilege(actor.oid, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        AND NOT pg_catalog.has_any_column_privilege(actor.oid, c.oid, 'INSERT,UPDATE,REFERENCES')
        AND tenant_column.atttypid = 'pg_catalog.text'::regtype
        AND tenant_column.attcollation = 'pg_catalog."default"'::regcollation
        AND policies.count = 1 AND policies.supported, false) AS valid
      FROM required CROSS JOIN actor
      LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = required.name
      LEFT JOIN pg_catalog.pg_attribute tenant_column ON tenant_column.attrelid = c.oid
        AND tenant_column.attname = 'organizationId' AND tenant_column.attnum > 0 AND NOT tenant_column.attisdropped
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS count, bool_and(p.polpermissive
          AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN (${tenantOnly}, ${tenantWithBypass})
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_depend d
            WHERE d.classid = 'pg_catalog.pg_policy'::regclass AND d.objid = p.oid
              AND NOT (
                (d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = c.oid
                  AND d.refobjsubid IN (0, tenant_column.attnum))
                OR (d.refclassid = 'pg_catalog.pg_proc'::regclass
                  AND d.refobjid = 'pg_catalog.current_setting(text,boolean)'::regprocedure)
              )
          )) AS supported
        FROM pg_catalog.pg_policy p
        WHERE p.polrelid = c.oid AND p.polcmd IN ('*', 'r')
          AND EXISTS (SELECT 1 FROM unnest(p.polroles) role_id
            WHERE role_id = 0 OR pg_catalog.pg_has_role(actor.oid, role_id, 'USAGE'))
      ) policies ON true
    `)
    if (rows.length !== tables.length || rows.some(row => row.valid !== true)) throw refused()
  } catch { throw refused() }
}
