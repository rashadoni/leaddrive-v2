import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260811160000_journey_enrollment_claims_and_uniqueness/migration.sql",
  ),
  "utf8",
)

describe("journey enrollment concurrency migration", () => {
  it("repairs schema drift and locks the cleanup/index cutover atomically", () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/)
    expect(migration.match(/SET LOCAL lock_timeout = '5s'/g)).toHaveLength(2)
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "processingToken" TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3)')
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP\(3\);\n\nCOMMIT;\n[\s\S]*\nBEGIN;/)
    expect(migration).toContain('LOCK TABLE "journey_enrollments" IN SHARE ROW EXCLUSIVE MODE')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "invoiceId" TEXT')
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "journey_enrollments_invoiceId_idx"')
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true)
  })

  it("deduplicates deterministically before creating lead and contact partial indexes", () => {
    expect(migration).toContain('ORDER BY "enrolledAt" ASC, "id" ASC')
    expect(migration).toContain("duplicate_enrollment_migration")
    expect(migration).toContain('CREATE UNIQUE INDEX "journey_enrollments_active_lead_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "journey_enrollments_active_contact_unique"')
    expect(migration).toContain('CREATE UNIQUE INDEX "journey_enrollments_active_invoice_unique"')
    expect(migration.match(/WHERE "invoiceId" IS NULL/g)).toHaveLength(4)
    expect(migration.match(/"status" IN \('active', 'paused'\)/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it("deduplicates active invoice chains before enforcing one active chain per invoice", () => {
    expect(migration).toContain('PARTITION BY "organizationId", "invoiceId"')
    expect(migration).toContain(
      'ON "journey_enrollments"("organizationId", "invoiceId")',
    )
    expect(migration).toContain('WHERE "invoiceId" IS NOT NULL')
  })

  it("adds the processing claim and lease columns", () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "processingToken" TEXT')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "processingLeaseUntil" TIMESTAMP(3)')
  })
})
