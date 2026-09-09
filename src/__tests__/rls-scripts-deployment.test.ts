/**
 * The RLS maintenance scripts have to reach the box they are run on.
 *
 * These are not helpers an operator runs locally: their own headers say to run
 * them on production, against the live database, as the BYPASSRLS migration
 * role — and `cleanup-orphan-tenant-rows.sql` DELETEs rows. Until this was
 * fixed the staging globs matched only the top level of `scripts/`, so the
 * whole directory was missing from every release and had to be scp'd by hand.
 *
 * Hand delivery is the failure this file exists to prevent. A deploy wipes and
 * re-extracts `.next/standalone`, so a hand-placed copy is destroyed at the
 * next deploy and the documented command then resolves against `$APP_DIR`'s
 * git checkout instead. Measured on production 2026-08-28: that checkout sat
 * at a commit from 2026-08-17, held a different `enable-batch-4.sql`, and did
 * not contain the cleanup script at all. "Which copy did I just run against
 * the production database" is not a question this should be able to raise.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8")

// The one that deletes rows. Named explicitly because it is the reason the
// other assertions are worth their maintenance cost.
const DESTRUCTIVE = "cleanup-orphan-tenant-rows.sql"

describe("RLS maintenance scripts reach production", () => {
  it("is staged by the workflow that builds the release", () => {
    const workflow = read(".github/workflows/deploy.yml")
    expect(workflow).toMatch(/cp -r scripts\/rls\/\. \.next\/standalone\/scripts\/rls\//)
  })

  it("keeps the retired on-box build path inert", () => {
    // The only supported artifact is now built by deploy.yml. Retiring this
    // second producer removes the risk that an on-host build silently ships a
    // different scripts/rls inventory or competes with production workloads.
    const onBox = read("scripts/server-build-deploy.sh")
    expect(onBox).toContain("intentionally retired")
    expect(onBox).toContain("reviewed main -> .github/workflows/deploy.yml")
    expect(onBox).toContain("exit 64")
    expect(onBox).not.toMatch(/cp -r scripts\/rls\/\. \.next\/standalone\/scripts\/rls\//)
  })

  it("fails the canonical build rather than shipping without the destructive script", () => {
    // `|| true` is right for optional helpers and wrong here: absence is not
    // benign when the recovery path for a missing file is "scp it from
    // somewhere", which is the exact habit this replaces.
    const workflow = read(".github/workflows/deploy.yml")
    expect(workflow).toContain(`.next/standalone/scripts/rls/${DESTRUCTIVE}`)
    expect(workflow).toMatch(/RLS maintenance scripts missing from the standalone artifact/)
  })

  it("copies the directory instead of listing extensions", () => {
    // The bug being fixed WAS an extension list: `*.mjs`, `*.ts`, `*.sh` at the
    // top level only. `.sql` was not excluded on purpose — it was never
    // considered — so a new file type or subdirectory silently does not ship.
    // Asserting the whole-directory copy keeps that class of miss out.
    const staged = readdirSync(join(ROOT, "scripts/rls"))
    expect(staged).toContain(DESTRUCTIVE)
    expect(staged.some((f) => f.endsWith(".sql"))).toBe(true)
    expect(staged.some((f) => f.endsWith(".sh"))).toBe(true)
    expect(staged.some((f) => f.endsWith(".mjs"))).toBe(true)
  })

  it("tells the operator to run the shipped copy, not the stale checkout", () => {
    // Shipping the file changes nothing on its own: the header commands are
    // repository-relative, and the obvious place to run them from is
    // /opt/leaddrive-v2 — which is a git checkout no deploy updates.
    for (const name of [
      DESTRUCTIVE,
      "audit-orphan-tenant-rows.sql",
      "audit-tenant-delete-cascade.sql",
    ]) {
      const header = read(`scripts/rls/${name}`).split("\n").slice(0, 30).join("\n")
      expect(header).toContain("cd /opt/leaddrive-v2/.next/standalone")
      expect(header).toContain(`-f scripts/rls/${name}`)
    }
  })

  it("carries no credential into the artifact", () => {
    // The artifact is world-readable on the box (0644, uid 1001); the BYPASSRLS
    // credential lives in /etc/leaddrive/migration.env (root, 0600) and must
    // stay there. These files may only ever REFERENCE the variable.
    //
    // Loopback is allowed and deliberately so: spike-extension-mechanics.mjs
    // documents a throwaway docker instance as postgres:rls@localhost:55432.
    // A password that only opens a container someone starts by hand is not a
    // secret, and failing on it would train the next person to relax the rule.
    for (const name of readdirSync(join(ROOT, "scripts/rls"))) {
      const text = read(`scripts/rls/${name}`)
      const remoteDsn = /postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@(?!localhost|127\.0\.0\.1)/
      expect(text).not.toMatch(remoteDsn)
    }
  })
})
