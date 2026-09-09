import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AdvisorCapability } from "@/lib/ai/advisor/types"

const db = {
  contactFindMany: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: (...args: unknown[]) => db.contactFindMany(...args),
    },
  },
}))

import { collectAdvisorSignalsWithHealth } from "@/lib/ai/advisor/signals"

const CRM_ACTIVE: AdvisorCapability = {
  key: "crm",
  label: "CRM",
  moduleId: "crm",
  status: "active",
}

const SALES_LOCKED: AdvisorCapability = {
  key: "sales",
  label: "Sales",
  moduleId: "sales",
  status: "locked",
  reason: "Sales is not enabled for this tenant.",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("collectAdvisorSignalsWithHealth", () => {
  it("reports collector failures instead of hiding them as an empty risk list", async () => {
    db.contactFindMany.mockRejectedValue(new Error("crm read failed"))

    const result = await collectAdvisorSignalsWithHealth("org-1", [CRM_ACTIVE, SALES_LOCKED], new Date("2026-06-27T08:00:00.000Z"))

    expect(result.signals).toEqual([])
    expect(result.health.find((item) => item.domain === "crm")).toMatchObject({
      domain: "crm",
      domainLabel: "CRM",
      status: "collector_failed",
      signalCount: 0,
      checkedAt: "2026-06-27T08:00:00.000Z",
      reason: "crm read failed",
    })
    expect(result.health.find((item) => item.domain === "sales")).toMatchObject({
      domain: "sales",
      status: "disabled",
      reason: "Sales is not enabled for this tenant.",
    })
  })

  it("reports no_data when an active collector runs successfully without signals", async () => {
    db.contactFindMany.mockResolvedValue([])

    const result = await collectAdvisorSignalsWithHealth("org-1", [CRM_ACTIVE], new Date("2026-06-27T08:00:00.000Z"))

    expect(result.signals).toEqual([])
    expect(result.health.find((item) => item.domain === "crm")).toMatchObject({
      domain: "crm",
      status: "no_data",
      signalCount: 0,
      reason: "Collector ran successfully and found no active signals.",
    })
  })
})
