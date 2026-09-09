import { describe, expect, it } from "vitest"
import {
  conversationHasPhone,
  isAiCustomerStage,
  normalizeCustomerStage,
  normalizeLeadReportedCustomerStage,
  normalizeLeadReportedCustomerStages,
  primaryLeadReportedCustomerStage,
  validateLeadReportedCustomerStages,
} from "@/lib/inbox/customer-stage"

describe("inbox customer stage", () => {
  it("accepts only the eight canonical stages", () => {
    expect(normalizeCustomerStage(" potential ")).toBe("potential")
    expect(normalizeCustomerStage("marketing_contacted")).toBe("marketing_contacted")
    expect(normalizeCustomerStage("sales_contacted")).toBe("sales_contacted")
    expect(normalizeCustomerStage("pending")).toBeNull()
    expect(normalizeCustomerStage("")).toBeNull()
  })

  it("keeps the marketing-only state out of salesperson call reports", () => {
    expect(normalizeLeadReportedCustomerStage("interested")).toBe("interested")
    expect(normalizeLeadReportedCustomerStage("sales_contacted")).toBe("sales_contacted")
    expect(normalizeLeadReportedCustomerStage("marketing_contacted")).toBeNull()
  })

  it("normalizes multi-select results in a stable business order", () => {
    expect(normalizeLeadReportedCustomerStages([
      "sold",
      "sales_contacted",
      "sold",
      "invalid",
      "potential",
    ])).toEqual(["sales_contacted", "potential", "sold"])
  })

  it("allows compatible multi-select results and chooses a primary compatibility stage", () => {
    const stages = normalizeLeadReportedCustomerStages(["sales_contacted", "potential", "sold"])
    expect(validateLeadReportedCustomerStages(stages)).toBe(true)
    expect(primaryLeadReportedCustomerStage(stages)).toBe("sold")
  })

  it("rejects contradictory call results", () => {
    expect(validateLeadReportedCustomerStages(["sales_contacted", "unable_to_contact"])).toBe(false)
    expect(validateLeadReportedCustomerStages(["sold", "not_sold"])).toBe(false)
    expect(validateLeadReportedCustomerStages([])).toBe(false)
  })

  it("restricts AI stages to non-terminal classifications", () => {
    expect(isAiCustomerStage("interested")).toBe(true)
    expect(isAiCustomerStage("potential")).toBe(true)
    expect(isAiCustomerStage("no_result")).toBe(true)
    expect(isAiCustomerStage("sold")).toBe(false)
    expect(isAiCustomerStage("sales_contacted")).toBe(false)
  })

  it("recognizes a usable phone in contact or channel metadata", () => {
    expect(conversationHasPhone({ contactPhone: "+994 50 123 45 67" })).toBe(true)
    expect(conversationHasPhone({ metadata: { waPhone: "994501234567" } })).toBe(true)
    expect(conversationHasPhone({ metadata: { contactPhone: "123" } })).toBe(false)
  })
})
