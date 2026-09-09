import { describe, expect, it } from "vitest"
import {
  KpiPolicyDefinitionSchema, kpiPolicyHash,
  kpiPolicySignatureIsCoherent, reconcileKpiPolicyDefinition,
} from "@/lib/mtm/kpi-policy"

const definition = {
  schemaVersion: 1,
  formulaVersion: "SWM_PLAN_GPS_V1",
  rounding: { mode: "HALF_UP", scale: 1 },
  plan: { numerator: "VISITED_ROUTE_POINTS", denominator: "NON_DRAFT_NON_CANCELLED_ROUTE_POINTS" },
  gps: { numerator: "COMPLETED_VISITS_WITH_VALID_CHECK_IN_AND_CHECK_OUT", denominator: "COMPLETED_VISITS" },
  exclusions: ["DRAFT_ROUTES", "CANCELLED_ROUTES", "CANCELLED_VISITS", "SOFT_DELETED_RECORDS"],
  visitTypeAliases: { DOUBLE: ["DOUBLE", "JOINT"], INDEPENDENT: ["INDEPENDENT", "SELF"] },
  reconciliationCases: [{
    name: "one completed GPS visit",
    filter: { visitType: "ALL", brandId: null },
    planPoints: [{ routePointId: "rp-1", agentId: "a-1", agentName: "A", customerId: "c-1", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT", brandIds: [], completed: true }],
    visits: [{ visitId: "v-1", routePointId: "rp-1", agentId: "a-1", agentName: "A", customerId: "c-1", customerName: "C", contactId: null, date: "2026-07-01", visitType: "INDEPENDENT", brandIds: [], completed: true, gpsConfirmed: true }],
    expected: { plan: { numerator: 1, denominator: 1, percentage: 100 }, gps: { numerator: 1, denominator: 1, percentage: 100 } },
  }],
}

describe("signed SWM-13 KPI policy", () => {
  it("accepts only the implemented formula contract and reproduces every signed reconciliation case", () => {
    expect(KpiPolicyDefinitionSchema.safeParse(definition).success).toBe(true)
    expect(reconcileKpiPolicyDefinition(definition)).toEqual({ ok: true })
    expect(reconcileKpiPolicyDefinition({
      ...definition,
      reconciliationCases: [{ ...definition.reconciliationCases[0], expected: { ...definition.reconciliationCases[0].expected, gps: { numerator: 0, denominator: 1, percentage: 0 } } }],
    })).toEqual({ ok: false, caseName: "one completed GPS visit" })
  })

  it("canonicalizes object key order and rejects a changed hash or incomplete signature", () => {
    const parsed = KpiPolicyDefinitionSchema.parse(definition)
    const reordered = { ...parsed, schemaVersion: parsed.schemaVersion }
    expect(kpiPolicyHash(reordered)).toBe(kpiPolicyHash(parsed))
    const signed = {
      status: "ACTIVE", definition: parsed, definitionHash: kpiPolicyHash(parsed),
      approvalReference: "SWISSMED-KPI-2026-01", signedByUserId: "admin",
      signedAt: new Date(), activatedAt: new Date(), retiredAt: null,
    }
    expect(kpiPolicySignatureIsCoherent(signed)).toBe(true)
    expect(kpiPolicySignatureIsCoherent({ ...signed, definitionHash: "0".repeat(64) })).toBe(false)
    expect(kpiPolicySignatureIsCoherent({ ...signed, approvalReference: null })).toBe(false)
  })
})
