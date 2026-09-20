import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Every tenant policy must read the same session setting the application sets.
 *
 * `mtm_contact_create_requests` shipped with `app.current_organization_id`,
 * a name nothing sets. RLS fails closed, so the table rejected every insert
 * ("new row violates row-level security policy") and read back zero rows —
 * the field app's new-doctor request died on an unreadable error and the
 * manager's approval queue stayed empty. Its own migration test passed: it
 * asserted that a policy exists, never which setting it reads.
 *
 * One grep over the migrations is cheaper than that outage repeated.
 */
const MIGRATIONS_DIR = path.join(process.cwd(), "prisma", "migrations")
const TENANT_SETTING = "app.org_id"
const FORBIDDEN_SETTINGS = ["app.current_organization_id", "app.organization_id", "app.orgId"]

/** Comments may name the mistake; only executable SQL is judged. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "")
}

function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      sql: withoutComments(readFileSync(path.join(MIGRATIONS_DIR, entry.name, "migration.sql"), "utf8")),
    }))
}

describe("tenant RLS policies read the setting the application sets", () => {
  it("never introduces another name for the organization setting", () => {
    const offenders = migrationFiles()
      .filter(({ sql }) => FORBIDDEN_SETTINGS.some((setting) => sql.includes(setting)))
      .map(({ name }) => name)
    // The migration that introduced the wrong name stays on disk: applied
    // migrations are never rewritten. The fix below supersedes it.
    expect(offenders).toEqual(["20260919170000_mtm_contact_create_requests"])
  })

  it("recreates the contact-request policy on the shared setting", () => {
    const fix = withoutComments(readFileSync(
      path.join(MIGRATIONS_DIR, "20260920160000_mtm_contact_create_requests_rls_setting_fix", "migration.sql"),
      "utf8",
    ))
    expect(fix).toContain('DROP POLICY IF EXISTS "tenant_isolation" ON "mtm_contact_create_requests"')
    expect(fix).toContain('CREATE POLICY "tenant_isolation" ON "mtm_contact_create_requests"')
    expect(fix.match(new RegExp(`current_setting\\('${TENANT_SETTING}', true\\)`, "g"))).toHaveLength(2)
    expect(fix.match(/current_setting\('app\.rls_bypass', true\) = 'on'/g)).toHaveLength(2)
    expect(FORBIDDEN_SETTINGS.some((setting) => fix.includes(setting))).toBe(false)
  })
})
