import { describe, expect, it } from "vitest"
import { evaluateDealExport, receiverAmount } from "../lib/integrations/customer-receiver/eligibility"
import type { ReceiverBinding } from "../lib/integrations/customer-receiver/delivery"

const binding: ReceiverBinding = { organizationId: "org-1", integrationId: "receiver-1", environment: "TEST", enabled: true, contractApproved: true }
const candidate = { organizationId: "org-1", companyId: "customer-1", pipelineId: "pipeline-1", stage: "Qualified" }

describe("explicit deal export eligibility", () => {
  it("keeps an unconfigured business rule disabled", () => {
    expect(evaluateDealExport(binding, { mode: "disabled" }, candidate)).toBe("disabled")
  })
  it("does not export an identically named stage from a different pipeline", () => {
    const rule = { mode: "pipeline_stages" as const, pipelineId: "pipeline-1", stages: ["Qualified"] }
    expect(evaluateDealExport(binding, rule, candidate)).toBe("eligible")
    expect(evaluateDealExport(binding, rule, { ...candidate, pipelineId: "pipeline-2" })).toBe("outside_rule")
    expect(evaluateDealExport(binding, rule, { ...candidate, stage: "Lead" })).toBe("outside_rule")
  })
  it("requires a customer reference even for an explicit all-deals rule", () => {
    expect(evaluateDealExport(binding, { mode: "all_deals" }, candidate)).toBe("eligible")
    expect(evaluateDealExport(binding, { mode: "all_deals" }, { ...candidate, companyId: null })).toBe("missing_customer")
  })
  it("rejects cross-tenant data and an unapproved wire contract", () => {
    expect(() => evaluateDealExport(binding, { mode: "disabled" }, { ...candidate, organizationId: "org-2" })).toThrow()
    expect(() => evaluateDealExport({ ...binding, contractApproved: false }, { mode: "all_deals" }, candidate)).toThrow()
  })
  it("does not treat an empty stage list as all stages", () => {
    expect(() => evaluateDealExport(binding, { mode: "pipeline_stages", pipelineId: "pipeline-1", stages: [] }, candidate)).toThrow()
  })
})

describe("lossless money mapping", () => {
  it.each([["1500", "1500.00"], ["1500.1", "1500.10"], ["1500.1200", "1500.12"], ["99999999999999.9900", "99999999999999.99"]])("converts %s without floating-point precision loss", (source, expected) => {
    expect(receiverAmount(source)).toBe(expected)
  })
  it.each(["1500.1234", "0.001", "1e3", "-1.00", "NaN"])("refuses implicit rounding/unsupported amount %s", (source) => {
    expect(() => receiverAmount(source)).toThrow()
  })
})
