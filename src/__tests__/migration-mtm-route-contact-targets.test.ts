import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const sql = readFileSync(resolve(
  "prisma/migrations/20260715191500_mtm_route_contact_targets/migration.sql",
), "utf8")

describe("MTM route contact targets migration", () => {
  it("adds nullable contact links without rewriting existing route data", () => {
    expect(sql).toContain('ALTER TABLE "mtm_route_points" ADD COLUMN "contactId" TEXT')
    expect(sql).toContain('ALTER TABLE "mtm_visits" ADD COLUMN "contactId" TEXT')
    expect(sql).not.toContain('"contactId" TEXT NOT NULL')
  })

  it("indexes both links and preserves audit history when a contact is deleted", () => {
    expect(sql).toContain('CREATE INDEX "mtm_route_points_contactId_idx"')
    expect(sql).toContain('CREATE INDEX "mtm_visits_contactId_idx"')
    expect(sql.match(/ON DELETE SET NULL ON UPDATE CASCADE/g)).toHaveLength(2)
  })
})
