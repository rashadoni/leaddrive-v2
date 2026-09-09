import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260828230000_workforce_direct_correction_contract/migration.sql",
), "utf8")
const directCorrection = readFileSync(join(
  process.cwd(),
  "src/lib/workforce/direct-time-correction.ts",
), "utf8")

describe("Workforce direct correction migration", () => {
  it("adds an immutable request hash contract without deleting or rewriting history", () => {
    expect(migration).toContain('ADD COLUMN "requestHash" VARCHAR(64)')
    expect(migration).toContain('"source" = \'DIRECT_MANAGER\'::"WorkforceTimeCorrectionSource"')
    expect(migration).toContain("'^[0-9a-f]{64}$'")
    expect(migration).toContain('"requestId" IS NULL')
    expect(migration.match(/ARRAY\['status', 'startedAt', 'pausedAt', 'completedAt', 'totalPausedSeconds', 'updatedAt'\]/g)).toHaveLength(2)
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i)
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE)\s+TABLE\b/i)
  })

  it("writes the ledger before selecting it for the guarded legacy projection", () => {
    const ledgerWrite = directCorrection.indexOf("const correction = await tx.workforceTimeCorrection.create")
    const correctionContext = directCorrection.indexOf("set_config('app.workforce_correction_id'")
    const projectionUpdate = directCorrection.indexOf("await tx.mtmAgentWorkday.update")
    const transactionAudit = directCorrection.indexOf("await tx.mtmAuditLog.create")

    expect(ledgerWrite).toBeGreaterThanOrEqual(0)
    expect(correctionContext).toBeGreaterThan(ledgerWrite)
    expect(projectionUpdate).toBeGreaterThan(correctionContext)
    expect(transactionAudit).toBeGreaterThan(projectionUpdate)
    expect(directCorrection).toContain("WORKFORCE_TIME_CORRECTION_IDEMPOTENCY_MISMATCH")
    expect(directCorrection).not.toContain("mtmAgentWorkdayEvent.create")
  })
})
