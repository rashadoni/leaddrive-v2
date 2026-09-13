import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("Workforce access-management UI contract", () => {
  const page = source("src/app/(dashboard)/workforce/configuration/page.tsx")
  const component = source("src/components/workforce/workforce-access-management.tsx")

  it("keeps role custody inside the existing Workforce configuration surface", () => {
    expect(page).toContain("<WorkforceAccessManagement />")
    expect(component).toContain('useTranslations("workforceAccessManagement")')
    expect(component).toContain('"/api/v1/workforce/configuration/access/grants"')
    expect(component).toContain('"/api/v1/workforce/configuration/access/grant-targets?kind="')
    expect(component).toContain('"/api/v1/workforce/configuration/access/review"')
  })

  it("cannot bootstrap tenant-admin authority or submit an unreviewed grant", () => {
    expect(component).toContain('role !== "TENANT_ADMIN"')
    expect(component).toContain("disabled={saving || !confirmed || !principal")
    expect(component).toContain("setConfirmed(false)")
    expect(component).toContain("crypto.randomUUID()")
  })

  it("uses named tenant targets and an explicit append-only revocation review", () => {
    expect(component).toContain('type TargetKind = "PRINCIPAL"')
    expect(component).toContain("encodeURIComponent(grantId)")
    expect(component).toContain("pendingRevocation === grantItem.grantId")
    expect(component).toContain('variant="destructive"')
    expect(component).toContain('t("confirmRevocation")')
    expect(component).toContain('review.activityEvidence === "UNAVAILABLE"')
    expect(component).toContain('aria-live="polite"')
    expect(component).toContain("aria-busy={loading || saving || reviewing}")
  })
})
