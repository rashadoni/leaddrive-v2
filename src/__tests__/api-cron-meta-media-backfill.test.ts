/** The trigger: cron secret required, dry run unless `apply=1`, batch clamped, counts only. */
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({ isTenantPiiMasterKeyConfigured: () => true }))
vi.mock("@/lib/inbox/meta-media", () => ({
  repairMetaMediaMessages: vi.fn(async (options: { dryRun: boolean }) => ({ dryRun: options.dryRun, checked: 0, broken: 0, repaired: 0, failed: 0, hasMore: false })),
  backfillMetaMediaMessages: vi.fn(async (options: { dryRun: boolean; limit: number }) => ({
    dryRun: options.dryRun, candidates: 0, stored: 0, failed: 0, hasMore: false, byKind: {},
  })),
}))

import { POST } from "@/app/api/cron/meta-media-backfill/route"
import { backfillMetaMediaMessages, repairMetaMediaMessages } from "@/lib/inbox/meta-media"

const call = (query = "", secret: string | null = "cron-secret") =>
  POST(new NextRequest(new URL(`http://localhost/api/cron/meta-media-backfill${query}`), {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  }))

beforeEach(() => {
  vi.mocked(backfillMetaMediaMessages).mockClear()
  process.env.CRON_SECRET = "cron-secret"
})

describe("POST /api/cron/meta-media-backfill", () => {
  it("refuses a caller without the cron secret and touches nothing", async () => {
    expect((await call("?apply=1", null)).status).toBe(401)
    expect((await call("?apply=1", "wrong")).status).toBe(401)
    expect(backfillMetaMediaMessages).not.toHaveBeenCalled()
  })

  it("is a dry run unless apply=1, and clamps the batch", async () => {
    await call()
    await call("?apply=true&limit=-1")
    await call("?apply=1&limit=99999")
    expect(vi.mocked(backfillMetaMediaMessages).mock.calls.map(([o]) => [o.dryRun, o.limit])).toEqual([[true, 50], [true, 50], [false, 500]])
  })

  it("mode=repair runs the repair, still a dry run unless apply=1", async () => {
    await call("?mode=repair")
    await call("?mode=repair&apply=1")
    expect(vi.mocked(repairMetaMediaMessages).mock.calls.map(([o]) => o.dryRun)).toEqual([true, false])
    expect(backfillMetaMediaMessages).not.toHaveBeenCalled()
  })
})
