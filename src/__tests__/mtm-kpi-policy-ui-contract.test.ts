import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

function source(path: string) { return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8") }

describe("SWM-13 signed policy UI contract", () => {
  it("does not call a complete live calculation official without an approved policy", () => {
    const route = source("src/app/api/v1/mtm/kpi/route.ts")
    const exportRoute = source("src/app/api/v1/mtm/kpi/export/route.ts")
    const dashboard = source("src/components/mtm/explainable-kpi-dashboard.tsx")
    expect(route).toContain("kpiPolicySignatureIsCoherent(policyRow)")
    expect(route).toContain("authoritative: calculatedReport.formula.authoritative && Boolean(approvedPolicy)")
    expect(route).toContain('"UNSIGNED_POLICY"')
    expect(dashboard).toContain('report.formula.authorityReason === "UNSIGNED_POLICY"')
    expect(dashboard).toContain("!report.formula.authoritative")
    expect(exportRoute).toContain("MTM_KPI_POLICY_NOT_APPROVED")
  })

  it("exposes administrator upload, reconciliation, exact-hash activation and audit", () => {
    const settings = source("src/app/(dashboard)/mtm/settings/page.tsx")
    const admin = source("src/components/mtm/kpi-policy-admin.tsx")
    const activate = source("src/app/api/v1/mtm/kpi-policies/[id]/activate/route.ts")
    expect(settings).toContain("<KpiPolicyAdmin />")
    expect(admin).toContain("expectedDefinitionHash: activation.definitionHash")
    expect(activate).toContain("reconcileKpiPolicyDefinition")
    expect(activate).toContain("KPI_POLICY_ACTIVATED")
  })

  it("keeps long KPI filters and the applied scope readable on tablets", () => {
    const dashboard = source("src/components/mtm/explainable-kpi-dashboard.tsx")
    expect(dashboard).toContain('data-testid="mtm-kpi-applied-scope"')
    expect(dashboard).toContain("sm:grid-cols-2 xl:grid-cols-4")
    expect(dashboard).toContain("sm:grid-cols-2 sm:px-5 xl:grid-cols-3")
    expect(dashboard).toContain("sm:col-span-2 sm:flex-row sm:items-center sm:justify-between xl:col-span-3")
    expect(dashboard).not.toContain('className="ml-auto truncate">{appliedScopeLabel}')
    expect(dashboard).not.toContain("xl:grid-cols-6")
  })
})
