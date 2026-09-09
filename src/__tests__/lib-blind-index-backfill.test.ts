/**
 * Slice-3 cross-entity blind-index backfill tests.
 *
 * The helper takes a `RawPrisma` (just `$queryRawUnsafe` +
 * `$executeRawUnsafe`) — easy to stub. Each entity is a separate
 * physical table; the stub maintains an in-memory map keyed by
 * table name and parses the SQL just well enough to dispatch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import {
  runBlindIndexBackfill,
  type RawPrisma,
  type BackfillTable,
} from "@/lib/crypto/blind-index-backfill"
import {
  blindIndexForTenant,
  encryptForTenant,
  resetBlindIndexKeyCache,
  resetMasterKekCache,
} from "@/lib/crypto/tenant-pii-encryption"

const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const ORG_A = "org-A"
const ORG_B = "org-B"

interface Row {
  id: string
  organizationId: string
  fullName: string | null
  fullNameBlindIndex: string | null
  taxId: string | null
  taxIdBlindIndex: string | null
}

/**
 * Minimal RawPrisma stub. The helper now iterates BOTH `fullName` and
 * `taxId` (per WIRED_COLUMNS), so the stub looks at the SQL to figure
 * out which (table × column) it's serving. SELECTs use
 * `"<col>" AS "plain"`, so we route by the index-column name in the
 * WHERE clause and the column name in the UPDATE SET clause.
 */
function makeRawPrisma(rowsByTable: Record<BackfillTable, Row[]>): RawPrisma {
  const tableFromSql = (sql: string): BackfillTable => {
    const tables: BackfillTable[] = [
      "citizens",
      "health_patients",
      "policy_holders",
      "beneficiaries",
    ]
    for (const t of tables) {
      if (sql.includes(`"${t}"`)) return t
    }
    throw new Error(`Unknown table in SQL: ${sql}`)
  }
  const columnFromSql = (sql: string): "fullName" | "taxId" => {
    if (sql.includes(`"taxIdBlindIndex"`) || sql.includes(`"taxId"`)) {
      return "taxId"
    }
    return "fullName"
  }

  return {
    $queryRawUnsafe: async <T = unknown>(
      sql: string,
      ...params: unknown[]
    ): Promise<T> => {
      const table = tableFromSql(sql)
      const column = columnFromSql(sql)
      const limit = params[0] as number
      const rows = rowsByTable[table] ?? []
      const eligible = rows
        .filter((r) =>
          column === "fullName"
            ? r.fullNameBlindIndex === null && r.fullName !== null
            : r.taxIdBlindIndex === null && r.taxId !== null,
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          organizationId: r.organizationId,
          plain: (column === "fullName" ? r.fullName : r.taxId)!,
        }))
      return eligible as unknown as T
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      const table = tableFromSql(sql)
      const column = columnFromSql(sql)
      const [hash, id] = params as [string, string]
      const row = (rowsByTable[table] ?? []).find((r) => r.id === id)
      if (row) {
        if (column === "fullName") row.fullNameBlindIndex = hash
        else row.taxIdBlindIndex = hash
      }
      return row ? 1 : 0
    },
  }
}

function makeRow(
  partial: Partial<Row> & { id: string; organizationId: string },
): Row {
  return {
    fullName: null,
    fullNameBlindIndex: null,
    taxId: null,
    taxIdBlindIndex: null,
    ...partial,
  }
}

function emptyRows(): Record<BackfillTable, Row[]> {
  return {
    citizens: [],
    health_patients: [],
    policy_holders: [],
    beneficiaries: [],
  }
}

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

afterEach(() => {
  delete process.env.TENANT_PII_MASTER_KEY
  resetMasterKekCache()
  resetBlindIndexKeyCache()
})

describe("runBlindIndexBackfill", () => {
  it("writes the deterministic blind index for legacy plaintext rows", async () => {
    const rows = emptyRows()
    rows.citizens.push(
      makeRow({
        id: "c-1",
        organizationId: ORG_A,
        fullName: "Plaintext Jane Doe",
      }),
    )
    const prisma = makeRawPrisma(rows)

    const result = await runBlindIndexBackfill(prisma)
    expect(result.totalUpdated).toBe(1)
    expect(
      result.perEntity.find(
        (e) => e.table === "citizens" && e.column === "fullName",
      )?.updated,
    ).toBe(1)
    expect(rows.citizens[0].fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG_A, "Plaintext Jane Doe"),
    )
  })

  it("decrypts ciphertext rows before hashing (no double-encrypt)", async () => {
    const cipher = encryptForTenant(ORG_A, "Encrypted John Smith")
    const rows = emptyRows()
    rows.health_patients.push(
      makeRow({
        id: "p-1",
        organizationId: ORG_A,
        fullName: cipher,
      }),
    )
    const prisma = makeRawPrisma(rows)

    const result = await runBlindIndexBackfill(prisma)
    expect(result.totalUpdated).toBe(1)
    // Hash matches the PLAINTEXT, not the ciphertext — confirms the
    // decrypt-then-hash path is taken.
    expect(rows.health_patients[0].fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG_A, "Encrypted John Smith"),
    )
    expect(rows.health_patients[0].fullNameBlindIndex).not.toBe(
      blindIndexForTenant(ORG_A, cipher),
    )
  })

  it("tracks updatedByOrg per (entity × column) for the compliance audit-log path", async () => {
    const rows = emptyRows()
    rows.citizens.push(
      makeRow({
        id: "c-A1",
        organizationId: ORG_A,
        fullName: "Tenant A citizen 1",
      }),
      makeRow({
        id: "c-A2",
        organizationId: ORG_A,
        fullName: "Tenant A citizen 2",
      }),
      makeRow({
        id: "c-B1",
        organizationId: ORG_B,
        fullName: "Tenant B citizen",
      }),
    )
    const prisma = makeRawPrisma(rows)
    const result = await runBlindIndexBackfill(prisma)
    const citizensFullName = result.perEntity.find(
      (e) => e.table === "citizens" && e.column === "fullName",
    )!
    // Three rows touched: 2 for orgA, 1 for orgB.
    expect(citizensFullName.updated).toBe(3)
    expect(citizensFullName.updatedByOrg[ORG_A]).toBe(2)
    expect(citizensFullName.updatedByOrg[ORG_B]).toBe(1)
    // (table × column) pairs with no rows have an empty map (not
    // undefined) so the route's Object.entries iteration is always safe.
    const beneficiariesTaxId = result.perEntity.find(
      (e) => e.table === "beneficiaries" && e.column === "taxId",
    )!
    expect(beneficiariesTaxId.updatedByOrg).toEqual({})
  })

  it("uses per-row orgId for the HMAC key — multi-tenant rows resolve to distinct hashes", async () => {
    const rows = emptyRows()
    rows.policy_holders.push(
      makeRow({
        id: "h-A",
        organizationId: ORG_A,
        fullName: "Same Name",
      }),
      makeRow({
        id: "h-B",
        organizationId: ORG_B,
        fullName: "Same Name",
      }),
    )
    const prisma = makeRawPrisma(rows)

    await runBlindIndexBackfill(prisma)
    const hashA = rows.policy_holders.find((r) => r.id === "h-A")!
      .fullNameBlindIndex
    const hashB = rows.policy_holders.find((r) => r.id === "h-B")!
      .fullNameBlindIndex
    expect(hashA).toBeTruthy()
    expect(hashB).toBeTruthy()
    expect(hashA).not.toBe(hashB)
    expect(hashA).toBe(blindIndexForTenant(ORG_A, "Same Name"))
    expect(hashB).toBe(blindIndexForTenant(ORG_B, "Same Name"))
  })

  it("is idempotent — second run is a no-op because backfilled rows fall out of the WHERE filter", async () => {
    const rows = emptyRows()
    rows.beneficiaries.push(
      makeRow({
        id: "b-1",
        organizationId: ORG_A,
        fullName: "Beneficiary",
      }),
    )
    const prisma = makeRawPrisma(rows)

    const first = await runBlindIndexBackfill(prisma)
    expect(first.totalUpdated).toBe(1)
    const second = await runBlindIndexBackfill(prisma)
    expect(second.totalUpdated).toBe(0)
    expect(second.perEntity.every((e) => e.scanned === 0)).toBe(true)
  })

  it("hasMore=true when at least one entity drains a full batch", async () => {
    const ten: Row[] = Array.from({ length: 10 }, (_, i) =>
      makeRow({
        id: `c-${String(i).padStart(3, "0")}`,
        organizationId: ORG_A,
        fullName: `Citizen ${i}`,
      }),
    )
    const rows = emptyRows()
    rows.citizens = ten
    const prisma = makeRawPrisma(rows)

    // maxRowsPerEntity = 5 — citizens has 10 legacy rows in the
    // fullName column, so its batch fills and hasMore is true.
    const result = await runBlindIndexBackfill(prisma, {
      maxRowsPerEntity: 5,
    })
    expect(result.totalUpdated).toBe(5)
    expect(result.hasMore).toBe(true)
    expect(
      result.perEntity.find(
        (e) => e.table === "citizens" && e.column === "fullName",
      )?.scanned,
    ).toBe(5)
  })

  it("hasMore=false when every entity finishes inside the batch limit", async () => {
    const rows = emptyRows()
    rows.citizens.push(
      makeRow({ id: "c-1", organizationId: ORG_A, fullName: "X" }),
    )
    const prisma = makeRawPrisma(rows)
    const result = await runBlindIndexBackfill(prisma, {
      maxRowsPerEntity: 200,
    })
    expect(result.hasMore).toBe(false)
  })

  it("processes all four entities × both columns in one pass", async () => {
    const rows = emptyRows()
    // Each entity gets one fullName row + one taxId row, so the pass
    // should produce 8 perEntity entries (4 tables × 2 columns) and
    // touch 8 rows total.
    rows.citizens.push(
      makeRow({ id: "c-1", organizationId: ORG_A, fullName: "A" }),
      makeRow({ id: "c-2", organizationId: ORG_A, taxId: "111" }),
    )
    rows.health_patients.push(
      makeRow({ id: "p-1", organizationId: ORG_A, fullName: "B" }),
      makeRow({ id: "p-2", organizationId: ORG_A, taxId: "222" }),
    )
    rows.policy_holders.push(
      makeRow({ id: "h-1", organizationId: ORG_A, fullName: "C" }),
      makeRow({ id: "h-2", organizationId: ORG_A, taxId: "333" }),
    )
    rows.beneficiaries.push(
      makeRow({ id: "b-1", organizationId: ORG_A, fullName: "D" }),
      makeRow({ id: "b-2", organizationId: ORG_A, taxId: "444" }),
    )
    const prisma = makeRawPrisma(rows)
    const result = await runBlindIndexBackfill(prisma)
    expect(result.totalUpdated).toBe(8)
    // perEntity emits one entry per (table × column).
    expect(result.perEntity.length).toBe(8)
    const keys = result.perEntity
      .map((e) => `${e.table}.${e.column}`)
      .sort()
    expect(keys).toEqual([
      "beneficiaries.fullName",
      "beneficiaries.taxId",
      "citizens.fullName",
      "citizens.taxId",
      "health_patients.fullName",
      "health_patients.taxId",
      "policy_holders.fullName",
      "policy_holders.taxId",
    ])
  })

  it("backfills taxId blind-index for citizens (slice-3 extension)", async () => {
    const rows = emptyRows()
    rows.citizens.push(
      makeRow({ id: "c-1", organizationId: ORG_A, taxId: "123-45-6789" }),
    )
    const prisma = makeRawPrisma(rows)
    const result = await runBlindIndexBackfill(prisma)
    expect(result.totalUpdated).toBe(1)
    const citizensTaxId = result.perEntity.find(
      (e) => e.table === "citizens" && e.column === "taxId",
    )!
    expect(citizensTaxId.updated).toBe(1)
    expect(rows.citizens[0].taxIdBlindIndex).toBe(
      blindIndexForTenant(ORG_A, "123-45-6789"),
    )
    // The fullName backfill is a no-op on this row (fullName is null).
    expect(rows.citizens[0].fullNameBlindIndex).toBeNull()
  })

  it("isolates per-(entity × column) failures — one SELECT erroring does not kill the run", async () => {
    // Simulate: citizens column not yet deployed (column-doesn't-exist
    // SQL error on the SELECT). Every other (table × column) pair
    // must still process normally.
    const rows = emptyRows()
    rows.health_patients.push(
      makeRow({
        id: "p-1",
        organizationId: ORG_A,
        fullName: "Health Patient",
      }),
    )
    const prismaWithFailure: RawPrisma = {
      $queryRawUnsafe: async <T = unknown>(
        sql: string,
        ...params: unknown[]
      ): Promise<T> => {
        if (sql.includes('"citizens"')) {
          throw new Error(
            'column "fullNameBlindIndex" of relation "citizens" does not exist',
          )
        }
        // Delegate to the normal stub for the other three tables.
        return makeRawPrisma(rows).$queryRawUnsafe<T>(sql, ...params)
      },
      $executeRawUnsafe: makeRawPrisma(rows).$executeRawUnsafe,
    }

    const result = await runBlindIndexBackfill(prismaWithFailure)
    // BOTH citizens entries (fullName + taxId) exist with all zeros —
    // not dropped from the perEntity list (operators get a complete
    // report) but no rows touched.
    const citizensEntries = result.perEntity.filter(
      (e) => e.table === "citizens",
    )
    expect(citizensEntries.length).toBe(2)
    expect(citizensEntries.every((e) => e.scanned === 0)).toBe(true)
    expect(citizensEntries.every((e) => e.updated === 0)).toBe(true)
    // Health patient still backfilled.
    expect(rows.health_patients[0].fullNameBlindIndex).toBe(
      blindIndexForTenant(ORG_A, "Health Patient"),
    )
    expect(result.totalUpdated).toBe(1)
  })

  it("clamps maxRowsPerEntity to [1, 1000]", async () => {
    // 100k rows of citizens — the cap must keep us from over-fetching.
    const lots: Row[] = Array.from({ length: 5000 }, (_, i) =>
      makeRow({
        id: `c-${String(i).padStart(5, "0")}`,
        organizationId: ORG_A,
        fullName: `Citizen ${i}`,
      }),
    )
    const rows = emptyRows()
    rows.citizens = lots
    const prisma = makeRawPrisma(rows)
    const result = await runBlindIndexBackfill(prisma, {
      maxRowsPerEntity: 999_999, // way over the cap
    })
    // Caller-supplied limit is clamped to 1000.
    expect(
      result.perEntity.find(
        (e) => e.table === "citizens" && e.column === "fullName",
      )?.scanned,
    ).toBe(1000)
  })
})
