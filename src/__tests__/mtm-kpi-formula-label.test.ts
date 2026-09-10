import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, W-11 and the tail of task C1.
 *
 * The analytics header printed the stored calculation code — `SWM_PLAN_GPS_V1`
 * — to a manager reading a report in Azerbaijani. Two things are wrong with
 * that at once: it is an identifier standing where a name belongs, and its
 * prefix is a customer's initials, which is the exact rule C1 exists for.
 *
 * The code itself stays as it is. Audit rows carry it and the API compares
 * against the literal, so renaming the constant would rewrite history it
 * cannot reach. It moves into the badge's tooltip, next to the policy badge
 * that has worked this way since T14.
 */
const DASHBOARD = "src/components/mtm/explainable-kpi-dashboard.tsx"

describe("C1 tail: the KPI formula is named, not coded", () => {
  it("labels the badge with a translated name", () => {
    const dashboard = readFileSync(DASHBOARD, "utf8")
    expect(dashboard).toContain('{t("formulaName")}')
    expect(dashboard).not.toContain('t("formulaVersion", { version: report.formula.version })')
  })

  it("keeps the code reachable, because a manager quotes it to finance", () => {
    const dashboard = readFileSync(DASHBOARD, "utf8")
    expect(dashboard).toContain('title={t("formulaCodeHint", { code: report.formula.version })}')
  })

  it("has the name and the hint in all three languages", () => {
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const block = messages.mtmExplainableKpi ?? {}
      if (typeof block.formulaName !== "string" || !block.formulaName.trim()) missing.push(`${locale}.formulaName`)
      if (typeof block.formulaCodeHint !== "string" || !block.formulaCodeHint.includes("{code}")) missing.push(`${locale}.formulaCodeHint`)
      // The key the badge no longer reads must not linger as a second answer.
      if ("formulaVersion" in block) missing.push(`${locale}.formulaVersion still present`)
    }
    expect(missing).toEqual([])
  })

  it("does not put a customer's initials into any of the three names", () => {
    const offenders: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      const name = String(messages.mtmExplainableKpi?.formulaName ?? "")
      if (/swm|swissmed/i.test(name)) offenders.push(`${locale}: ${name}`)
    }
    expect(offenders).toEqual([])
  })

  it("leaves the stored value alone", () => {
    // The API compares against this literal and audit rows already carry it.
    expect(readFileSync("src/lib/mtm/explainable-kpi.ts", "utf8"))
      .toContain('export const MTM_KPI_FORMULA_VERSION = "SWM_PLAN_GPS_V1"')
  })
})
