import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmKpiPolicyName, mtmKpiPolicyNameIsCode } from "@/lib/mtm/kpi-policy-name"

/**
 * Field UX audit 2026-09-05, task T14: the KPI badge printed the policy's
 * machine code at a manager reading the page in Russian, while `nameRu`,
 * `nameAz` and `nameEn` sat unused on the same row.
 */
describe("KPI policy name", () => {
  const policy = {
    code: "COV-2026-Q3",
    nameRu: "Покрытие аптек, 3 квартал",
    nameAz: "Aptek əhatəsi, 3-cü rüb",
    nameEn: "Pharmacy coverage, Q3",
  }

  it("names the policy in the reader's language", () => {
    expect(mtmKpiPolicyName(policy, "ru")).toBe("Покрытие аптек, 3 квартал")
    expect(mtmKpiPolicyName(policy, "az")).toBe("Aptek əhatəsi, 3-cü rüb")
    expect(mtmKpiPolicyName(policy, "en")).toBe("Pharmacy coverage, Q3")
    // next-intl hands over tags like "ru-RU", and a region must not lose the name.
    expect(mtmKpiPolicyName(policy, "ru-RU")).toBe("Покрытие аптек, 3 квартал")
  })

  it("treats a blank name as absent rather than printing emptiness", () => {
    // The columns are non-null strings, so a policy imported from another
    // system arrives with "" — and an empty badge is worse than the identifier
    // it replaced.
    expect(mtmKpiPolicyName({ ...policy, nameRu: "   " }, "ru")).toBe("Pharmacy coverage, Q3")
    expect(mtmKpiPolicyName({ ...policy, nameRu: "", nameEn: "" }, "ru")).toBe("COV-2026-Q3")
    expect(mtmKpiPolicyName({ code: "COV-2026-Q3" }, "ru")).toBe("COV-2026-Q3")
  })

  it("says when it fell back to the code, so the tooltip stops repeating it", () => {
    expect(mtmKpiPolicyNameIsCode(policy, "ru")).toBe(false)
    expect(mtmKpiPolicyNameIsCode({ code: "COV-2026-Q3" }, "ru")).toBe(true)
  })

  it("an unknown language gets English, never another reader's language", () => {
    // Showing Azerbaijani to a Turkish locale would look like a bug, not a
    // fallback. English is the one every policy form requires.
    expect(mtmKpiPolicyName(policy, "tr")).toBe("Pharmacy coverage, Q3")
    expect(mtmKpiPolicyName(policy, undefined)).toBe("Pharmacy coverage, Q3")
  })
})

describe("KPI policy badge wiring", () => {
  it("sends the names and stops labelling the badge with the code", () => {
    const route = readFileSync("src/app/api/v1/mtm/kpi/route.ts", "utf8")
    for (const field of ["nameRu: policyRow.nameRu", "nameAz: policyRow.nameAz", "nameEn: policyRow.nameEn"]) {
      expect(route, `kpi route should send ${field}`).toContain(field)
    }

    const dashboard = readFileSync("src/components/mtm/explainable-kpi-dashboard.tsx", "utf8")
    expect(dashboard).toContain("mtmKpiPolicyName(report.formula.policy, locale)")
    // The code is still reachable — a manager quotes it when asking finance
    // about a number — but it is the tooltip now, not the label.
    expect(dashboard).not.toContain('t("approvedPolicy", { code:')
  })

  it("keeps every locale's badge asking for a name", () => {
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const value = messages.mtmExplainableKpi.approvedPolicy as string
      expect(value, `${locale} still interpolates {code}`).not.toContain("{code}")
      expect(value, `${locale} must interpolate {name}`).toContain("{name}")
    }
  })
})
