import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION = "20260716043000_mtm_commitment_events"
const sql = readFileSync(resolve("prisma/migrations", MIGRATION, "migration.sql"), "utf8")

describe("MTM commitment event migration", () => {
  it("keeps the submitted promise and fact in separate immutable rows", () => {
    expect(sql).toContain('CREATE TABLE "mtm_commitments"')
    expect(sql).toContain('CREATE TABLE "mtm_commitment_fulfillments"')
    expect(sql).toContain('CREATE UNIQUE INDEX "mtm_commitment_fulfillments_commitmentId_key"')
    expect(sql).toContain('CONSTRAINT "mtm_commitments_quantity_check" CHECK ("promisedQuantity" > 0)')
    expect(sql).toContain('CONSTRAINT "mtm_commitments_due_check" CHECK ("dueAt" >= "submittedAt")')
  })

  it("pins mobile identity and tenant isolation for both event tables", () => {
    expect(sql).toContain('mtm_commitments_organizationId_agentId_clientCommitmentId_key')
    expect(sql).toContain('mtm_commitment_fulfillments_organizationId_agentId_clientFulfillmentId_key')
    expect(sql).toContain('ALTER TABLE "mtm_commitments" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE "mtm_commitment_fulfillments" FORCE ROW LEVEL SECURITY')
    expect(sql.match(/current_setting\('app\.org_id', true\)/g)).toHaveLength(4)
  })

  it("references products only by external identity", () => {
    expect(sql).toContain('"productExternalId" TEXT')
    expect(sql).toContain('"brandExternalId" TEXT')
    expect(sql).not.toContain('REFERENCES "products"')
  })
})
