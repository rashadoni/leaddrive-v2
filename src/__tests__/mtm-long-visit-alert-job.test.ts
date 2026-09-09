import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mtm-settings", () => ({
  getMtmSettings: vi.fn(() => Promise.resolve({
    autoCheckoutMinutes: 120,
    alertLongBreak: true,
  })),
}))

import { prisma } from "@/lib/prisma"
import { executeMtmLongVisitAlertJob } from "@/lib/cron/mtm-auto-checkout-job"

const staleVisit = {
  id: "visit-1",
  organizationId: "org-1",
  agentId: "agent-1",
  customerId: "customer-1",
  status: "CHECKED_IN",
  checkInAt: new Date(Date.now() - 180 * 60_000),
  customer: { name: "Clinic One" },
}

describe("long-open MTM visit alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "org-1" }] as never)
    vi.mocked(prisma.mtmVisit.findMany).mockResolvedValue([staleVisit] as never)
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue(null)
  })

  it("creates an alert and notification without checking out the visit", async () => {
    const summary = await executeMtmLongVisitAlertJob()

    expect(summary).toEqual({ autoCheckedOut: 0, staleVisitsFound: 1, alertsCreated: 1 })
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
    expect(prisma.mtmAlert.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "LONG_BREAK", agentId: "agent-1" }),
    }))
    expect(prisma.mtmNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentId: "agent-1", type: "warning" }),
    }))
  })

  it("does not duplicate an unresolved alert for the same visit", async () => {
    vi.mocked(prisma.mtmAlert.findFirst).mockResolvedValue({ id: "alert-1" } as never)

    const summary = await executeMtmLongVisitAlertJob()

    expect(summary).toEqual({ autoCheckedOut: 0, staleVisitsFound: 1, alertsCreated: 0 })
    expect(prisma.mtmAlert.create).not.toHaveBeenCalled()
    expect(prisma.mtmVisit.updateMany).not.toHaveBeenCalled()
  })
})
