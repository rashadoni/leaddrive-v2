/**
 * Deal-WON loyalty auto-earn hook in PUT /api/v1/deals/[id].
 *
 * When a deal NEWLY enters a won stage, the route fires applyAutoEarn with the
 * DISTINCT "deal_won" trigger (so it never double-awards with the invoice-paid
 * "purchase" hook). It must NOT fire on leaving a won stage, on a non-won
 * transition, or for a company-only deal (no contact). Fire-and-forget — a
 * loyalty failure never fails the deal update.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    deal: { groupBy: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), updateMany: vi.fn() },
    pipelineStage: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    attributionModel: { updateMany: vi.fn() },
    activity: { createMany: vi.fn() },
    channelConfig: { findMany: vi.fn() },
    dealContactRole: { findMany: vi.fn() }, // cashback-on-WON path
    contact: { findMany: vi.fn() },
  },
  logAudit: vi.fn(),
}))
vi.mock("@/lib/api-auth", () => ({ getSession: vi.fn(), getOrgId: vi.fn() }))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((data) => data),
  filterWritableFields: vi.fn().mockImplementation((data) => data),
}))
vi.mock("@/lib/sharing-rules", () => ({ applyRecordFilter: vi.fn().mockImplementation((_o, _u, _r, _e, where) => where) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/slack", () => ({ sendSlackNotification: vi.fn().mockResolvedValue(undefined), formatDealNotification: vi.fn().mockReturnValue("msg") }))
vi.mock("@/lib/constants", () => ({ DEFAULT_CURRENCY: "AZN" }))
vi.mock("@/lib/auth", () => ({ auth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }) }))
vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({ recordStageTransition: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/marketing-attribution/won-stages", () => ({ wonStageNames: vi.fn(),
  lostStageNames: vi.fn(async () => ["LOST"]),
}))
vi.mock("@/lib/loyalty/auto-earn", () => ({ applyAutoEarn: vi.fn() }))

import { PUT } from "@/app/api/v1/deals/[id]/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId } from "@/lib/api-auth"
import { wonStageNames } from "@/lib/marketing-attribution/won-stages"
import { applyAutoEarn } from "@/lib/loyalty/auto-earn"

const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "T" }

function putReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:3000/api/v1/deals/d1"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
const params = { params: Promise.resolve({ id: "d1" }) }

/** existing (old stage) then updated (new stage + the deal fields the hook reads). */
function mockTransition(oldStage: string, newStage: string, contactId: string | null) {
  vi.mocked(prisma.pipelineStage.findFirst).mockResolvedValue(null as never) // no validation rules
  vi.mocked(prisma.deal.findFirst)
    .mockResolvedValueOnce({ stage: oldStage, valueAmount: 5000, assignedTo: null, name: "Big Deal", stageChangedAt: null, pipelineId: "p1", currency: "AZN" } as never)
    .mockResolvedValueOnce({ id: "d1", contactId, valueAmount: 5000, currency: "AZN", stage: newStage, name: "Big Deal", company: null, campaign: null } as never)
  vi.mocked(prisma.deal.updateMany).mockResolvedValue({ count: 1 } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.attributionModel.updateMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.activity.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.dealContactRole.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as never)
  vi.mocked(wonStageNames).mockResolvedValue(["WON"] as never)
  // must return a promise — the hook chains .catch() on the result
  vi.mocked(applyAutoEarn).mockResolvedValue({ status: "no_op", accountId: null, earned: 0, reason: "auto_earn_disabled" } as never)
})

describe("PUT /api/v1/deals/[id] — deal-WON loyalty hook", () => {
  it("awards (deal_won) when a deal NEWLY enters a won stage", async () => {
    mockTransition("QUALIFIED", "WON", "c-1")
    const res = await PUT(putReq({ stage: "WON" }), params)
    expect(res.status).toBe(200)
    expect(applyAutoEarn).toHaveBeenCalledTimes(1)
    expect(applyAutoEarn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: "org-1",
        contactId: "c-1",
        trigger: "deal_won",
        orderAmount: 5000,
        currency: "AZN",
        referenceId: "d1",
        requireAutoEarnEnabled: true,
      }),
    )
  })

  it("does NOT award when LEAVING a won stage (WON → LEAD)", async () => {
    mockTransition("WON", "LEAD", "c-1")
    await PUT(putReq({ stage: "LEAD" }), params)
    expect(applyAutoEarn).not.toHaveBeenCalled()
  })

  it("does NOT award on a non-won transition (LEAD → QUALIFIED)", async () => {
    mockTransition("LEAD", "QUALIFIED", "c-1")
    await PUT(putReq({ stage: "QUALIFIED" }), params)
    expect(applyAutoEarn).not.toHaveBeenCalled()
  })

  it("does NOT award a company-only deal (no contact)", async () => {
    mockTransition("QUALIFIED", "WON", null)
    await PUT(putReq({ stage: "WON" }), params)
    expect(applyAutoEarn).not.toHaveBeenCalled()
  })

  it("still returns 200 when the loyalty hook rejects (fire-and-forget)", async () => {
    mockTransition("QUALIFIED", "WON", "c-1")
    vi.mocked(applyAutoEarn).mockRejectedValue(new Error("loyalty down"))
    const res = await PUT(putReq({ stage: "WON" }), params)
    expect(res.status).toBe(200) // deal update unaffected
  })
})
