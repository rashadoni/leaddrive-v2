/**
 * The backfill trigger: cron secret required, dry run unless `apply=1`, the
 * batch clamped, and only counts in the response.
 */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/crypto/tenant-file-backfill", () => ({
  pathEncodedLocation: vi.fn((label: string) => ({ label, list: async () => [] })),
  ownedFileLocation: vi.fn((label: string) => ({ label, list: async () => [] })),
  sealLegacyTenantFiles: vi.fn(async (_locations: unknown, options: { dryRun: boolean }) => ({
    dryRun: options.dryRun,
    hasMore: false,
    totals: { scanned: 0, alreadySealed: 0, sealed: 0, wouldSeal: 0, ownerUnknown: 0, failed: 0 },
    locations: {},
  })),
}))

import { POST } from "@/app/api/cron/tenant-file-encryption-backfill/route"
import { sealLegacyTenantFiles } from "@/lib/crypto/tenant-file-backfill"

function call(query = "", secret: string | null = "cron-secret") {
  return POST(new NextRequest(new URL(`http://localhost/api/cron/tenant-file-encryption-backfill${query}`), {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }))
}

beforeEach(() => {
  vi.mocked(sealLegacyTenantFiles).mockClear()
  process.env.CRON_SECRET = "cron-secret"
})

describe("POST /api/cron/tenant-file-encryption-backfill", () => {
  it("refuses a caller without the cron secret and touches nothing", async () => {
    expect((await call("", null)).status).toBe(401)
    expect((await call("?apply=1", "wrong")).status).toBe(401)
    expect(sealLegacyTenantFiles).not.toHaveBeenCalled()
  })

  it("is a dry run unless apply=1 is given", async () => {
    await call()
    await call("?apply=true")
    await call("?apply=1")
    expect(vi.mocked(sealLegacyTenantFiles).mock.calls.map(([, options]) => options.dryRun)).toEqual([true, true, false])
  })

  it("clamps the batch and covers every customer location, thumbnails after photos", async () => {
    await call("?limit=999999")
    await call("?limit=-3")
    const [[locations, first], [, second]] = vi.mocked(sealLegacyTenantFiles).mock.calls
    expect(first.limit).toBe(5000)
    expect(second.limit).toBe(500)
    const labels = locations.map((location) => location.label)
    expect(labels).toEqual(expect.arrayContaining([
      "inbox", "web-chat", "whatsapp", "telegram", "contract-images", "avatars",
      "mtm-photos", "mtm-photo-thumbnails", "contracts", "tasks", "tickets", "mtm-documents", "mtm-attendance",
    ]))
    expect(labels).not.toEqual(expect.arrayContaining(["logos"]))
    expect(labels.indexOf("mtm-photo-thumbnails")).toBeGreaterThan(labels.indexOf("mtm-photos"))
  })

  it("answers with counts only", async () => {
    const response = await call("?apply=1")
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(Object.keys(body.data).sort()).toEqual(["dryRun", "hasMore", "limit", "locations", "totals"])
  })
})
