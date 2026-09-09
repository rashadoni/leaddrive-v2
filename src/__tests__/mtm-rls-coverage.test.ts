import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Guards the invariant from CLAUDE.md: every tenant-scoped MTM table is under
 * FORCE ROW LEVEL SECURITY with a tenant_isolation policy.
 *
 * This reads prisma/schema.prisma and prisma/migrations — NOT a live database —
 * so it fails in CI the moment someone adds an `mtm_*` model with organizationId
 * and forgets the migration. The coverage list previously drifted to 18 tables
 * because RLS was rolled out by hand via scripts/rls/enable-batch-*.sql, which a
 * freshly-migrated database never runs.
 */

const REPO_ROOT = join(__dirname, "..", "..")
const SCHEMA_PATH = join(REPO_ROOT, "prisma", "schema.prisma")
const MIGRATIONS_DIR = join(REPO_ROOT, "prisma", "migrations")

/** mtm_* tables that carry organizationId, read from the Prisma schema. */
function tenantScopedMtmTables(): string[] {
  const schema = readFileSync(SCHEMA_PATH, "utf8")
  const tables: string[] = []
  for (const match of schema.matchAll(/\nmodel\s+\w+\s*\{([\s\S]*?)\n\}/g)) {
    const body = match[1]
    const mapped = body.match(/@@map\("(mtm_[a-z_]+)"\)/)
    if (!mapped) continue
    if (!/^\s*organizationId\s+String/m.test(body)) continue
    tables.push(mapped[1])
  }
  return tables.sort()
}

/**
 * Every migration's SQL, concatenated in APPLY order (timestamp-prefixed
 * directory names sort lexicographically). Order matters for
 * `livePolicies()` below, which replays DROP/CREATE POLICY to work out the
 * final state rather than the union of history.
 */
function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      try {
        return readFileSync(join(MIGRATIONS_DIR, entry.name, "migration.sql"), "utf8")
      } catch {
        return ""
      }
    })
    .join("\n")
}

function tablesWith(sql: string, pattern: (table: string) => RegExp, candidates: string[]): Set<string> {
  return new Set(candidates.filter((table) => pattern(table).test(sql)))
}

/**
 * The policies an `mtm_*` table actually ENDS UP with, keyed `table::policy`.
 *
 * Replays CREATE/DROP POLICY in migration order instead of unioning every CREATE
 * ever written. Both matter: a repair migration that drops a bad policy and
 * recreates it correctly must read as fixed, and a policy that was dropped and
 * never recreated must not still count as coverage. (The union approach this
 * replaced could only ever be silenced by an exception list, which is exactly how
 * the 14-table bypass-debt list came to exist.)
 *
 * Dynamic `EXECUTE format('DROP POLICY %I ON %I', …)` statements — see
 * 20260711234000_social_monitoring_rls_bypass_hardening — do not match the `mtm_`
 * table pattern and are ignored; no MTM policy is managed that way.
 */
function livePolicies(sql: string): Map<string, { table: string; body: string }> {
  const live = new Map<string, { table: string; body: string }>()
  const stmt = /(CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z0-9_]+)"?\s+ON\s+"?(mtm_[a-z_]+)"?([\s\S]*?);/g
  for (const m of sql.matchAll(stmt)) {
    const [, verb, name, table, body] = m
    const key = `${table}::${name}`
    if (verb === "CREATE") live.set(key, { table, body })
    else live.delete(key)
  }
  return live
}

describe("MTM RLS coverage", () => {
  const tables = tenantScopedMtmTables()
  const sql = migrationSql()

  it("finds the tenant-scoped MTM tables in the schema", () => {
    // Sanity check on the parser itself: if this ever reads 0 models, every
    // assertion below would vacuously pass.
    expect(tables.length).toBeGreaterThan(50)
    expect(tables).toContain("mtm_route_points")
  })

  it("enables ROW LEVEL SECURITY in a migration for every tenant-scoped MTM table", () => {
    const enabled = tablesWith(
      sql,
      (t) => new RegExp(`ALTER TABLE\\s+"${t}"\\s+ENABLE ROW LEVEL SECURITY`, "i"),
      tables,
    )
    const missing = tables.filter((t) => !enabled.has(t))
    expect(
      missing,
      `These mtm_* tables have organizationId but no "ENABLE ROW LEVEL SECURITY" in prisma/migrations. ` +
        `Add a migration (see 20260806120000_mtm_rls_coverage_completion). ` +
        `Enabling it only in scripts/rls/enable-batch-*.sql does NOT count — a fresh database never runs those.`,
    ).toEqual([])
  })

  it("forces ROW LEVEL SECURITY so the table owner cannot bypass the policy", () => {
    const forced = tablesWith(
      sql,
      (t) => new RegExp(`ALTER TABLE\\s+"${t}"\\s+FORCE ROW LEVEL SECURITY`, "i"),
      tables,
    )
    const missing = tables.filter((t) => !forced.has(t))
    expect(
      missing,
      `These mtm_* tables enable RLS but never FORCE it, so the table owner reads across tenants.`,
    ).toEqual([])
  })

  it("policies every table on organizationId, whatever the policy is named", () => {
    // Deliberately name-agnostic. Three naming conventions are in use —
    // `tenant_isolation` (generator), `<table>_tenant_isolation` (older
    // migrations) and the pharmacy module's per-command
    // `<table>_tenant_all|_tenant_select|_tenant_insert`. What actually matters
    // is that some STILL-LIVE policy on the table keys off organizationId; a
    // policy that a later migration dropped is not coverage.
    const policed = new Set(
      [...livePolicies(sql).values()]
        .filter(({ body }) => body.includes("organizationId"))
        .map(({ table }) => table),
    )
    const missing = tables.filter((t) => !policed.has(t))
    expect(
      missing,
      `These mtm_* tables have RLS enabled but no policy keyed on organizationId.`,
    ).toEqual([])
  })
})

/**
 * A tenant_isolation policy without the `app.rls_bypass` escape hatch silently
 * returns zero rows to every runWithRlsBypass() caller (400+ call sites in
 * src/) and fails WITH CHECK on every bypass-scoped write. Two rollout paths
 * disagreed: scripts/rls/generate-rls-policies.mjs emits the clause,
 * hand-written migrations historically did not.
 *
 * 14 MTM policies carried that debt (verified against production 2026-08-06);
 * 20260806160000_mtm_rls_bypass_clause_normalization drops and recreates all of
 * them in the generator dialect, so the exception list is now EMPTY and this
 * suite is a plain invariant again — do not re-open it. If a new migration
 * trips the first test, fix the migration, not the test.
 */

describe("MTM tenant_isolation policy shape", () => {
  const sql = migrationSql()

  /**
   * The clauses a policy body actually declares. Checking the body as a whole
   * would pass a policy that has the bypass branch in USING but not in WITH
   * CHECK — reads would work and every bypass-scoped write would still fail.
   * Only clauses that EXIST are returned: `FOR SELECT USING (…)` has no WITH
   * CHECK and `FOR INSERT WITH CHECK (…)` has no USING (both shapes are in use,
   * see 20260801170000_mtm_pharmacy_promotion_workflow), so demanding both
   * unconditionally would be wrong.
   */
  function clauses(body: string): string[] {
    const [beforeCheck, ...afterCheck] = body.split(/WITH\s+CHECK/i)
    const found: string[] = []
    if (/\bUSING\b/i.test(beforeCheck)) found.push(beforeCheck)
    if (afterCheck.length > 0) found.push(afterCheck.join("WITH CHECK"))
    return found
  }

  it("sanity-checks the DROP/CREATE replay", () => {
    // If the parser ever reads 0 policies, the assertion below passes vacuously.
    const live = livePolicies(sql)
    expect(live.size).toBeGreaterThan(50)
    // Pins the replay itself: the hand-written `<table>_tenant_isolation` policies
    // were dropped by the normalization migration and must NOT still be live.
    expect(live.has("mtm_messages::mtm_messages_tenant_isolation")).toBe(false)
    expect(live.has("mtm_messages::tenant_isolation")).toBe(true)
    // And the clause splitter must actually see two clauses on a standard policy.
    expect(clauses(live.get("mtm_messages::tenant_isolation")!.body)).toHaveLength(2)
  })

  it("gives every live MTM policy the rls_bypass escape hatch in every clause", () => {
    const offenders = [
      ...new Set(
        [...livePolicies(sql).values()]
          .filter(({ body }) => clauses(body).some((c) => !c.includes("rls_bypass")))
          .map(({ table }) => table),
      ),
    ].sort()

    expect(
      offenders,
      `Tenant policies must include ` +
        `\`OR current_setting('app.rls_bypass', true) = 'on'\` in EVERY clause they ` +
        `declare (USING and WITH CHECK), otherwise runWithRlsBypass() callers ` +
        `silently read zero rows or fail WITH CHECK on write.`,
    ).toEqual([])
  })
})
