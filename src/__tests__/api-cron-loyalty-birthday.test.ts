/**
 * POST /api/cron/loyalty-birthday — birthday auto-earn cron route.
 *
 * The route is a thin adapter: auth gate → filter orgs to those with the
 * auto-earn master switch ON *and* an active birthday rule → call
 * runLoyaltyBirthday per org → aggregate. The per-contact logic lives in
 * runLoyaltyBirthday (mocked here, tested in loyalty-birthday-cron.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/rls-context", () => ({ runWithRlsBypass: (fn: () => unknown) => fn() }))
vi.mock("@/lib/cron-auth", () => ({ requireCronAuth: vi.fn() }))
vi.mock("@/lib/loyalty/birthday-cron", () => ({ runLoyaltyBirthday: vi.fn() }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: { findMany: vi.fn() },
    loyaltyEarnRule: { findMany: vi.fn() },
  },
}))

import { POST } from "@/app/api/cron/loyalty-birthday/route"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runLoyaltyBirthday } from "@/lib/loyalty/birthday-cron"

function makeReq() {
  return { headers: new Headers({ "x-cron-secret": "s" }) } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireCronAuth).mockReturnValue(null) // auth passes by default
})

describe("POST /api/cron/loyalty-birthday", () => {
  it("returns the auth error and does no work when requireCronAuth rejects", async () => {
    vi.mocked(requireCronAuth).mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
    const r = await POST(makeReq())
    expect(r.status).toBe(401)
    expect(prisma.organization.findMany).not.toHaveBeenCalled()
  })

  it("no orgs with auto-earn enabled → orgsChecked 0, lib not called", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      { id: "o1", settings: {} },
      { id: "o2", settings: { loyaltyAutoEarn: false } },
    ] as never)
    const j = await (await POST(makeReq())).json()
    expect(j).toMatchObject({ ok: true, orgsChecked: 0 })
    expect(prisma.loyaltyEarnRule.findMany).not.toHaveBeenCalled()
    expect(runLoyaltyBirthday).not.toHaveBeenCalled()
  })

  it("auto-earn org but NO active birthday rule → orgsChecked 0", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      { id: "o1", settings: { loyaltyAutoEarn: true } },
    ] as never)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([] as never)
    const j = await (await POST(makeReq())).json()
    expect(j).toMatchObject({ ok: true, orgsChecked: 0 })
    expect(runLoyaltyBirthday).not.toHaveBeenCalled()
  })

  it("processes only auto-earn orgs that have a birthday rule; aggregates points", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([
      { id: "o1", settings: { loyaltyAutoEarn: true } },
      { id: "o2", settings: { loyaltyAutoEarn: true } },
      { id: "o3", settings: {} }, // not auto-earn → excluded from the rule query
    ] as never)
    vi.mocked(prisma.loyaltyEarnRule.findMany).mockResolvedValue([{ organizationId: "o1" }] as never)
    vi.mocked(runLoyaltyBirthday).mockResolvedValue({
      contactsMatched: 3,
      awarded: 2,
      alreadyAwarded: 1,
      skipped: 0,
      errors: 0,
      totalPoints: 200,
    } as never)

    const j = await (await POST(makeReq())).json()
    expect(j).toMatchObject({ ok: true, orgsChecked: 1, totalAwarded: 2, totalPoints: 200 })
    expect(runLoyaltyBirthday).toHaveBeenCalledTimes(1)
    expect(runLoyaltyBirthday).toHaveBeenCalledWith(expect.anything(), "o1", expect.any(Date))
    // rule query scoped to the auto-earn orgs only (o1,o2 — never o3)
    expect(prisma.loyaltyEarnRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: { in: ["o1", "o2"] },
          isActive: true,
          trigger: "birthday",
        }),
      }),
    )
  })
})
