/**
 * The v1 → v2 sweep trigger: cron secret required, a dry run that writes
 * nothing unless `apply=1`, the batch clamped, and only counts in the
 * response. Plus its column inventory: every encrypted column the lint knows
 * is swept (or named as append-only), and each exists in the schema with the
 * `id` and `organizationId` the sweep's SQL relies on.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/crypto/tenant-file-locations", () => ({ tenantFileLocations: () => [] }))
vi.mock("@/lib/crypto/tenant-file-backfill", () => ({
  rekeyTenantFiles: vi.fn(async (_locations: unknown, options: { dryRun: boolean }) => ({
    dryRun: options.dryRun,
    hasMore: false,
    totals: { scanned: 1, rekeyed: 0, onDataKey: 0, plain: 0, ownerUnknown: 0, keyUnavailable: 0, failed: 0 },
    derivedKeyFilesByOrganization: { "org-a": 1 },
  })),
}))
vi.mock("@/lib/crypto/tenant-data-key-reencrypt", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/crypto/tenant-data-key-reencrypt")>(),
  reencryptTenantColumns: vi.fn(async () => ({
    hasMore: true,
    counts: { scanned: 3, rewritten: 3, undecryptable: 0, keyUnavailable: 0, changedMeanwhile: 0 },
  })),
  countV1ColumnValues: vi.fn(async () => ({ rewritable: new Map([["org-a", 2]]), appendOnly: new Map([["org-b", 5]]) })),
}))

import { POST } from "@/app/api/cron/tenant-data-key-reencrypt/route"
import { rekeyTenantFiles } from "@/lib/crypto/tenant-file-backfill"
import {
  APPEND_ONLY_COLUMNS,
  REENCRYPTABLE_COLUMNS,
  reencryptTenantColumns,
} from "@/lib/crypto/tenant-data-key-reencrypt"
import { resetMasterKekCache } from "@/lib/crypto/tenant-pii-encryption"

function call(query = "", secret: string | null = "cron-secret") {
  return POST(new NextRequest(new URL(`http://localhost/api/cron/tenant-data-key-reencrypt${query}`), {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }))
}

beforeEach(() => {
  vi.mocked(rekeyTenantFiles).mockClear()
  vi.mocked(reencryptTenantColumns).mockClear()
  process.env.CRON_SECRET = "cron-secret"
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  resetMasterKekCache()
})

describe("POST /api/cron/tenant-data-key-reencrypt", () => {
  it("refuses a caller without the cron secret and touches nothing", async () => {
    expect((await call("", null)).status).toBe(401)
    expect((await call("?apply=1", "wrong")).status).toBe(401)
    expect(reencryptTenantColumns).not.toHaveBeenCalled()
    expect(rekeyTenantFiles).not.toHaveBeenCalled()
  })

  it("is a dry run unless apply=1: no column is rewritten and files are only counted", async () => {
    await call()
    await call("?apply=true")
    expect(reencryptTenantColumns).not.toHaveBeenCalled()
    expect(vi.mocked(rekeyTenantFiles).mock.calls.map(([, options]) => options.dryRun)).toEqual([true, true])
    await call("?apply=1")
    expect(reencryptTenantColumns).toHaveBeenCalledTimes(1)
    expect(vi.mocked(rekeyTenantFiles).mock.calls[2][1].dryRun).toBe(false)
  })

  it("clamps the batch", async () => {
    await call("?apply=1&limit=999999")
    await call("?apply=1&limit=-3")
    expect(vi.mocked(reencryptTenantColumns).mock.calls.map(([options]) => options.limit)).toEqual([5000, 500])
  })

  it("answers with counts only, per organization", async () => {
    const response = await call("?apply=1")
    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(Object.keys(data).sort()).toEqual(["columns", "dryRun", "files", "hasMore", "limit", "remainingOnDerivedKey"])
    expect(data.hasMore).toBe(true)
    expect(data.remainingOnDerivedKey).toEqual({
      "org-a": { columns: 2, appendOnlyColumns: 0, files: 1 },
      "org-b": { columns: 0, appendOnlyColumns: 5, files: 0 },
    })
  })

  it("refuses to run without the master key", async () => {
    delete process.env.TENANT_PII_MASTER_KEY
    resetMasterKekCache()
    expect((await call("?apply=1")).status).toBe(500)
    expect(reencryptTenantColumns).not.toHaveBeenCalled()
  })
})

describe("the sweep's column inventory", () => {
  const root = path.resolve(__dirname, "../..")
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8")
  const tables = new Map<string, Set<string>>()
  for (const model of schema.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)) {
    const table = /@@map\("([^"]+)"\)/.exec(model[1])?.[1]
    if (!table) continue
    const fields = new Set<string>()
    for (const line of model[1].split("\n")) {
      const field = /^\s+(\w+)\s+String\??(?:\s|$)/.exec(line)
      // A field renamed in the database would need its column name in the SQL.
      if (field && !line.includes("@map(")) fields.add(field[1])
    }
    tables.set(table, fields)
  }

  it("names real text columns of tables with id and organizationId", () => {
    for (const [table, columns] of Object.entries({ ...REENCRYPTABLE_COLUMNS, ...APPEND_ONLY_COLUMNS })) {
      const fields = tables.get(table)
      expect(fields, table).toBeDefined()
      expect([...fields!].filter((field) => field === "id" || field === "organizationId").sort(), table).toEqual(["id", "organizationId"])
      for (const column of columns) expect(fields!.has(column), `${table}.${column}`).toBe(true)
    }
  })

  it("covers every column the encrypted-columns lint knows", () => {
    const lint = readFileSync(path.join(root, "scripts/lint-encrypted-columns.mjs"), "utf8")
    const inventory = lint.slice(lint.indexOf("const ENCRYPTED_COLUMNS_BY_TABLE"), lint.indexOf("\n}\n"))
    let count = 0
    for (const entry of inventory.matchAll(/"?([\w-]+)"?:\s*\[([^\]]*)\]/g)) {
      const table = entry[1].replace(/-/g, "_")
      for (const column of entry[2].matchAll(/"(\w+)"/g)) {
        count += 1
        const swept = REENCRYPTABLE_COLUMNS[table]?.includes(column[1]) || APPEND_ONLY_COLUMNS[table]?.includes(column[1])
        expect(swept, `${table}.${column[1]}`).toBe(true)
      }
    }
    expect(count).toBe(61)
  })
})
