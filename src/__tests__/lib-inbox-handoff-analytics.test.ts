import { describe, expect, it } from "vitest"
import { summarizeHandoffAnalytics } from "@/lib/inbox/handoff-analytics"

describe("Inbox marketing → lead → sales analytics", () => {
  it("reports the handoff funnel and employee outcome breakdown", () => {
    const result = summarizeHandoffAnalytics(
      [
        { agent_id: "marketing-1", contacted: 10 },
        { agent_id: null, contacted: 2 },
      ],
      [
        { marketer_id: "marketing-1", seller_id: "seller-1", stage: "potential", reported: true, count: 2 },
        {
          marketer_id: "marketing-1",
          seller_id: "seller-1",
          stage: "sold",
          outcomes: ["sales_contacted", "potential", "sold"],
          reported: true,
          count: 1,
        },
        // A stage value without customerStageUpdatedAt is not a seller's call report.
        { marketer_id: "marketing-1", seller_id: "seller-2", stage: "potential", reported: false, count: 1 },
      ],
      [
        { id: "marketing-1", name: "Aysel Marketing", email: "marketing@example.com" },
        { id: "seller-1", name: "Kenan Sales", email: "kenan@example.com" },
        { id: "seller-2", name: null, email: "seller2@example.com" },
      ],
    )

    expect(result.totals).toEqual({
      marketingContacted: 12,
      leadsCreated: 4,
      salesReported: 3,
      awaitingSalesReport: 1,
      sold: 1,
      marketingToLeadRate: 33.3,
      salesReportRate: 75,
      soldRate: 33.3,
    })
    expect(result.marketing).toContainEqual(expect.objectContaining({
      agentName: "Aysel Marketing",
      conversationsContacted: 10,
      leadsCreated: 4,
    }))
    expect(result.sellers).toContainEqual(expect.objectContaining({
      agentName: "Kenan Sales",
      assignedLeads: 3,
      reported: 3,
      awaiting: 0,
      outcomes: { potential: 3, sales_contacted: 1, sold: 1 },
    }))
    expect(result.sellers).toContainEqual(expect.objectContaining({
      agentName: "seller2@example.com",
      assignedLeads: 1,
      reported: 0,
      awaiting: 1,
    }))
  })

  it("returns null rates instead of inventing percentages for empty data", () => {
    expect(summarizeHandoffAnalytics([], [], []).totals).toEqual({
      marketingContacted: 0,
      leadsCreated: 0,
      salesReported: 0,
      awaitingSalesReport: 0,
      sold: 0,
      marketingToLeadRate: null,
      salesReportRate: null,
      soldRate: null,
    })
  })
})
