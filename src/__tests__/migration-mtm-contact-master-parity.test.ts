import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const migrationName = "20260722040000_mtm_contact_master_parity"
const migration = readFileSync(
  resolve("prisma/migrations", migrationName, "migration.sql"),
  "utf8",
)
const deployScript = readFileSync(resolve("scripts/server-deploy.sh"), "utf8")

describe("MTM contact master parity migration recovery", () => {
  it("targets the mapped organizations table", () => {
    expect(migration).toContain(
      'FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")',
    )
    expect(migration).not.toContain('REFERENCES "Organization"("id")')
  })

  it("recovers only the known failed migration after a fail-closed artifact check", () => {
    expect(deployScript).toContain(`GAP003_MIGRATION="${migrationName}"`)
    expect(deployScript).toContain('fatal "$GAP003_MIGRATION left partial schema artifacts')
    expect(deployScript).toContain('--rolled-back "$GAP003_MIGRATION"')

    const artifactCheck = deployScript.slice(
      deployScript.indexOf("GAP003_ARTIFACTS="),
      deployScript.indexOf('log "Verified complete rollback of $GAP003_MIGRATION'),
    )
    expect(artifactCheck).toContain("type:MtmContactChangeKind")
    expect(artifactCheck).toContain("table:mtm_contact_change_requests")
    expect(artifactCheck).toContain("duplicateOfContactId")
    expect(artifactCheck).toContain("MtmContactStatus")
  })
})
