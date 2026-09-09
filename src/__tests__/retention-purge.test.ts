import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Findings F-08 and the schedule half of F-10
 * (docs/isms/ISMS-02-gap-analysis.md).
 *
 * A retention period binds in both directions. Deleting early destroys
 * evidence; keeping past the period is the half that gets forgotten, and it is
 * the half a regulator asks about — data no longer needed is nothing but risk.
 *
 * Both audit trails are append-only by database trigger, so the sweep has to opt
 * in per transaction. The two flags must stay distinct: a tenant purge must not
 * pick up the right to erase the compliance trail, and scheduled expiry must not
 * pick up the right to erase business audit rows of a live tenant.
 */
const source = readFileSync("src/app/api/cron/retention-purge/route.ts", "utf8")

describe("retention purge", () => {
  it("requires the cron secret", () => {
    // An unauthenticated endpoint that deletes audit history is worse than no
    // retention at all.
    expect(source).toContain("requireCronAuth")
  })

  it("uses a separate opt-in flag per table", () => {
    expect(source).toContain("app.audit_log_purge")
    expect(source).toContain("app.compliance_audit_purge")
    expect(source).not.toMatch(/app\.audit_log_purge[\s\S]{0,400}compliance_audit_log"? WHERE/)
  })

  it("scopes each flag with SET LOCAL", () => {
    // SET (without LOCAL) would persist on the pooled connection and hand the
    // permission to whatever query runs next.
    const flags = source.match(/SET LOCAL app\.\w+/g) ?? []
    expect(flags).toHaveLength(2)
  })

  it("matches the retention stated in ISMS-12", () => {
    const policy = readFileSync("docs/isms/ISMS-12-retention.md", "utf8")
    expect(policy).toMatch(/`audit_logs`\s*\|\s*3 года/)
    expect(source).toContain("3 * 365")
  })

  it("bounds each run", () => {
    // Deleting three years of audit rows in one statement would hold locks for
    // minutes on a table every write touches.
    expect(source).toMatch(/LIMIT \$\{BATCH\}/)
    expect(source).toMatch(/const BATCH = [\d_]+/)
  })

  it("reports what it deleted", () => {
    // "Nothing was deleted" and "the job never ran" look identical without this.
    expect(source).toContain("[retention-purge]")
    expect(source).toContain("moreLikely")
  })
})
