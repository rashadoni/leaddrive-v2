import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const componentPath = "src/components/mtm/coverage-policy-admin.tsx"
const settingsPath = "src/app/(dashboard)/mtm/settings/page.tsx"

function source(path: string) {
  return readFileSync(path, "utf8")
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => leafPaths(entry, prefix ? `${prefix}.${key}` : key))
}

describe("SWM-15 coverage administrator UI contract", () => {
  it("connects the settings page to governed policy and snapshot operations", () => {
    const component = source(componentPath)
    expect(source(settingsPath)).toContain("<CoveragePolicyAdmin")
    expect(component).toContain('fetch("/api/v1/mtm/coverage-policies"')
    expect(component).toContain("/api/v1/mtm/coverage-policies/${encodeURIComponent(activation.id)}/activate")
    expect(component).toContain('fetch("/api/v1/mtm/coverage-snapshots"')
    expect(component).toContain("expectedDefinitionHash: activation.definitionHash")
    expect(component).toContain("approvalReference: approvalReference.trim()")
  })

  it("requires explicit source review before either immutable write", () => {
    const component = source(componentPath)
    expect(component).toContain("!policySummary || !policyConfirmed")
    expect(component).toContain("!snapshotSummary || !snapshotConfirmed")
    expect(component).toContain("setPolicyConfirmed(false)")
    expect(component).toContain("setSnapshotConfirmed(false)")
    expect(component).not.toMatch(/requiredCoverage:\s*["']?\d/)
    expect(component).not.toMatch(/actualCoverage:\s*["']?\d/)
  })

  it("keeps RU, AZ, and EN coverage administration keys aligned", () => {
    const namespaces = ["ru", "az", "en"].map((locale) => (
      JSON.parse(source(`messages/${locale}.json`)).mtmCoverageAdmin as Record<string, unknown>
    ))
    const baseline = leafPaths(namespaces[0]).sort()
    expect(leafPaths(namespaces[1]).sort()).toEqual(baseline)
    expect(leafPaths(namespaces[2]).sort()).toEqual(baseline)
  })
})
