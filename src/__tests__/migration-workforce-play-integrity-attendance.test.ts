import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const enumMigration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260901100000_workforce_play_integrity_verification_enum/migration.sql",
), "utf8")
const contractMigration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260901100500_workforce_play_integrity_attendance_contract/migration.sql",
), "utf8")

describe("Workforce Play Integrity attendance migration", () => {
  it("adds a separate non-destructive enum transaction before the constraint uses it", () => {
    expect(enumMigration).toContain("ADD VALUE IF NOT EXISTS 'PLAY_INTEGRITY'")
    expect(enumMigration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/i)
  })

  it("keeps only a fingerprint, an active tenant enrollment and v5 compatibility", () => {
    expect(contractMigration).toContain("'PLAY_INTEGRITY'")
    expect(contractMigration).toContain('"deviceEnrollmentId" IS NOT NULL')
    expect(contractMigration).toContain('"proofFingerprint" ~ \'^[A-Fa-f0-9]{64}$\'')
    expect(contractMigration).toContain("workforce_validate_attendance_verification_insert")
    expect(contractMigration).toContain('CHECK ("schemaVersion" IN (1, 2, 3, 4, 5))')
    expect(contractMigration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\s+/i)
    expect(contractMigration).not.toMatch(/integrityToken|rawToken|decodedPayload/i)
  })
})
