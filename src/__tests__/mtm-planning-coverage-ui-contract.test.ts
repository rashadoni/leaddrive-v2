import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

function localeKeys(locale: string): Record<string, unknown> {
  return JSON.parse(source(`messages/${locale}.json`)).mtmRoutesPage as Record<string, unknown>
}

describe("SWM-15/SWM-16 governed planning coverage contract", () => {
  it("reads one governed snapshot contract in both coverage endpoints", () => {
    const coverageRoute = source("src/app/api/v1/mtm/coverage/route.ts")
    const candidatesRoute = source("src/app/api/v1/mtm/routes/candidates/route.ts")
    const coverageRead = source("src/lib/mtm/coverage-read.ts")

    expect(coverageRoute).toContain("readGovernedCoverage(prisma")
    expect(candidatesRoute).toContain("readGovernedCoverage(prisma")
    expect(coverageRead).toContain("coveragePolicySignatureIsCoherent(activePolicy)")
    expect(coverageRead).toContain("coverageSnapshotTotalsReconcile(totals.data)")
    expect(coverageRead).toContain("coverageSnapshotIsComplete(completeness.data)")
  })

  it("scopes candidate evidence to tenant, frozen snapshot, subject type, and candidate IDs", () => {
    const route = source("src/app/api/v1/mtm/routes/candidates/route.ts")

    expect(route).toContain("organizationId,")
    expect(route).toContain("snapshotId: coverage.snapshot.id")
    expect(route).toContain("subjectType,")
    expect(route).toContain("subjectId: { in: subjectIds }")
    expect(route).toContain("CoverageSnapshotExplanationSchema.safeParse(row.explanation)")
    expect(route).toContain('sort === "COVERAGE_GAP"')
  })

  it("shows verified coverage in both planning surfaces without inventing a capacity limit", () => {
    const builder = source("src/components/mtm/route-builder.tsx")
    const matrix = source("src/components/mtm/route-planning-matrix.tsx")

    expect(builder).toContain('data-testid="mtm-planner-coverage-preview"')
    expect(matrix).toContain('data-testid="mtm-matrix-coverage-preview"')
    expect(builder).toContain("candidate.coverage.explanation.summary[coverageLocale]")
    expect(matrix).toContain("candidate.coverage.explanation.summary[coverageLocale]")
    expect(builder).toContain('t("capacityPolicyPending")')
    expect(builder).toContain('t("candidateCoverageSortLimited")')
    expect(matrix).toContain('t("candidateCoverageGap"')
  })

  it("keeps new planning copy aligned in RU, AZ, and EN", () => {
    for (const locale of ["ru", "az", "en"]) {
      const messages = localeKeys(locale)
      for (const key of [
        "sortCandidateCoverageGap",
        "candidateCoverageVerified",
        "candidateCoveragePeriod",
        "candidateCoverageSummary",
        "candidateCoverageUnavailable",
        "candidateCoverageGap",
        "candidateCoverageSortLimited",
        "capacityPolicyPending",
      ]) {
        expect(messages[key], `${locale}.${key} is missing`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key} is empty`).not.toBe("")
      }
    }
  })
})
